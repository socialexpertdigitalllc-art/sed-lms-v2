import type { Lead } from "@/lib/leads/types";
import { isOverdue } from "@/lib/tickets/logic";
import type { TicketStatus } from "@/lib/tickets/types";
import { inMonth } from "@/lib/analytics/dateScope";

export interface FollowUpLite {
  fu_status: string;
}
export interface TicketLite {
  status: string;
  due_date: string | null;
  created_at: string;
  resolved_at: string | null;
}

export interface ExtendedKpis {
  closedRevenue: number;
  recurringRevenue: number;
  avgDealSize: number | null;
  conversionRate: number;
  newThisWeek: number;
  overdueFollowUps: number;
  pickupRate: number | null;
  openTickets: number;
  overdueTickets: number;
  avgResolutionHours: number | null;
}

const num = (v: unknown): number | null => {
  const n = typeof v === "string" ? parseFloat(v) : typeof v === "number" ? v : NaN;
  return Number.isFinite(n) ? n : null;
};

export function computeExtendedKpis(
  leads: Lead[],
  followUps: FollowUpLite[],
  tickets: TicketLite[],
  now: Date
): ExtendedKpis {
  const closed = leads.filter((l) => l.status === "Closed");
  const closedRevenue = closed.reduce((s, l) => s + (num(l.price_quoted) ?? 0), 0);
  const recurringRevenue = closed.reduce((s, l) => s + (num(l.yearly_price) ?? 0), 0);

  const priced = leads.map((l) => num(l.price_quoted)).filter((n): n is number => n !== null);
  const avgDealSize = priced.length ? priced.reduce((a, b) => a + b, 0) / priced.length : null;

  const conversionRate = leads.length ? (closed.length / leads.length) * 100 : 0;

  const weekAgo = now.getTime() - 7 * 86_400_000;
  const newThisWeek = leads.filter((l) => new Date(l.created_at).getTime() >= weekAgo).length;

  const overdueFollowUps = leads.filter(
    (l) =>
      (l.status === "Ready" || l.status === "Long Term") &&
      l.follow_up_time &&
      new Date(l.follow_up_time).getTime() < now.getTime()
  ).length;

  const pickups = followUps.filter((f) => f.fu_status === "Pickup").length;
  const pickupRate = followUps.length ? (pickups / followUps.length) * 100 : null;

  const openTickets = tickets.filter((t) => t.status !== "Resolved").length;
  const overdueTickets = tickets.filter((t) => isOverdue(t.due_date, t.status as TicketStatus, now)).length;

  const res = tickets
    .filter((t) => t.resolved_at)
    .map((t) => (new Date(t.resolved_at as string).getTime() - new Date(t.created_at).getTime()) / 3_600_000);
  const avgResolutionHours = res.length ? res.reduce((a, b) => a + b, 0) / res.length : null;

  return {
    closedRevenue,
    recurringRevenue,
    avgDealSize,
    conversionRate,
    newThisWeek,
    overdueFollowUps,
    pickupRate,
    openTickets,
    overdueTickets,
    avgResolutionHours,
  };
}

export function revenueByStatus(leads: Lead[]): { name: string; value: number }[] {
  const sums = new Map<string, number>();
  for (const l of leads) {
    const v = num(l.price_quoted);
    if (v === null) continue;
    sums.set(l.status, (sums.get(l.status) ?? 0) + v);
  }
  return [...sums.entries()].map(([name, value]) => ({ name, value }));
}

export function ticketStatusSplit(tickets: { status: string }[]): { name: string; value: number }[] {
  const counts = new Map<string, number>();
  for (const t of tickets) counts.set(t.status, (counts.get(t.status) ?? 0) + 1);
  return [...counts.entries()].map(([name, value]) => ({ name, value }));
}

export interface VelocityKpis {
  closedInPeriod: number;
  droppedInPeriod: number;
  avgTimeToCloseDays: number | null;
  dropRatio: number | null; // % of decided (closed+dropped) that were dropped
  avgFirstTouchHours: number | null;
}

/**
 * Time-aware KPIs over the lifecycle columns. Unlike the other cards, these
 * scope by closed_at/dropped_at (real exit moments) — so callers must pass
 * leads filtered by region+agent but NOT by created_at month; the month is
 * applied here to the correct timestamp per metric.
 */
export function computeVelocityKpis(leads: Lead[], month: string): VelocityKpis {
  const days = (a: string, b: string) => (new Date(a).getTime() - new Date(b).getTime()) / 86_400_000;
  const avg = (xs: number[]) => (xs.length ? xs.reduce((s, x) => s + x, 0) / xs.length : null);

  const closed = leads.filter((l) => l.closed_at && inMonth(l.closed_at, month));
  const dropped = leads.filter((l) => l.dropped_at && inMonth(l.dropped_at, month));
  const closeDays = closed
    .map((l) => days(l.closed_at as string, l.created_at))
    .filter((d) => d >= 0);
  const decided = closed.length + dropped.length;

  const touched = leads.filter((l) => l.first_touch_at && inMonth(l.created_at, month));
  const touchHours = touched
    .map((l) => days(l.first_touch_at as string, l.created_at) * 24)
    .filter((h) => h >= 0);

  return {
    closedInPeriod: closed.length,
    droppedInPeriod: dropped.length,
    avgTimeToCloseDays: avg(closeDays),
    dropRatio: decided ? (dropped.length / decided) * 100 : null,
    avgFirstTouchHours: avg(touchHours),
  };
}
