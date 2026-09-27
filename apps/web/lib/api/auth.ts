import { isAuthRetryableFetchError } from "@supabase/supabase-js";
import {
  createBearerClient,
  type BearerSupabaseClient,
} from "@claims/supabase/bearer";
import type { Tables } from "@claims/supabase/types";
import { ApiError, internalError } from "@/lib/api/errors";
import { getPublicSupabaseEnv } from "@/lib/env";

/** The caller as established from the verified token: the id, and the email if the token carries one. */
export type AuthedUser = { id: string; email: string | null };

export type AuthedRequest = {
  user: AuthedUser;
  profile: Tables<"profiles">;
  /** Client acting as the caller: RLS applies and auth.uid() in the audit triggers is the caller. */
  db: BearerSupabaseClient;
};

export type RequireUserOptions = {
  /**
   * How the bearer token is verified (docs/PLAN.md decision g, amended 2026-09-27).
   * - "local" (default): auth-js checks the ES256 signature with WebCrypto against the project's key set,
   *   which it fetches once per process and caches for 10 minutes. Nothing goes to the Auth server on the
   *   warm path, but a token revoked server-side (sign-out elsewhere, ban, password change) is still
   *   accepted until it expires — 1 hour by default — exactly as PostgREST itself accepts it.
   * - "server": `auth.getUser(token)`, which asks the Auth server and therefore sees revocation. For the
   *   handlers where a revoked admin must not get one more write in.
   */
  verification?: "local" | "server";
};

/**
 * Route-handler authentication (docs/PLAN.md §3 "Authentication in every handler", decision g). Bearer
 * tokens only — cookies are never read here, so there is no CSRF surface and one auth path for mobile and
 * the dashboard's client components alike.
 *
 * 1. `Authorization: Bearer <jwt>`; missing → UNAUTHENTICATED.
 * 2. A bearer client with that token, then the token is verified (a decoded but unverified JWT is never
 *    trusted). `verification: "local"` (the default) is `auth.getClaims(token)`: auth-js checks the ES256
 *    signature with WebCrypto against the project's key set, which it fetches once per process and caches
 *    for 10 minutes (GoTrueClient's GLOBAL_JWKS, shared by every client with the same storage key); on the
 *    warm path nothing is sent to the Auth server. `verification: "server"` is `auth.getUser(token)`, one
 *    round trip to the Auth server per request. Either way: invalid or expired → UNAUTHENTICATED; the
 *    server unreachable (the Auth server, or the JWKS endpoint on a cold process) → INTERNAL, because the
 *    token was never checked and a 401 would make the mobile client sign the user out.
 *    Why local is the default: the only thing it cannot see is server-side revocation before the token
 *    expires, and PostgREST — which every query in this codebase goes through — already accepts such a
 *    token for the same hour, so the online check bought no extra safety for reads. The admin MUTATION
 *    handlers (status, assign, notes) opt into "server" because a revoked admin must not be able to
 *    change a claim.
 * 3. Own profiles row through the same client (RLS: profiles_select_own). No row → FORBIDDEN, not
 *    UNAUTHENTICATED: the session is valid, so the client must not treat it as expired.
 */
export async function requireUser(
  request: Request,
  options: RequireUserOptions = {},
): Promise<AuthedRequest> {
  const accessToken = bearerToken(request.headers.get("authorization"));
  if (!accessToken) {
    throw new ApiError(
      "UNAUTHENTICATED",
      "Missing bearer token. Send Authorization: Bearer <access token>.",
    );
  }

  // Env is read per request, never at module scope, so `next build` succeeds with no env set.
  const { url, publishableKey } = getPublicSupabaseEnv();
  const db = createBearerClient({ url, publishableKey, accessToken });

  const user =
    options.verification === "server"
      ? await verifyWithAuthServer(db, accessToken)
      : await verifyLocally(db, accessToken);

  const { data: profile, error: profileError } = await db
    .from("profiles")
    .select("*")
    .eq("id", user.id)
    .maybeSingle();
  if (profileError) throw profileError;
  if (!profile) {
    // The on_auth_user_created trigger did not run for this user (migration applied after sign-up). The
    // mobile client signs out on a persistent 401, which would hide this message behind a sign-in loop;
    // 403 keeps the session and shows the text.
    throw new ApiError(
      "FORBIDDEN",
      "No profile exists for this account. Contact an administrator.",
    );
  }

  return { user, profile, db };
}

/** requireUser + admin role. For /api/admin/*; the DB re-checks via is_admin() regardless. */
export async function requireAdmin(
  request: Request,
  options?: RequireUserOptions,
): Promise<AuthedRequest> {
  const auth = await requireUser(request, options);
  if (auth.profile.role !== "admin") {
    throw new ApiError("FORBIDDEN", "Administrator access is required.");
  }
  return auth;
}

async function verifyLocally(
  db: BearerSupabaseClient,
  accessToken: string,
): Promise<AuthedUser> {
  // auth-js looks the token's kid up in its process-wide key-set cache (10-minute TTL) and fetches
  // /auth/v1/.well-known/jwks.json only when the entry is missing or stale, so a warm process verifies
  // without any network. It falls back to getUser() when the token is symmetrically signed, has no kid, or
  // names a kid that is not in the fetched set either — so an unknown kid is rejected by the Auth server,
  // at the cost of one JWKS fetch plus one getUser() round trip for that request.
  let result: Awaited<ReturnType<typeof db.auth.getClaims>>;
  try {
    result = await db.auth.getClaims(accessToken);
  } catch {
    // auth-js returns AuthErrors as { error } but RETHROWS anything else. With a token supplied no
    // getSession()/refresh code runs, so the only throws are token-shape problems: a header or payload
    // that is base64url but not JSON (SyntaxError, from decodeJWT before any kid lookup), an unsupported
    // alg ("none", ES384 → Error), or an alg that does not fit the key (RS256 against the EC key →
    // DOMException). Every network failure inside auth-js is an AuthError and comes back as { error }, so
    // this catch cannot swallow an outage. These are 401s, not 500s, and they must not reach route()'s
    // unhandled-error log, where an anonymous caller could fill it at no cost.
    throw new ApiError("UNAUTHENTICATED", "Invalid or expired access token.");
  }
  const { data, error } = result;
  if (error && isAuthRetryableFetchError(error)) {
    // auth-js's fetch of the key set (or its getUser() fallback) threw: outage, DNS, a mis-set
    // NEXT_PUBLIC_SUPABASE_URL on this host. Nothing is known about the token, so a server error, and
    // clients retry instead of signing out.
    console.error("[api] auth server unreachable", error);
    throw internalError();
  }
  if (error || !data) {
    throw new ApiError("UNAUTHENTICATED", "Invalid or expired access token.");
  }
  const { sub, email } = data.claims;
  if (typeof sub !== "string" || sub.length === 0) {
    // A verified token with no subject is not one Supabase Auth issues; never treat it as a user.
    throw new ApiError("UNAUTHENTICATED", "Invalid or expired access token.");
  }
  return { id: sub, email: typeof email === "string" ? email : null };
}

async function verifyWithAuthServer(
  db: BearerSupabaseClient,
  accessToken: string,
): Promise<AuthedUser> {
  const {
    data: { user },
    error,
  } = await db.auth.getUser(accessToken);
  if (error && isAuthRetryableFetchError(error)) {
    // fetch() to the Auth server threw (outage, DNS, a mis-set NEXT_PUBLIC_SUPABASE_URL on this host):
    // nothing is known about the token. Reported as a server error so clients retry instead of signing out.
    console.error("[api] auth server unreachable", error);
    throw internalError();
  }
  if (error || !user) {
    throw new ApiError("UNAUTHENTICATED", "Invalid or expired access token.");
  }
  return { id: user.id, email: user.email ?? null };
}

function bearerToken(header: string | null): string | null {
  if (!header) return null;
  const [scheme, ...rest] = header.trim().split(/\s+/);
  if (scheme?.toLowerCase() !== "bearer") return null;
  const token = rest.join("");
  return token.length > 0 ? token : null;
}
