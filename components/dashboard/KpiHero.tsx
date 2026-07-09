import { formatCompactCurrency } from "@/lib/leads/format";
import type { Kpis } from "@/lib/leads/analytics";

export interface KpiHeroVisibility {
  totalLeads: boolean;
  quotedRevenue: boolean;
  ready: boolean;
  avgRating: boolean;
}

export function KpiHero({ kpis, show }: { kpis: Kpis; show: KpiHeroVisibility }) {
  const readyPct = kpis.total ? Math.round((kpis.ready / kpis.total) * 100) : 0;
  const cards = [
    {
      key: "totalLeads",
      label: "Total leads",
      value: String(kpis.total),
      sub: kpis.newThisWeek > 0 ? `+${kpis.newThisWeek} this week` : "No new this week",
      accent: kpis.newThisWeek > 0,
      show: show.totalLeads,
    },
    {
      key: "quotedRevenue",
      label: "Quoted revenue",
      value: formatCompactCurrency(kpis.quotedRevenue),
      sub: "from Ready leads",
      accent: false,
      show: show.quotedRevenue,
    },
    {
      key: "ready",
      label: "Ready",
      value: String(kpis.ready),
      sub: `${readyPct}% of pipeline`,
      accent: true,
      show: show.ready,
    },
    {
      key: "avgRating",
      label: "Avg rating",
      value: kpis.avgRating ? kpis.avgRating.toFixed(1) : "—",
      sub: "of 10",
      accent: false,
      show: show.avgRating,
    },
  ];
  const shown = cards.filter((c) => c.show);

  if (shown.length === 0) return null;

  return (
    <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
      {shown.map((c) => (
        <div key={c.key} className="bg-surface border border-border rounded-lg p-4">
          <div className="text-[10px] font-semibold uppercase tracking-wide text-text-faint">
            {c.label}
          </div>
          <div className="text-3xl font-semibold text-text font-mono mt-2 leading-none">
            {c.value}
          </div>
          <div className={"text-xs mt-2 font-medium " + (c.accent ? "text-accent" : "text-text-faint")}>
            {c.sub}
          </div>
        </div>
      ))}
    </div>
  );
}
