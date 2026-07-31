"use client";

import { useMemo, useState, type ReactNode } from "react";
import { FilterX, Users } from "lucide-react";
import { KpiHero } from "@/components/dashboard/KpiHero";
import { StatusStrip } from "@/components/dashboard/StatusStrip";
import { StatGrid } from "@/components/dashboard/StatGrid";
import {
  LeadsTrend,
  LeadsByAgent,
  StatusDonut,
  SiteTypeDonut,
  RatingBars,
  Legend,
  RevenueByStatus,
  TicketStatusDonut,
} from "@/components/dashboard/Charts";
import { STATUS_LEGEND, SITE_PALETTE } from "@/lib/dashboard/palette";
import {
  computeKpis,
  byStatus,
  byAgent,
  bySiteType,
  ratingDistribution,
  leadsOverTime,
  freshVsFollowup,
} from "@/lib/leads/analytics";
import {
  computeExtendedKpis,
  computeVelocityKpis,
  revenueByStatus,
  ticketStatusSplit,
} from "@/lib/dashboard/metrics";
import type { dashboardVisibility } from "@/lib/dashboard/visibility";
import type { Lead } from "@/lib/leads/types";
import { filterLeadsByRegions, type RegionFacet } from "@/lib/geo/regions";
import { RegionFilter } from "@/components/leads/RegionFilter";
import { useViewState } from "@/hooks/useViewState";
import { MonthFilter } from "@/components/common/MonthFilter";
import { Select } from "@/components/common/Select";
import { monthOptions, inMonth } from "@/lib/analytics/dateScope";

type FollowUpRow = { fu_status: string; lead_id: string | null };
type TicketRow = {
  status: string;
  due_date: string | null;
  created_at: string;
  resolved_at: string | null;
  lead_id: string | null;
};

function ChartCard({ title, children, className = "" }: { title: string; children: ReactNode; className?: string }) {
  return (
    <div className={"bg-surface border border-border rounded-lg p-3 " + className}>
      <div className="text-sm font-semibold text-text mb-3">{title}</div>
      {children}
    </div>
  );
}

/** Static span→class map — Tailwind can't see dynamically built class strings. */
const SPAN: Record<number, string> = {
  2: "lg:col-span-2",
  3: "lg:col-span-3",
  4: "lg:col-span-4",
  6: "lg:col-span-6",
};

const DASH_DEFAULTS = { month: "" };

export function DashboardBoard({
  leads,
  followUps,
  tickets,
  agentNameById,
  flags,
  visible,
  facets,
  now,
  canScopeMonth,
  salesUsers,
}: {
  leads: Lead[];
  followUps: FollowUpRow[];
  tickets: TicketRow[];
  agentNameById: Record<string, string>;
  flags: ReturnType<typeof dashboardVisibility>;
  visible: string[];
  facets: RegionFacet[];
  now: string;
  canScopeMonth: boolean;
  salesUsers: { id: string; display_name: string }[];
}) {
  const [selected, setSelected] = useState<string[]>([]);
  const selSet = useMemo(() => new Set(selected), [selected]);

  // Ephemeral, session-scoped per-agent analytics filter (admins only). Not
  // persisted to view state on purpose.
  const [agentId, setAgentId] = useState("");

  const [dashUrl, setDashUrl] = useViewState(DASH_DEFAULTS);
  const month = canScopeMonth ? dashUrl.month : "";
  const monthOpts = useMemo(() => monthOptions(leads), [leads]);
  const scoping = selSet.size > 0 || month !== "" || agentId !== "";

  const fLeads = useMemo(
    () =>
      filterLeadsByRegions(leads, selSet)
        .filter((l) => inMonth(l.created_at, month))
        .filter((l) => !agentId || l.agent_id === agentId),
    [leads, selSet, month, agentId]
  );
  const scopedIds = useMemo(() => new Set(fLeads.map((l) => l.id)), [fLeads]);
  const fFollowUps = useMemo(
    () => (!scoping ? followUps : followUps.filter((f) => scopedIds.has(f.lead_id ?? ""))),
    [followUps, scoping, scopedIds]
  );
  const fTickets = useMemo(
    () => (!scoping ? tickets : tickets.filter((t) => scopedIds.has(t.lead_id ?? ""))),
    [tickets, scoping, scopedIds]
  );

  const kpis = computeKpis(fLeads);
  const ext = computeExtendedKpis(fLeads, fFollowUps, fTickets, new Date(now));

  // Velocity KPIs scope by closed_at/dropped_at, so they get region+agent
  // filtering but NOT the created_at month filter — the month is applied
  // internally to the right timestamp.
  const fLeadsAllTime = useMemo(
    () => filterLeadsByRegions(leads, selSet).filter((l) => !agentId || l.agent_id === agentId),
    [leads, selSet, agentId]
  );
  const velocity = computeVelocityKpis(fLeadsAllTime, month);

  const fvf = freshVsFollowup(fLeads);
  const siteData = bySiteType(fLeads);
  const freshTotal = fvf.fresh + fvf.followUp || 1;

  const showHero =
    flags.totalLeads ||
    flags.quotedRevenue ||
    (flags.ready && visible.includes("Ready")) ||
    flags.avgRating;

  const charts = [
    {
      key: "leadsOverTime",
      show: flags.leadsOverTime,
      span: 4,
      title: "Leads over time",
      node: <LeadsTrend data={leadsOverTime(fLeads)} />,
    },
    {
      key: "pipelineByStatus",
      show: flags.pipelineByStatus,
      span: 2,
      title: "Pipeline by status",
      node: (
        <>
          <StatusDonut data={byStatus(fLeads)} />
          <Legend items={STATUS_LEGEND.filter((i) => visible.includes(i.name))} />
        </>
      ),
    },
    {
      key: "leadsByAgent",
      show: flags.leadsByAgent,
      span: 2,
      title: "Leads by agent",
      node: <LeadsByAgent data={byAgent(fLeads, agentNameById)} />,
    },
    {
      key: "siteTypeSplit",
      show: flags.siteTypeSplit,
      span: 2,
      title: "Site type split",
      node: (
        <>
          <SiteTypeDonut data={siteData} />
          <Legend
            items={siteData.map((d, i) => ({
              name: d.name,
              color: SITE_PALETTE[i % SITE_PALETTE.length],
            }))}
          />
        </>
      ),
    },
    {
      key: "ratingDistribution",
      show: flags.ratingDistribution,
      span: 2,
      title: "Rating distribution",
      node: <RatingBars data={ratingDistribution(fLeads)} />,
    },
    {
      key: "revenueByStatus",
      show: flags.revenueByStatus,
      span: 3,
      title: "Revenue by status",
      node: <RevenueByStatus data={revenueByStatus(fLeads).filter((d) => visible.includes(d.name))} />,
    },
    {
      key: "ticketStatusSplit",
      show: flags.ticketStatusSplit,
      span: 3,
      title: "Ticket status split",
      node: <TicketStatusDonut data={ticketStatusSplit(fTickets)} />,
    },
    {
      key: "freshVsFollowup",
      show: flags.freshVsFollowup,
      span: 6,
      title: "Fresh vs follow-up",
      node: (
        <>
          <div className="flex items-center gap-4">
            <div className="flex-1 h-3 rounded-full overflow-hidden bg-border-subtle flex">
              <div className="h-full bg-accent" style={{ width: `${(fvf.fresh / freshTotal) * 100}%` }} />
              <div className="h-full bg-longterm-fg" style={{ width: `${(fvf.followUp / freshTotal) * 100}%` }} />
            </div>
          </div>
          <div className="flex gap-6 mt-3 text-sm">
            <span className="flex items-center gap-2 text-text-muted">
              <span className="w-2.5 h-2.5 rounded-sm bg-accent" /> Fresh
              <span className="font-mono text-text">{fvf.fresh}</span>
            </span>
            <span className="flex items-center gap-2 text-text-muted">
              <span className="w-2.5 h-2.5 rounded-sm bg-longterm-fg" /> Follow Up
              <span className="font-mono text-text">{fvf.followUp}</span>
            </span>
          </div>
        </>
      ),
    },
  ].filter((c) => c.show);

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center gap-2">
        {canScopeMonth && <MonthFilter options={monthOpts} value={month} onChange={(v) => setDashUrl({ month: v })} />}
        {canScopeMonth && (
          <label className="inline-flex items-center gap-1.5 px-3 py-2 rounded-md border border-border bg-surface text-sm text-text-muted focus-within:ring-2 focus-within:ring-accent">
            <Users className="w-4 h-4 shrink-0" />
            <Select
              value={agentId}
              onChange={(e) => setAgentId(e.target.value)}
              className="bg-transparent outline-none text-sm text-text-muted"
            >
              <option value="">All agents</option>
              {salesUsers.map((u) => (
                <option key={u.id} value={u.id}>
                  {u.display_name}
                </option>
              ))}
            </Select>
          </label>
        )}
        <RegionFilter facets={facets} selected={selected} onChange={setSelected} />
        {(month !== "" || selected.length > 0 || agentId !== "") && (
          <button
            type="button"
            onClick={() => {
              setDashUrl({ month: "" });
              setSelected([]);
              setAgentId("");
            }}
            className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-md border border-dropped-fg/40 text-sm text-dropped-fg hover:bg-dropped-bg whitespace-nowrap"
          >
            <FilterX className="w-4 h-4" /> Clear filters
          </button>
        )}
      </div>

      <div>
        <h1 className="text-xl font-semibold text-text">Dashboard</h1>
        {flags.totalLeads && (
          <p className="text-sm text-text-muted mt-0.5">
            {kpis.total} active {kpis.total === 1 ? "lead" : "leads"} across the pipeline
          </p>
        )}
      </div>

      {showHero && (
        <KpiHero
          kpis={kpis}
          show={{
            totalLeads: flags.totalLeads,
            quotedRevenue: flags.quotedRevenue,
            ready: flags.ready && visible.includes("Ready"),
            avgRating: flags.avgRating,
          }}
        />
      )}

      <StatGrid kpis={ext} velocity={velocity} show={flags} />

      {flags.statusStrip && <StatusStrip kpis={kpis} statuses={visible} />}

      {charts.length > 0 && (
        <div className="grid grid-cols-1 lg:grid-cols-6 gap-4">
          {charts.map((c) => (
            <ChartCard key={c.key} title={c.title} className={SPAN[c.span]}>
              {c.node}
            </ChartCard>
          ))}
        </div>
      )}
    </div>
  );
}
