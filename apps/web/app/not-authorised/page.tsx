import { SignOutButton } from "@/components/sign-out-button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { createServerSupabaseClient } from "@/lib/supabase/server";

// Landing page for signed-in non-admins (agents who opened the dashboard). Public in proxy.ts, so it also
// renders for a signed-out visitor; the email line is simply omitted then.
export default async function NotAuthorisedPage() {
  const supabase = await createServerSupabaseClient();
  // Only the email is wanted, and a locally verified token carries it (auth-js checks the signature against
  // its process-cached key set); no Auth server round trip.
  let email: string | null = null;
  try {
    const { data } = await supabase.auth.getClaims();
    email = typeof data?.claims.email === "string" ? data.claims.email : null;
  } catch {
    // A cookie whose token auth-js cannot decode (see verifyLocally in lib/api/auth.ts) gets the
    // signed-out rendering rather than an error page.
  }

  return (
    <main className="flex flex-1 items-center justify-center p-6">
      <Card className="w-full max-w-sm">
        <CardHeader>
          <CardTitle>Not authorised</CardTitle>
          <CardDescription>
            This dashboard is for admins only. Field agents use the mobile app.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          {email ? (
            <p className="text-sm text-muted-foreground">
              Signed in as{" "}
              <span className="font-medium text-foreground">{email}</span>.
            </p>
          ) : null}
          <div>
            <SignOutButton />
          </div>
        </CardContent>
      </Card>
    </main>
  );
}
