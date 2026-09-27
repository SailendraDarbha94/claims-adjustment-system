import Link from "next/link";
import { CLAIM_STATUSES } from "@claims/shared";
import { STATUS_LABELS } from "@/components/status-badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { requireAdminPage } from "@/lib/api/page-auth";
import { formatDate } from "@/lib/format";
import { listAgentsWithCounts } from "@/lib/queries/admin";
import { createServerSupabaseClient } from "@/lib/supabase/server";

// Agents and their claim counts (brief: "no agent management beyond that for now"). Each name links to
// the claims table filtered to that agent.
export default async function AgentsPage() {
  const db = await createServerSupabaseClient();
  // The admin gate for this segment (docs/PLAN.md decision j): the layout's call does not stop this page
  // from rendering, so the page checks too. It runs concurrently with the page's own queries rather than
  // first, which is safe because RLS is what protects the data — a non-admin's queries return only rows
  // that user could read anyway (an agent: their own claims and own profile, nothing admin-only) — and
  // requireAdminPage()'s redirect is a thrown error that rejects the Promise.all, so none of it renders.
  // What the concurrency buys is one Supabase round trip less on the critical path.
  const [, agents] = await Promise.all([
    requireAdminPage(),
    listAgentsWithCounts(db),
  ]);

  return (
    <div className="flex flex-col gap-4">
      <h1 className="text-2xl font-semibold">Agents</h1>

      {agents.length === 0 ? (
        <p className="py-10 text-center text-sm text-muted-foreground">
          No agents have signed up yet.
        </p>
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Name</TableHead>
              {CLAIM_STATUSES.map((status) => (
                <TableHead key={status} className="text-right">
                  {STATUS_LABELS[status]}
                </TableHead>
              ))}
              <TableHead className="text-right">Total</TableHead>
              <TableHead>Joined</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {agents.map((agent) => (
              <TableRow key={agent.id}>
                <TableCell className="font-medium">
                  <Link
                    href={`/claims?agent_id=${agent.id}`}
                    className="hover:underline"
                  >
                    {agent.full_name || agent.id}
                  </Link>
                </TableCell>
                {CLAIM_STATUSES.map((status) => (
                  <TableCell key={status} className="text-right tabular-nums">
                    {agent.counts[status]}
                  </TableCell>
                ))}
                <TableCell className="text-right font-medium tabular-nums">
                  {agent.total}
                </TableCell>
                <TableCell>{formatDate(agent.created_at)}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
    </div>
  );
}
