import { CLAIM_STATUSES, CLAIM_TYPES } from "@claims/shared";
import {
  AgentBars,
  type AgentBarRow,
  type AgentBarSeries,
} from "@/components/dashboard/agent-bars";
import { ChartCard } from "@/components/dashboard/chart-card";
import { CreatedOverTime } from "@/components/dashboard/created-over-time";
import { STATUS_COLORS } from "@/components/dashboard/palette";
import { StatTiles, type StatTile } from "@/components/dashboard/stat-tiles";
import {
  StatusDonut,
  type StatusSlice,
} from "@/components/dashboard/status-donut";
import { TypeBars } from "@/components/dashboard/type-bars";
import { STATUS_LABELS } from "@/components/status-badge";
import { requireAdminPage } from "@/lib/api/page-auth";
import { formatDate, formatDateTime } from "@/lib/format";
import { getDashboardMetrics } from "@/lib/queries/admin";
import { createServerSupabaseClient } from "@/lib/supabase/server";

// The dashboard home page. This file lives in the (admin) route group, so it serves "/" (route groups do
// not appear in the URL) while inheriting app/(admin)/layout.tsx and its admin gate. /claims keeps the
// working table; this page is the read-only overview.
//
// Everything below is computed here, in the Server Component: the chart components are "use client" only
// because Recharts needs the DOM, and they receive plain aggregated numbers, labels and colours.
//
// One rule runs through the copy: every number on this page says which population it describes. The read
// behind it can be capped (see getDashboardMetrics), and when it is, `total` is the only exact figure —
// so the tiles switch to the sampled population rather than sitting next to an all-time number they do
// not reconcile with.

// How many agents the per-agent chart shows before the stack stops being readable.
const AGENTS_SHOWN = 8;

// The statuses that mean "still on someone's desk", for the "Open" tile.
const OPEN_STATUSES = ["submitted", "under_review", "info_requested"] as const;

// profiles.full_name is NOT NULL DEFAULT '', so an agent can legitimately have no name. The claims table
// shows that as an empty cell; a chart axis cannot, so the bar gets this instead.
const UNNAMED_AGENT = "Unnamed agent";

export default async function OverviewPage() {
  const db = await createServerSupabaseClient();
  // The admin gate for this segment (docs/PLAN.md decision j): the layout's call does not stop this page
  // from rendering, so the page checks too. It runs concurrently with the page's own queries rather than
  // first, which is safe because RLS is what protects the data — a non-admin's queries return only rows
  // that user could read anyway (an agent: their own claims and own profile, nothing admin-only) — and
  // requireAdminPage()'s redirect is a thrown error that rejects the Promise.all, so none of it renders.
  // What the concurrency buys is one Supabase round trip less on the critical path.
  const [, metrics] = await Promise.all([
    requireAdminPage(),
    getDashboardMetrics(db),
  ]);

  // True when the single read was capped, i.e. everything except `total` describes the most recent
  // `sampled` claims rather than all of them.
  const truncated = metrics.sampled < metrics.total;

  const open = OPEN_STATUSES.reduce(
    (sum, status) => sum + metrics.byStatus[status],
    0,
  );
  const tiles: StatTile[] = [
    {
      label: "Total claims",
      // Deliberately not `total` when truncated: the other three tiles are counted from the sample, and
      // four tiles in a row must be four slices of the same pie. The exact total is in the banner.
      value: truncated ? metrics.sampled : metrics.total,
      hint: truncated ? `The most recent of ${metrics.total}` : "All time",
    },
    {
      label: "Open",
      value: open,
      hint: "Submitted, under review or info requested",
    },
    {
      label: "Approved",
      value: metrics.byStatus.approved,
      hint: "Closed successfully",
    },
    {
      label: "Rejected",
      value: metrics.byStatus.rejected,
      hint: "Closed without payout",
    },
  ];

  // Every status, in the enum's order, so the legend is stable and a status with no claims still shows a 0.
  const statusSlices: StatusSlice[] = CLAIM_STATUSES.map((status) => ({
    name: STATUS_LABELS[status],
    value: metrics.byStatus[status],
    fill: STATUS_COLORS[status],
  }));

  const typeBars = metrics.byType.map((entry) => ({
    name: entry.type,
    value: entry.count,
  }));

  // Axis labels have to be both non-empty and unique, or a bar cannot be read back to a person: the chart
  // rows are identified by their label. Blank names get a placeholder, and a name shared by two agents in
  // the shown set gets a short id suffix. Counts are unaffected — those are keyed on agent_id upstream.
  const shownAgents = metrics.byAgent.slice(0, AGENTS_SHOWN);
  const labelUses = new Map<string, number>();
  for (const agent of shownAgents) {
    const base = agent.name.trim() || UNNAMED_AGENT;
    labelUses.set(base, (labelUses.get(base) ?? 0) + 1);
  }
  const agentRows: AgentBarRow[] = shownAgents.map((agent) => {
    const base = agent.name.trim() || UNNAMED_AGENT;
    const label =
      (labelUses.get(base) ?? 0) > 1
        ? `${base} · ${agent.id.slice(0, 8)}`
        : base;
    return { agent: label, ...agent.counts };
  });
  const agentSeries: AgentBarSeries[] = CLAIM_STATUSES.map((status) => ({
    status,
    label: STATUS_LABELS[status],
    color: STATUS_COLORS[status],
  }));

  // Labels come from lib/format.ts (en-GB, UTC) so the axis text is identical on the server and in every
  // browser; the client chart never sees a Date.
  const weekBars = metrics.createdByWeek.map((week) => ({
    label: formatDate(week.start),
    value: week.count,
  }));

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-1">
        <h1 className="text-2xl font-semibold">Overview</h1>
        <p className="text-sm text-muted-foreground">
          {/* The newest updated_at is taken from the same capped, created_at-ordered read, so an old claim
              touched today can be outside it. When that is possible the sentence says which claims it
              looked at instead of asserting a last-activity time for the whole table. */}
          {metrics.lastActivityAt === null
            ? "No claims have been created yet."
            : truncated
              ? `Last activity among the ${metrics.sampled} most recent claims: ${formatDateTime(metrics.lastActivityAt)}.`
              : `Last claim activity ${formatDateTime(metrics.lastActivityAt)}.`}
        </p>
      </div>

      {truncated ? (
        // Honest about the one limit of a single un-aggregated read (see getDashboardMetrics). "Figures
        // and charts" because it covers the stat tiles below it as well, not only the charts.
        <p role="status" className="text-sm text-amber-700 dark:text-amber-400">
          The figures and charts below cover the {metrics.sampled} most recent
          claims of {metrics.total}.
        </p>
      ) : null}

      <StatTiles tiles={tiles} />

      <div className="grid gap-4 md:grid-cols-2">
        <ChartCard
          title="Claims by status"
          description={
            truncated
              ? `Where the ${metrics.sampled} most recent claims currently sit in the workflow.`
              : "Where every claim currently sits in the workflow."
          }
          isEmpty={metrics.total === 0}
        >
          <StatusDonut data={statusSlices} />
        </ChartCard>

        <ChartCard
          title="Claims by type"
          description={
            metrics.otherTypes > 0
              ? `The ${CLAIM_TYPES.length} standard types and the most common others; ${metrics.otherTypes} rarer values are grouped as "Other".`
              : `Counts for the ${CLAIM_TYPES.length} standard types, plus anything else agents have filed.`
          }
          isEmpty={metrics.total === 0}
        >
          <TypeBars data={typeBars} />
        </ChartCard>

        <ChartCard
          className="md:col-span-2"
          title="Claims per agent"
          // "Agents with claims", not "agents": byAgent only contains agents that own at least one claim
          // in the sample, so this count is smaller than the /agents page's list of every agent profile.
          description={
            metrics.byAgent.length > AGENTS_SHOWN
              ? `The ${AGENTS_SHOWN} busiest of ${metrics.byAgent.length} agents with claims, stacked by status.`
              : "Every agent who has filed a claim, stacked by status."
          }
          isEmpty={agentRows.length === 0}
          emptyLabel="No agent has filed a claim yet"
        >
          <AgentBars data={agentRows} series={agentSeries} />
        </ChartCard>

        <ChartCard
          className="md:col-span-2"
          title="Claims created over time"
          // The last bucket is the week we are in, so on any day but Sunday it is a partial week next to
          // eleven whole ones. Saying so is cheaper — and more honest — than hiding or restyling the bar.
          description={`New claims per week over the last ${metrics.createdByWeek.length} weeks (weeks start on Monday, UTC); the final week is still in progress.`}
          isEmpty={metrics.total === 0}
        >
          <CreatedOverTime data={weekBars} />
        </ChartCard>
      </div>
    </div>
  );
}
