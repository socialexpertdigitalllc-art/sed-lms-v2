import { formatCompactCurrency } from "@/lib/leads/format";
import type { Kpis } from "@/lib/leads/analytics";

export function KpiHero({ kpis }: { kpis: Kpis }) {
  const readyPct = kpis.total ? Math.round((kpis.ready / kpis.total) * 100) : 0;
  const cards = [
    {
      label: "Total leads",
      value: String(kpis.total),
      sub: kpis.newThisWeek > 0 ? `+${kpis.newThisWeek} this week` : "No new this week",
      accent: kpis.newThisWeek > 0,
    },
    {
      label: "Quoted revenue",
      value: formatCompactCurrency(kpis.quotedRevenue),
      sub: "across open & won",
      accent: false,
    },
    {
      label: "Ready",
      value: String(kpis.ready),
      sub: `${readyPct}% of pipeline`,
      accent: true,
    },
    {
      label: "Avg rating",
      value: kpis.avgRating ? kpis.avgRating.toFixed(1) : "—",
      sub: "of 10",
      accent: false,
    },
  ];

  return (
    <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
      {cards.map((c) => (
        <div key={c.label} className="bg-surface border border-border rounded-lg p-4">
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
