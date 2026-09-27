import Link from "next/link";
import { notFound } from "next/navigation";
import { z } from "zod";
import { ClaimActions } from "@/components/claim-actions";
import { ClaimTimeline } from "@/components/claim-timeline";
import { DetailsKv } from "@/components/details-kv";
import { FileGallery } from "@/components/file-gallery";
import { NotesPanel } from "@/components/notes-panel";
import { StatusBadge } from "@/components/status-badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { requireAdminPage } from "@/lib/api/page-auth";
import { formatDate, formatDateTime } from "@/lib/format";
import {
  getAdminClaimDetail,
  listAgentRefs,
  profileRefsById,
} from "@/lib/queries/admin";
import { createServerSupabaseClient } from "@/lib/supabase/server";

// Server-rendered claim detail (docs/PLAN.md §1): everything the admin needs to act, read through the
// cookie client under the admin RLS policies. Mutations live in <ClaimActions> (client), which calls the
// /api/admin routes and then router.refresh() so this component re-renders with the new data.
export default async function ClaimDetailPage({
  params,
}: PageProps<"/claims/[id]">) {
  const { id } = await params;
  // A non-uuid id would make Postgres raise 22P02; treat it as "no such claim" instead of a 500.
  if (!z.uuid().safeParse(id).success) notFound();

  const db = await createServerSupabaseClient();
  // The admin gate for this segment (docs/PLAN.md decision j): the layout's call does not stop this page
  // from rendering, so the page checks too. It runs concurrently with the page's own queries rather than
  // first, which is safe because RLS is what protects the data — a non-admin's queries return only rows
  // that user could read anyway (an agent: their own claims and own profile, nothing admin-only) — and
  // requireAdminPage()'s redirect is a thrown error that rejects the Promise.all, so none of it renders.
  // What the concurrency buys is one Supabase round trip less on the critical path.
  const [, claim, agents] = await Promise.all([
    requireAdminPage(),
    getAdminClaimDetail(db, id),
    listAgentRefs(db),
  ]);
  if (!claim) notFound();

  // One lookup for every person named on the page: note authors, event actors, and the from/to ids in
  // `assigned` event payloads. Ids RLS hides (none, for an admin) simply fall back to "Unknown user".
  const people = await profileRefsById(db, [
    ...claim.notes.map((note) => note.author_id),
    ...claim.events.flatMap((event) => {
      const ids = event.actor_id ? [event.actor_id] : [];
      if (event.event_type === "assigned") {
        for (const key of ["from", "to"] as const) {
          const value = event.payload[key];
          if (typeof value === "string") ids.push(value);
        }
      }
      return ids;
    }),
  ]);

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-2">
        <Link
          href="/claims"
          className="text-sm text-muted-foreground hover:underline"
        >
          ← All claims
        </Link>
        <div className="flex flex-wrap items-center gap-3">
          <h1 className="text-2xl font-semibold break-words">{claim.title}</h1>
          <StatusBadge status={claim.status} />
        </div>
        <dl className="grid grid-cols-2 gap-x-6 gap-y-1 text-sm sm:grid-cols-3 lg:grid-cols-6">
          <Meta label="Type" value={claim.claim_type} />
          <Meta
            label="Agent"
            value={
              <Link
                href={`/claims?agent_id=${claim.agent.id}`}
                className="hover:underline"
              >
                {claim.agent.full_name || claim.agent.id}
              </Link>
            }
          />
          <Meta
            label="Assignee"
            value={
              claim.assignee
                ? claim.assignee.full_name || claim.assignee.id
                : "Unassigned"
            }
          />
          <Meta label="Created" value={formatDateTime(claim.created_at)} />
          <Meta label="Updated" value={formatDateTime(claim.updated_at)} />
          <Meta
            label="Claim id"
            value={<code className="text-xs">{claim.id}</code>}
          />
        </dl>
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
        <div className="flex min-w-0 flex-col gap-6">
          <Card>
            <CardHeader>
              <CardTitle>Claim</CardTitle>
            </CardHeader>
            <CardContent className="flex flex-col gap-4">
              <dl className="grid grid-cols-1 gap-x-6 gap-y-2 text-sm sm:grid-cols-3">
                <Meta
                  label="Incident date"
                  value={
                    claim.incident_date ? formatDate(claim.incident_date) : "—"
                  }
                />
                <Meta
                  label="Policy number"
                  value={claim.policy_number || "—"}
                />
                <Meta label="Claimant" value={claim.claimant_name || "—"} />
              </dl>
              <div>
                <h3 className="mb-1 text-sm font-medium">Description</h3>
                {claim.description ? (
                  <p className="text-sm break-words whitespace-pre-wrap">
                    {claim.description}
                  </p>
                ) : (
                  <p className="text-sm text-muted-foreground">
                    No description.
                  </p>
                )}
              </div>
              <div>
                <h3 className="mb-1 text-sm font-medium">Details</h3>
                <DetailsKv details={claim.details} />
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Files ({claim.files.length})</CardTitle>
            </CardHeader>
            <CardContent>
              <FileGallery files={claim.files} />
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Notes ({claim.notes.length})</CardTitle>
            </CardHeader>
            <CardContent>
              <NotesPanel notes={claim.notes} authors={people} />
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Timeline</CardTitle>
            </CardHeader>
            <CardContent>
              <ClaimTimeline events={claim.events} people={people} />
            </CardContent>
          </Card>
        </div>

        <aside className="min-w-0">
          <ClaimActions
            claimId={claim.id}
            status={claim.status}
            assignedTo={claim.assigned_to}
            agents={agents}
          />
        </aside>
      </div>
    </div>
  );
}

function Meta({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="min-w-0">
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className="truncate">{value}</dd>
    </div>
  );
}
