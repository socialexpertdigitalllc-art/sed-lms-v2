import { createClient } from "@/lib/supabase/server";
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
import { dashboardVisibility, anyDashboardVisible } from "@/lib/dashboard/visibility";
import type { Lead } from "@/lib/leads/types";
import { getUserPermissions } from "@/lib/permissions/resolver";
import { visibleStatuses } from "@/lib/leads/categories";

function ChartCard({
  title,
  children,
  className = "",
}: {
  title: string;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={"bg-surface border border-border rounded-lg p-4 " + className}>
      <div className="text-sm font-semibold text-text mb-3">{title}</div>
      {children}
    </div>
  );
}

export default async function DashboardPage() {
  const supabase = await createClient();
  const { data: leadsData } = await supabase
    .from("leads")
    .select("*")
    .is("deleted_at", null);
  const leads = (leadsData ?? []) as Lead[];

  const { data: agents } = await supabase.from("profiles").select("id, display_name");
  const agentNameById: Record<string, string> = {};
  for (const a of agents ?? []) agentNameById[a.id] = a.display_name ?? "—";

  const { data: followUps } = await supabase.from("lead_follow_ups").select("fu_status");
  const { data: tickets } = await supabase
    .from("lead_tickets")
    .select("status, due_date, created_at, resolved_at");

  const { data: { user } } = await supabase.auth.getUser();
  const perms = user ? await getUserPermissions(user.id) : new Set<string>();
  const visible: string[] = visibleStatuses(perms);
  const flags = dashboardVisibility(perms);

  const kpis = computeKpis(leads);
  const ext = computeExtendedKpis(leads, followUps ?? [], tickets ?? [], new Date());
  const fvf = freshVsFollowup(leads);
  const siteData = bySiteType(leads);
  const freshTotal = fvf.fresh + fvf.followUp || 1;

  if (!anyDashboardVisible(flags)) {
    return (
      <div className="space-y-5">
        <div>
          <h1 className="text-xl font-semibold text-text">Dashboard</h1>
        </div>
        <div className="bg-surface border border-border rounded-lg p-10 text-center text-sm text-text-muted">
          No dashboard widgets are enabled for you. Ask an admin to grant dashboard permissions.
        </div>
      </div>
    );
  }

  const showHero =
    flags.totalLeads ||
    flags.quotedRevenue ||
    (flags.ready && visible.includes("Ready")) ||
    flags.avgRating;

  return (
    <div className="space-y-5">
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
              <LeadsTrend data={leadsOverTime(leads)} />
            </ChartCard>
          )}
          {flags.pipelineByStatus && (
            <ChartCard title="Pipeline by status">
              <StatusDonut data={byStatus(leads)} />
              <Legend items={STATUS_LEGEND.filter((i) => visible.includes(i.name))} />
            </ChartCard>
          )}
        </div>
      )}

      {(flags.leadsByAgent || flags.siteTypeSplit || flags.ratingDistribution) && (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
          {flags.leadsByAgent && (
            <ChartCard title="Leads by agent">
              <LeadsByAgent data={byAgent(leads, agentNameById)} />
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
              <RatingBars data={ratingDistribution(leads)} />
            </ChartCard>
          )}
        </div>
      )}

      {(flags.revenueByStatus || flags.ticketStatusSplit) && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          {flags.revenueByStatus && (
            <ChartCard title="Revenue by status">
              <RevenueByStatus data={revenueByStatus(leads).filter((d) => visible.includes(d.name))} />
            </ChartCard>
          )}
          {flags.ticketStatusSplit && (
            <ChartCard title="Ticket status split">
              <TicketStatusDonut data={ticketStatusSplit(tickets ?? [])} />
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
