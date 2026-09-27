import { NextResponse, type NextRequest } from "next/server";
import { createCookieClient, type CookieToSet } from "@claims/supabase/server";
import { getPublicSupabaseEnv } from "@/lib/env";

// For proxy.ts only. Follows the Supabase SSR pattern for Next.js middleware: cookies are read from the
// request, and any cookies Supabase writes (a token refresh) are set on BOTH the request (so the server
// components rendered after the proxy see the fresh tokens) and the response (so the browser stores them).
//
// `response` is a getter, not a snapshot: the response must be built after the request cookies were
// updated, so read it only after the auth call (`supabase.auth.getClaims()`), not by destructuring up front.
export function createMiddlewareSupabaseClient(request: NextRequest) {
  const { url, publishableKey } = getPublicSupabaseEnv();
  const written: CookieToSet[] = [];

  const supabase = createCookieClient({
    url,
    publishableKey,
    cookies: {
      getAll: () => request.cookies.getAll(),
      setAll: (cookiesToSet) => {
        // @supabase/ssr 0.12 never sets the Secure attribute itself (its defaults are path, sameSite=lax,
        // httpOnly=false, maxAge), so add it here whenever the request arrived over HTTPS. Next derives
        // the protocol from x-forwarded-proto behind a TLS-terminating proxy (Vercel, nginx), and local
        // http://localhost stays non-Secure so development sign-in keeps working.
        const secure = request.nextUrl.protocol === "https:";
        for (const { name, value, options } of cookiesToSet) {
          request.cookies.set(name, value);
          written.push({ name, value, options: { ...options, secure } });
        }
      },
    },
  });

  return {
    supabase,
    get response(): NextResponse {
      // NextResponse.next({ request }) forwards the (now updated) request cookies to the route.
      const response = NextResponse.next({ request });
      for (const { name, value, options } of written) {
        response.cookies.set(name, value, options);
      }
      return response;
    },
  };
}
