"use client";

import { GripVertical } from "lucide-react";
import { formatCompactCurrency } from "@/lib/leads/format";
import type { ExtendedKpis, VelocityKpis } from "@/lib/dashboard/metrics";
import type { DashboardVisibility } from "@/lib/dashboard/visibility";
import { applyOrder } from "@/lib/dashboard/orderCards";
import { useCardDnd } from "@/hooks/useCardDnd";
import { useUiPrefs } from "@/providers/UiPrefsProvider";

const fmtHours = (h: number | null) =>
  h === null ? "—" : h < 48 ? `${Math.round(h)}h` : `${(h / 24).toFixed(1)}d`;

const fmtDays = (d: number | null) =>
  d === null ? "—" : d < 2 ? `${Math.round(d * 24)}h` : `${d.toFixed(1)}d`;

interface Tile {
  key: string;
  show: boolean;
  label: string;
  value: string;
  sub: string;
  valueClass?: string;
}

export function StatGrid({
  kpis,
  velocity,
  show,
}: {
  kpis: ExtendedKpis;
  velocity: VelocityKpis;
  show: DashboardVisibility;
}) {
  const { dashboardOrder, setDashboardOrder } = useUiPrefs();
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
    {
      key: "closedInPeriod",
      show: show.closedInPeriod,
      label: "Closed (Period)",
      value: String(velocity.closedInPeriod),
      sub: "by close date",
    },
    {
      key: "avgTimeToClose",
      show: show.avgTimeToClose,
      label: "Avg Time To Close",
      value: fmtDays(velocity.avgTimeToCloseDays),
      sub: "arrival → close",
    },
    {
      key: "dropRatio",
      show: show.dropRatio,
      label: "Drop Ratio",
      value: velocity.dropRatio === null ? "—" : `${velocity.dropRatio.toFixed(0)}%`,
      sub: "of decided leads",
    },
    {
      key: "avgFirstTouch",
      show: show.avgFirstTouch,
      label: "Avg First Touch",
      value: fmtHours(velocity.avgFirstTouchHours),
      sub: "arrival → first call",
    },
  ];

  const shown = applyOrder(tiles.filter((t) => t.show), dashboardOrder.tiles);
  const { overKey, cardProps } = useCardDnd(
    shown.map((t) => t.key),
    (next) => {
      const hidden = dashboardOrder.tiles.filter((k) => !next.includes(k));
      setDashboardOrder({ ...dashboardOrder, tiles: [...next, ...hidden] });
    }
  );

  if (shown.length === 0) return null;

  return (
    <div className="grid grid-cols-2 sm:grid-cols-3 xl:grid-cols-5 gap-3">
      {shown.map((t) => (
        <div
          key={t.key}
          {...cardProps(t.key)}
          className={
            "group relative bg-surface border border-border rounded-lg p-2.5" +
            (overKey === t.key ? " ring-2 ring-accent/40" : "")
          }
        >
          <GripVertical
            aria-hidden
            className="absolute top-2 right-2 w-3.5 h-3.5 text-text-faint opacity-0 group-hover:opacity-100 cursor-grab"
          />
          <div className="text-[10px] uppercase tracking-wide text-text-faint">{t.label}</div>
          <div className={"text-base font-semibold text-text mt-1" + (t.valueClass ?? "")}>
            {t.value}
          </div>
          <div className="text-xs text-text-muted mt-0.5">{t.sub}</div>
        </div>
      ))}
    </div>
  );
}
