import { createClient } from "@supabase/supabase-js";
import type { Database } from "./types";

export type BearerSupabaseClient = ReturnType<typeof createBearerClient>;

// For route handlers: a client acting as the caller whose JWT arrived in the Authorization header.
// RLS applies exactly as it would for that user. No session persistence or refresh: the handler lives for one
// request and the client (mobile or browser) owns the session. Verify the token before trusting it:
// `client.auth.getClaims(accessToken)` checks the signature locally against the project's key set (fetched
// once per process by auth-js and cached for 10 minutes), `client.auth.getUser(accessToken)` asks the Auth
// server and also sees revocation; the web app's lib/api/auth.ts chooses between them per handler.
export function createBearerClient(opts: {
  url: string;
  publishableKey: string;
  accessToken: string;
}) {
  return createClient<Database>(opts.url, opts.publishableKey, {
    global: { headers: { Authorization: `Bearer ${opts.accessToken}` } },
    auth: {
      persistSession: false,
      autoRefreshToken: false,
      detectSessionInUrl: false,
    },
  });
}
