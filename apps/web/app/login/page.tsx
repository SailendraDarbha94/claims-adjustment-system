"use client";

import { useState, type FormEvent } from "react";
import { toast } from "sonner";
import { LoginProgress, type LoginPhase } from "@/components/login-progress";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { createBrowserSupabaseClient } from "@/lib/supabase/browser";

// Email/password sign-in against Supabase Auth directly (docs/PLAN.md decision u). @supabase/ssr writes
// the session cookies; proxy.ts then sends any signed-in user on /login to "/" (the overview), and it is
// requireAdminPage() in the (admin) layout and page that sends a non-admin on to /not-authorised (decision
// j, amended 2026-09-27). This page navigates to the same "/", so the two cannot disagree and bounce.
export default function LoginPage() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  // An honest three-state phase rather than one `pending` flag: the two waits have very different
  // lengths and causes, and the overlay says which one the user is in. See components/login-progress.tsx.
  const [phase, setPhase] = useState<LoginPhase>("idle");
  const busy = phase !== "idle";

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setPhase("authenticating");
    setError(null);

    try {
      // Created in the handler, not at module scope: the env check must not run during prerendering.
      const supabase = createBrowserSupabaseClient();
      const { error: signInError } = await supabase.auth.signInWithPassword({
        email,
        password,
      });
      if (signInError) {
        // Inline text is the always-visible, accessible signal; the toast is the extra nudge for
        // someone whose eyes are on the button rather than on the field.
        setError(signInError.message);
        toast.error("Could not sign in", { description: signInError.message });
        setPhase("idle");
        return;
      }
    } catch (caught) {
      const message = caught instanceof Error ? caught.message : String(caught);
      setError(message);
      toast.error("Could not sign in", { description: message });
      setPhase("idle");
      return;
    }

    // Sign-in is done; everything from here is the browser fetching "/", which is the long part.
    setPhase("redirecting");
    // The toaster lives in the root layout, so this survives the navigation below.
    toast.success("Signed in");
    // The overview at "/", not /claims: that is the admin home now, and it is what the overlay's
    // "loading your dashboard…" names. proxy.ts sends a signed-in admin on /login to the same path.
    //
    // A full document navigation rather than router.replace(): a client transition does not commit until
    // the whole RSC payload has been fetched (the proxy's session check, then the page's profile and dashboard
    // queries — measured at ~4 s warm and ~12 s on a cold function), and until then the browser stays on
    // this page with the button disabled and nothing moving, which reads as a hang. Handing the
    // navigation to the browser shows its own progress immediately, streams the dashboard's loading
    // skeleton as the server renders, and tears this page down so the pending state cannot get stuck.
    // It also guarantees the request carries the cookies @supabase/ssr just wrote, with no router cache
    // to invalidate afterwards.
    // eslint-disable-next-line @next/next/no-location-assign-relative-destination -- deliberate: see above.
    window.location.assign("/");
  }

  return (
    <main className="flex flex-1 items-center justify-center p-6">
      {/* `relative` so LoginProgress can cover the card; the card already clips to its own rounding. */}
      <Card className="relative w-full max-w-sm">
        <CardHeader>
          <CardTitle>Claims Admin</CardTitle>
          <CardDescription>Sign in with your admin account.</CardDescription>
        </CardHeader>
        <CardContent>
          {/* `inert` while busy: the form stays visible under the overlay but cannot be typed into,
              tabbed to or submitted again, so the covered controls are not reachable by keyboard. */}
          <form
            onSubmit={onSubmit}
            inert={busy}
            className="flex flex-col gap-4"
          >
            <div className="flex flex-col gap-2">
              <Label htmlFor="email">Email</Label>
              <Input
                id="email"
                name="email"
                type="email"
                autoComplete="email"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
              />
            </div>
            <div className="flex flex-col gap-2">
              <Label htmlFor="password">Password</Label>
              <Input
                id="password"
                name="password"
                type="password"
                autoComplete="current-password"
                required
                value={password}
                onChange={(e) => setPassword(e.target.value)}
              />
            </div>
            {error ? (
              <p role="alert" className="text-sm text-destructive">
                {error}
              </p>
            ) : null}
            <Button type="submit" disabled={busy}>
              {busy ? "Signing in…" : "Sign in"}
            </Button>
          </form>
        </CardContent>
        <LoginProgress phase={phase} />
      </Card>
    </main>
  );
}
