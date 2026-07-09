import { formatCompactCurrency } from "@/lib/leads/format";
import type { ExtendedKpis } from "@/lib/dashboard/metrics";
import type { DashboardVisibility } from "@/lib/dashboard/visibility";

const fmtHours = (h: number | null) =>
  h === null ? "—" : h < 48 ? `${Math.round(h)}h` : `${(h / 24).toFixed(1)}d`;

interface Tile {
  key: string;
  show: boolean;
  label: string;
  value: string;
  sub: string;
  valueClass?: string;
}

export function StatGrid({ kpis, show }: { kpis: ExtendedKpis; show: DashboardVisibility }) {
  const tiles: Tile[] = [
    {
      key: "closedRevenue",
      show: show.closedRevenue,
      label: "Closed Revenue",
      value: formatCompactCurrency(kpis.closedRevenue),
      sub: "won deals",
    },
    {
      key: "recurringRevenue",
      show: show.recurringRevenue,
      label: "Recurring Revenue",
      value: formatCompactCurrency(kpis.recurringRevenue) + "/yr",
      sub: "from closed leads",
    },
    {
      key: "avgDealSize",
      show: show.avgDealSize,
      label: "Avg Deal Size",
      value: kpis.avgDealSize === null ? "—" : formatCompactCurrency(kpis.avgDealSize),
      sub: "per lead",
    },
    {
      key: "conversionRate",
      show: show.conversionRate,
      label: "Conversion Rate",
      value: kpis.conversionRate.toFixed(1) + "%",
      sub: "leads → closed",
    },
    {
      key: "newThisWeek",
      show: show.newThisWeek,
      label: "New This Week",
      value: String(kpis.newThisWeek),
      sub: "last 7 days",
    },
    {
      key: "overdueFollowups",
      show: show.overdueFollowups,
      label: "Overdue Follow-ups",
      value: String(kpis.overdueFollowUps),
      sub: "need attention",
      valueClass: kpis.overdueFollowUps > 0 ? " text-dropped-fg" : "",
    },
    {
      key: "pickupRate",
      show: show.pickupRate,
      label: "Pickup Rate",
      value: kpis.pickupRate === null ? "—" : Math.round(kpis.pickupRate) + "%",
      sub: "of follow-ups",
    },
    {
      key: "openTickets",
      show: show.openTickets,
      label: "Open Tickets",
      value: String(kpis.openTickets),
      sub: "unresolved",
    },
    {
      key: "overdueTickets",
      show: show.overdueTickets,
      label: "Overdue Tickets",
      value: String(kpis.overdueTickets),
      sub: "past due",
      valueClass: kpis.overdueTickets > 0 ? " text-dropped-fg" : "",
    },
    {
      key: "avgResolutionTime",
      show: show.avgResolutionTime,
      label: "Avg Resolution",
      value: fmtHours(kpis.avgResolutionHours),
      sub: "time to resolve",
    },
  ];

  const shown = tiles.filter((t) => t.show);
  if (shown.length === 0) return null;

  return (
    <div className="grid grid-cols-2 sm:grid-cols-3 xl:grid-cols-5 gap-3">
      {shown.map((t) => (
        <div key={t.key} className="bg-surface border border-border rounded-lg p-3">
          <div className="text-[10px] uppercase tracking-wide text-text-faint">{t.label}</div>
          <div className={"text-lg font-semibold text-text mt-1" + (t.valueClass ?? "")}>
            {t.value}
          </div>
          <div className="text-xs text-text-muted mt-0.5">{t.sub}</div>
        </div>
      ))}
    </div>
  );
}
