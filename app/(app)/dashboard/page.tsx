import { createClient } from "@/lib/supabase/server";
import { KpiHero } from "@/components/dashboard/KpiHero";
import { StatusStrip } from "@/components/dashboard/StatusStrip";
import {
  LeadsTrend,
  LeadsByAgent,
  StatusDonut,
  SiteTypeDonut,
  RatingBars,
  Legend,
  STATUS_LEGEND,
  SITE_PALETTE,
} from "@/components/dashboard/Charts";
import {
  computeKpis,
  byStatus,
  byAgent,
  bySiteType,
  ratingDistribution,
  leadsOverTime,
  freshVsFollowup,
} from "@/lib/leads/analytics";
import type { Lead } from "@/lib/leads/types";

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

  const kpis = computeKpis(leads);
  const fvf = freshVsFollowup(leads);
  const siteData = bySiteType(leads);
  const freshTotal = fvf.fresh + fvf.followUp || 1;

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-xl font-semibold text-text">Dashboard</h1>
        <p className="text-sm text-text-muted mt-0.5">
          {kpis.total} active {kpis.total === 1 ? "lead" : "leads"} across the pipeline
        </p>
      </div>

      <KpiHero kpis={kpis} />
      <StatusStrip kpis={kpis} />

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <ChartCard title="Leads over time" className="lg:col-span-2">
          <LeadsTrend data={leadsOverTime(leads)} />
        </ChartCard>
        <ChartCard title="Pipeline by status">
          <StatusDonut data={byStatus(leads)} />
          <Legend items={STATUS_LEGEND} />
        </ChartCard>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <ChartCard title="Leads by agent">
          <LeadsByAgent data={byAgent(leads, agentNameById)} />
        </ChartCard>
        <ChartCard title="Site type split">
          <SiteTypeDonut data={siteData} />
          <Legend items={siteData.map((d, i) => ({ name: d.name, color: SITE_PALETTE[i % SITE_PALETTE.length] }))} />
        </ChartCard>
        <ChartCard title="Rating distribution">
          <RatingBars data={ratingDistribution(leads)} />
        </ChartCard>
      </div>

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
    </div>
  );
}
