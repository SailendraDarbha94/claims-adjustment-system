import { redirect } from "next/navigation";
import { adminClaimsQuerySchema } from "@claims/shared";
import { ClaimsFilters } from "@/components/claims-filters";
import { ClaimsTable } from "@/components/claims-table";
import { Pagination } from "@/components/pagination";
import { requireAdminPage } from "@/lib/api/page-auth";
import { claimsListHref } from "@/lib/claims-url";
import { listAdminClaims, listAgentRefs } from "@/lib/queries/admin";
import { createServerSupabaseClient } from "@/lib/supabase/server";

// Server-rendered claims table (docs/PLAN.md §1, decision k). The URL's search params are the only
// state: parsed with the same adminClaimsQuerySchema as GET /api/admin/claims, then listAdminClaims runs
// over the cookie client so RLS (is_admin()) applies exactly as it does for the API.
export default async function ClaimsPage({
  searchParams,
}: PageProps<"/claims">) {
  const parsed = adminClaimsQuerySchema.safeParse(
    lastValues(await searchParams),
  );
  // A hand-edited or stale URL (unknown status, malformed date) falls back to the defaults with a notice
  // rather than a 500 or an error page.
  const query = parsed.success ? parsed.data : adminClaimsQuerySchema.parse({});

  const db = await createServerSupabaseClient();
  // The admin gate for this segment (docs/PLAN.md decision j): the layout's call does not stop this page
  // from rendering, so the page checks too. It runs concurrently with the page's own queries rather than
  // first, which is safe because RLS is what protects the data — a non-admin's queries return only rows
  // that user could read anyway (an agent: their own claims and own profile, nothing admin-only) — and
  // requireAdminPage()'s redirect is a thrown error that rejects the Promise.all, so none of it renders.
  // What the concurrency buys is one Supabase round trip less on the critical path.
  const [, claims, agents] = await Promise.all([
    requireAdminPage(),
    listAdminClaims(db, query),
    listAgentRefs(db),
  ]);

  // A `page` past the last page (a bookmarked link whose filters now match fewer rows) is a stale URL too.
  // With `count: "exact"` PostgREST answers 416 / PGRST103 when the offset is past the count (offset > total)
  // and an empty page when offset == total; listAdminClaims turns both into an empty page, and both go back
  // to page 1 instead of a 500 or an empty table under "Page 7 of 2". Page 1 has offset 0, so the redirect
  // cannot loop. It runs after the Promise.all rather than inside it so that the auth redirect is the only
  // one that can come out of the concurrent block: a non-admin always lands on /not-authorised, never on
  // ?page=1 on the way there because the claims query happened to settle before requireAdminPage().
  if (query.page > 1 && claims.data.length === 0) {
    redirect(claimsListHref(query, { page: 1 }));
  }

  return (
    <div className="flex flex-col gap-4">
      <h1 className="text-2xl font-semibold">Claims</h1>

      {parsed.success ? null : (
        <p role="status" className="text-sm text-amber-700">
          Some filters in the URL were not valid and have been ignored.
        </p>
      )}

      <ClaimsFilters query={query} agents={agents} />

      {claims.data.length === 0 ? (
        <p className="py-10 text-center text-sm text-muted-foreground">
          No claims match these filters.
        </p>
      ) : (
        <ClaimsTable claims={claims.data} query={query} />
      )}

      <Pagination query={query} total={claims.total} />
    </div>
  );
}

// searchParams values are string | string[] | undefined; a repeated key keeps its last value, which is
// what URLSearchParams-based parseQuery does for the API, so the two parse identically.
function lastValues(
  params: Record<string, string | string[] | undefined>,
): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(params)) {
    const last = Array.isArray(value) ? value[value.length - 1] : value;
    if (last !== undefined) out[key] = last;
  }
  return out;
}
