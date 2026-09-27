import Link from "next/link";
import { SignOutButton } from "@/components/sign-out-button";
import { requireAdminPage } from "@/lib/api/page-auth";

// Every admin page lives under this layout. proxy.ts only checks that a session exists (docs/PLAN.md
// decision j, amended 2026-09-27), so this is the first admin check, for the layout's own render. It does
// not stop the page segment from rendering, so each page calls requireAdminPage() too (deduped per request).
export default async function AdminLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const { user, profile } = await requireAdminPage();
  const displayName = profile.full_name || user.email || "Admin";

  return (
    <div className="flex min-h-full flex-1 flex-col">
      <header className="border-b">
        <div className="mx-auto flex w-full max-w-6xl items-center gap-6 px-6 py-3">
          <Link href="/" className="font-semibold">
            Claims Admin
          </Link>
          <nav className="flex items-center gap-4 text-sm">
            {/* The brand link points here too; the explicit item is what makes the overview discoverable. */}
            <Link href="/" className="hover:underline">
              Overview
            </Link>
            <Link href="/claims" className="hover:underline">
              Claims
            </Link>
            <Link href="/agents" className="hover:underline">
              Agents
            </Link>
          </nav>
          <div className="ml-auto flex items-center gap-3 text-sm">
            <span className="text-muted-foreground">{displayName}</span>
            <SignOutButton />
          </div>
        </div>
      </header>
      <main className="mx-auto w-full max-w-6xl flex-1 px-6 py-6">
        {children}
      </main>
    </div>
  );
}
