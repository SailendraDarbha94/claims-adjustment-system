import { NextResponse, type NextRequest } from "next/server";
import { createMiddlewareSupabaseClient } from "@/lib/supabase/middleware";

// Session refresh + signed-in gate for PAGES. Route handlers under /api are bearer-only and excluded by
// the matcher; they do their own auth (lib/api/auth.ts).
//
// This is deliberately NOT the admin gate any more (docs/PLAN.md decision j, amended 2026-09-27). The
// admin gate is the (admin) layout plus every admin page (requireAdminPage) and, underneath both, RLS.
// Why: the proxy runs at the Vercel edge nearest the visitor (measured from Mumbai) while Supabase is in
// Ohio, and the two calls it used to make per page view — getUser() and a profiles role lookup — cost
// ~0.4 s together before the page function had even started. The page checks the role anyway, over a
// connection that is in the same region as the database, so the proxy's copy of the check bought nothing
// but latency. What is left here is the one thing only the proxy can do (write refreshed cookies) and a
// cheap local check that keeps signed-out visitors off admin URLs.
//
// Rules: /login and /not-authorised are public. No valid session anywhere else → /login. A signed-in user
// on /login → "/" (the admin page then sends a non-admin on to /not-authorised). Everything else passes.

const PUBLIC_PATHS = new Set(["/login", "/not-authorised"]);

export async function proxy(request: NextRequest) {
  let ctx: ReturnType<typeof createMiddlewareSupabaseClient>;
  try {
    ctx = createMiddlewareSupabaseClient(request);
  } catch (error) {
    // Missing env: a readable plain-text 500 instead of a stack trace in the browser.
    const message = error instanceof Error ? error.message : String(error);
    return new NextResponse(`Server misconfiguration: ${message}`, {
      status: 500,
      headers: { "content-type": "text/plain; charset=utf-8" },
    });
  }

  // getClaims() BEFORE any early return: with no token argument it calls getSession() first, and on the
  // @supabase/ssr client that is the call that refreshes an expired session and writes the new cookies.
  // Every request (including ones that end in a redirect) must carry the refreshed cookies, otherwise the
  // next request presents an already-rotated refresh token and the admin is logged out.
  //
  // The signature is then verified locally (ES256, WebCrypto) against the project's key set instead of with
  // a getUser() round trip to the Auth server. auth-js fetches that set itself, once per process, and caches
  // it for 10 minutes (GoTrueClient's GLOBAL_JWKS, keyed by storage key; the endpoint is CDN-cached too, so
  // even a cold isolate's fetch rarely reaches Ohio). auth-js falls back to getUser() on its own only for a
  // token it cannot verify locally: a symmetric (HS) signature, no kid, or a kid that is not in the freshly
  // fetched set either (the full list is in verifyLocally, lib/api/auth.ts).
  let signedIn = false;
  try {
    const { data } = await ctx.supabase.auth.getClaims();
    signedIn = data !== null;
  } catch {
    // auth-js rethrows non-AuthErrors from its token decode (a cookie whose JWT has an unsupported alg or
    // a non-JSON header; the full list is in verifyLocally, lib/api/auth.ts). getSession() has already
    // written any refreshed cookies through setAll by then, so treating this as "no session" is safe, and
    // the visitor who set that cookie gets /login rather than a bare 500.
  }

  const { pathname } = request.nextUrl;
  const isPublic = PUBLIC_PATHS.has(pathname);

  // Every redirect copies the (possibly refreshed) cookies from the pass-through response.
  const redirectTo = (path: string): NextResponse => {
    const redirect = NextResponse.redirect(new URL(path, request.url));
    for (const cookie of ctx.response.cookies.getAll()) {
      redirect.cookies.set(cookie);
    }
    return redirect;
  };

  if (!signedIn) {
    return isPublic ? ctx.response : redirectTo("/login");
  }

  if (pathname === "/login") {
    // "/" is the admin overview (app/(admin)/page.tsx). app/login/page.tsx navigates to the same path
    // after a successful sign-in; if these two ever disagree, an admin bounces between them.
    return redirectTo("/");
  }
  return ctx.response;
}

export const config = {
  // All page paths except: /api/* (bearer-only route handlers), Next internals, the favicon, and paths
  // ENDING in a static-asset extension (public/ files). The exclusion is a trailing-extension list rather
  // than "any dot anywhere" so that a page path containing a dot (/claims/v1.0) still goes through the
  // gate. Must be a literal: Next reads it at build time.
  matcher: [
    "/((?!api|_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico|css|js|map|txt|xml|json|woff2?)$).*)",
  ],
};
