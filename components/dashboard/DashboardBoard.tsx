"use client";

import { useMemo, useState, type ReactNode } from "react";
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
import { computeExtendedKpis, revenueByStatus, ticketStatusSplit } from "@/lib/dashboard/metrics";
import type { dashboardVisibility } from "@/lib/dashboard/visibility";
import type { Lead } from "@/lib/leads/types";
import { leadRegion, filterLeadsByRegions, type RegionFacet } from "@/lib/geo/regions";
import { RegionScopeBar } from "@/components/dashboard/RegionScopeBar";

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
    <div className={"bg-surface border border-border rounded-lg p-4 " + className}>
      <div className="text-sm font-semibold text-text mb-3">{title}</div>
      {children}
    </div>
  );
}

export function DashboardBoard({
  leads,
  followUps,
  tickets,
  agentNameById,
  flags,
  visible,
  facets,
  now,
}: {
  leads: Lead[];
  followUps: FollowUpRow[];
  tickets: TicketRow[];
  agentNameById: Record<string, string>;
  flags: ReturnType<typeof dashboardVisibility>;
  visible: string[];
  facets: RegionFacet[];
  now: string;
}) {
  const [selected, setSelected] = useState<string[]>([]);
  const selSet = useMemo(() => new Set(selected), [selected]);

  const regionByLead = useMemo(() => {
    const m = new Map<string, string>();
    for (const l of leads) m.set(l.id, leadRegion(l));
    return m;
  }, [leads]);

  const fLeads = useMemo(() => filterLeadsByRegions(leads, selSet), [leads, selSet]);
  const fFollowUps = useMemo(
    () =>
      selSet.size === 0
        ? followUps
        : followUps.filter((f) => selSet.has(regionByLead.get(f.lead_id ?? "") ?? "Unknown")),
    [followUps, selSet, regionByLead]
  );
  const fTickets = useMemo(
    () =>
      selSet.size === 0
        ? tickets
        : tickets.filter((t) => selSet.has(regionByLead.get(t.lead_id ?? "") ?? "Unknown")),
    [tickets, selSet, regionByLead]
  );

  const kpis = computeKpis(fLeads);
  const ext = computeExtendedKpis(fLeads, fFollowUps, fTickets, new Date(now));
  const fvf = freshVsFollowup(fLeads);
  const siteData = bySiteType(fLeads);
  const freshTotal = fvf.fresh + fvf.followUp || 1;

  const showHero =
    flags.totalLeads ||
    flags.quotedRevenue ||
    (flags.ready && visible.includes("Ready")) ||
    flags.avgRating;

  return (
    <div className="space-y-5">
      <RegionScopeBar facets={facets} selected={selected} onChange={setSelected} />

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

      <StatGrid kpis={ext} show={flags} />

      {flags.statusStrip && <StatusStrip kpis={kpis} statuses={visible} />}

      {(flags.leadsOverTime || flags.pipelineByStatus) && (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
          {flags.leadsOverTime && (
            <ChartCard title="Leads over time" className="lg:col-span-2">
              <LeadsTrend data={leadsOverTime(fLeads)} />
            </ChartCard>
          )}
          {flags.pipelineByStatus && (
            <ChartCard title="Pipeline by status">
              <StatusDonut data={byStatus(fLeads)} />
              <Legend items={STATUS_LEGEND.filter((i) => visible.includes(i.name))} />
            </ChartCard>
          )}
        </div>
      )}

      {(flags.leadsByAgent || flags.siteTypeSplit || flags.ratingDistribution) && (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
          {flags.leadsByAgent && (
            <ChartCard title="Leads by agent">
              <LeadsByAgent data={byAgent(fLeads, agentNameById)} />
            </ChartCard>
          )}
          {flags.siteTypeSplit && (
            <ChartCard title="Site type split">
              <SiteTypeDonut data={siteData} />
              <Legend
                items={siteData.map((d, i) => ({
                  name: d.name,
                  color: SITE_PALETTE[i % SITE_PALETTE.length],
                }))}
              />
            </ChartCard>
          )}
          {flags.ratingDistribution && (
            <ChartCard title="Rating distribution">
              <RatingBars data={ratingDistribution(fLeads)} />
            </ChartCard>
          )}
        </div>
      )}

      {(flags.revenueByStatus || flags.ticketStatusSplit) && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          {flags.revenueByStatus && (
            <ChartCard title="Revenue by status">
              <RevenueByStatus data={revenueByStatus(fLeads).filter((d) => visible.includes(d.name))} />
            </ChartCard>
          )}
          {flags.ticketStatusSplit && (
            <ChartCard title="Ticket status split">
              <TicketStatusDonut data={ticketStatusSplit(fTickets)} />
            </ChartCard>
          )}
        </div>
      )}

      {flags.freshVsFollowup && (
        <ChartCard title="Fresh vs follow-up">
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
        </ChartCard>
      )}
    </div>
  );
}
