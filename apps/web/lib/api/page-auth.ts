import "server-only";
import { cache } from "react";
import { redirect } from "next/navigation";
import { USER_ROLES, type UserRole } from "@claims/shared";
import type { Tables } from "@claims/supabase/types";
import { createServerSupabaseClient } from "@/lib/supabase/server";

/** What a page knows about the signed-in admin from the verified token: the id, and the email if present. */
export type AdminPageUser = { id: string; email: string | null };

export type AdminPageAuth = {
  user: AdminPageUser;
  profile: Tables<"profiles">;
};

// Admin gate for Server Components and layouts (docs/PLAN.md decision j, amended 2026-09-27). Since the
// amendment proxy.ts only checks that a session exists, so this is THE admin check for pages, not a
// backup: a signed-in agent who opens an admin URL is redirected here, and a path the matcher misses (or
// a future matcher edit) must still not render admin data. The (admin) layout calls this for its own
// render, and every admin page calls it too: a layout's redirect ends only the layout's render, the page
// segment still runs (Next docs, "Layouts and auth checks"). React cache() dedupes the calls within one
// request; on a client-side navigation only the page re-renders, and its own call runs. Redirects instead
// of throwing.
export const requireAdminPage = cache(async (): Promise<AdminPageAuth> => {
  const supabase = await createServerSupabaseClient();

  // getClaims() verifies the cookie token's signature locally (ES256, WebCrypto) against the project's key
  // set, which auth-js fetches once per process and caches for 10 minutes; getSession() alone would only
  // decode the cookie. Compared with getUser() this saves a round trip to the Auth server per request; the
  // cost is that a session revoked elsewhere (sign-out on another device, ban, password change) is honoured
  // until the token expires, which PostgREST accepts too.
  let user: AdminPageUser | null = null;
  try {
    const { data } = await supabase.auth.getClaims();
    user = userFromClaims(data?.claims);
  } catch {
    // auth-js rethrows non-AuthErrors from its token decode (an unsupported alg, a non-JSON header; see
    // verifyLocally in lib/api/auth.ts). A cookie like that is not a session: /login, not an error page.
  }
  if (!user) redirect("/login");

  // Own profiles row via RLS (profiles_select_own). A missing row (trigger not run) counts as non-admin.
  const { data: profile } = await supabase
    .from("profiles")
    .select("*")
    .eq("id", user.id)
    .maybeSingle();
  // packages/supabase/types.ts is a hand-written stand-in until `pnpm db:types` runs against a real
  // project, so the role is checked against the shared USER_ROLES list at runtime rather than trusted from
  // the type alone; an unknown value is treated as non-admin.
  if (!profile || !isKnownRole(profile.role) || profile.role !== "admin") {
    redirect("/not-authorised");
  }

  return { user, profile };
});

// `sub` is the user id; a token without one (or with a non-string one) is treated as signed out rather
// than trusted. `email` is optional in the payload and is only used for display.
function userFromClaims(
  claims: { sub?: unknown; email?: unknown } | undefined,
): AdminPageUser | null {
  if (!claims || typeof claims.sub !== "string" || claims.sub.length === 0) {
    return null;
  }
  return {
    id: claims.sub,
    email: typeof claims.email === "string" ? claims.email : null,
  };
}

function isKnownRole(role: string): role is UserRole {
  return (USER_ROLES as readonly string[]).includes(role);
}
