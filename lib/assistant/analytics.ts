import type { Lead } from "@/lib/leads/types";
import { leadRegion } from "@/lib/geo/regions";
import { stateOfPhone } from "@/lib/geo/areaCodes";
import { timezoneOfState } from "@/lib/geo/timezones";
import {
  addDays,
  localDateKey,
  localHour,
  localMonthKey,
  localWeekday,
  localWeekKey,
  WEEKDAYS,
  type Period,
} from "./dates";

/**
 * The assistant's analytics: pure functions over rows the caller already
 * loaded — and loaded through the USER's database client, so everything here
 * only ever sees what that user may see.
 *
 * Definitions deliberately match the dashboard's, so the assistant and the
 * KPI cards never disagree about the same number:
 *   - win rate          = Closed ÷ all leads in the set (the dashboard's "Conversion rate")
 *   - close rate        = Closed ÷ (Closed + Dropped) — of the leads that reached a decision
 *   - closed revenue    = Σ price_quoted of Closed leads; recurring = Σ yearly_price
 *   - the calling queue = Ready leads only (operator decision, see FollowUpQueue)
 */

export const OPEN_STATUSES = ["Ready", "Not Ready", "Long Term"] as const;

/* ---------------------------------------------------------------- math */

export function round(n: number | null | undefined, digits = 1): number | null {
  if (n === null || n === undefined || !Number.isFinite(n)) return null;
  const f = 10 ** digits;
  return Math.round(n * f) / f;
}

export function avg(xs: number[]): number | null {
  return xs.length ? xs.reduce((s, x) => s + x, 0) / xs.length : null;
}

export function median(xs: number[]): number | null {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

/** n ÷ d as a percentage, 1 decimal; null when there is nothing to divide by. */
export function pct(n: number, d: number): number | null {
  return d > 0 ? round((n / d) * 100, 1) : null;
}

/** price_quoted is numeric, yearly_price is free text — read both leniently. */
export function money(v: unknown): number | null {
  const n = typeof v === "string" ? parseFloat(v.replace(/[$,\s]/g, "")) : typeof v === "number" ? v : NaN;
  return Number.isFinite(n) ? n : null;
}

const DAY_MS = 86_400_000;
const ms = (iso: string) => new Date(iso).getTime();

/* ---------------------------------------------------------- lead dates */

export const DATE_FIELDS = ["created", "closed", "dropped", "updated", "first_touch", "follow_up"] as const;
export type DateField = (typeof DATE_FIELDS)[number];

export function dateOf(lead: Lead, field: DateField): string | null {
  switch (field) {
    case "created":
      return lead.created_at;
    case "closed":
      return lead.closed_at;
    case "dropped":
      return lead.dropped_at;
    case "updated":
      return lead.updated_at;
    case "first_touch":
      return lead.first_touch_at;
    case "follow_up":
      return lead.follow_up_time;
  }
}

export function daysToClose(lead: Lead): number | null {
  if (!lead.closed_at) return null;
  const d = (ms(lead.closed_at) - ms(lead.created_at)) / DAY_MS;
  return d >= 0 ? d : null;
}

function daysToDrop(lead: Lead): number | null {
  if (!lead.dropped_at) return null;
  const d = (ms(lead.dropped_at) - ms(lead.created_at)) / DAY_MS;
  return d >= 0 ? d : null;
}

function hoursToFirstTouch(lead: Lead): number | null {
  if (!lead.first_touch_at) return null;
  const h = (ms(lead.first_touch_at) - ms(lead.created_at)) / 3_600_000;
  return h >= 0 ? h : null;
}

/** The lead's own timezone, from its state (manual area wins over the phone's area code). */
export function leadTimezone(lead: Pick<Lead, "business_phone" | "custom_area">): string | null {
  const manual = lead.custom_area?.trim();
  return timezoneOfState(manual || stateOfPhone(lead.business_phone)?.state || null);
}

/* ------------------------------------------------------------ grouping */

export const GROUP_BYS = [
  "agent",
  "status",
  "category",
  "region",
  "site_type",
  "platform",
  "month",
  "week",
  "day",
  "weekday",
  "fresh_or_followup",
  "rating",
  "service",
] as const;
export type GroupBy = (typeof GROUP_BYS)[number];

const TIME_GROUPS = new Set<GroupBy>(["month", "week", "day"]);

export interface GroupContext {
  tz: string;
  dateField: DateField;
  agentName: (id: string | null) => string;
}

function keysOf(lead: Lead, by: GroupBy, ctx: GroupContext): string[] {
  const label = (v: string | null | undefined, empty = "(not set)") => (v && String(v).trim() ? String(v).trim() : empty);
  switch (by) {
    case "agent":
      return [ctx.agentName(lead.agent_id)];
    case "status":
      return [lead.status];
    case "category":
      return [label(lead.category, "(no category)")];
    case "region":
      return [leadRegion(lead)];
    case "site_type":
      return [label(lead.site_type)];
    case "platform":
      return [label(lead.platform)];
    case "fresh_or_followup":
      return [label(lead.fresh_or_followup)];
    case "rating":
      return [typeof lead.rating === "number" ? String(lead.rating) : "(unrated)"];
    case "service": {
      const services = (lead.services ?? []).map((s) => s.trim()).filter(Boolean);
      return services.length ? [...new Set(services)] : ["(no services listed)"];
    }
    case "month":
    case "week":
    case "day":
    case "weekday": {
      const at = dateOf(lead, ctx.dateField);
      if (!at) return [];
      if (by === "month") return [localMonthKey(at, ctx.tz)];
      if (by === "week") return [localWeekKey(at, ctx.tz)];
      if (by === "day") return [localDateKey(at, ctx.tz)];
      return [localWeekday(at, ctx.tz)];
    }
  }
}

export interface GroupRow {
  group: string;
  leads: number;
  ready: number;
  not_ready: number;
  long_term: number;
  closed: number;
  dropped: number;
  win_rate_pct: number | null;
  close_rate_pct: number | null;
  closed_revenue: number;
  recurring_revenue: number;
  avg_closed_deal: number | null;
  quoted_open: number;
  avg_days_to_close: number | null;
  avg_rating: number | null;
}

export function groupRow(group: string, leads: Lead[]): GroupRow {
  const count = (s: string) => leads.filter((l) => l.status === s).length;
  const closed = leads.filter((l) => l.status === "Closed");
  const closedPrices = closed.map((l) => money(l.price_quoted)).filter((n): n is number => n !== null);
  const dropped = count("Dropped");
  const ratings = leads.map((l) => l.rating).filter((r): r is number => typeof r === "number");
  const closeDays = closed.map(daysToClose).filter((d): d is number => d !== null);
  return {
    group,
    leads: leads.length,
    ready: count("Ready"),
    not_ready: count("Not Ready"),
    long_term: count("Long Term"),
    closed: closed.length,
    dropped,
    win_rate_pct: pct(closed.length, leads.length),
    close_rate_pct: pct(closed.length, closed.length + dropped),
    closed_revenue: round(closedPrices.reduce((s, n) => s + n, 0), 2) ?? 0,
    recurring_revenue: round(closed.reduce((s, l) => s + (money(l.yearly_price) ?? 0), 0), 2) ?? 0,
    avg_closed_deal: round(avg(closedPrices), 2),
    quoted_open: round(
      leads
        .filter((l) => (OPEN_STATUSES as readonly string[]).includes(l.status))
        .reduce((s, l) => s + (money(l.price_quoted) ?? 0), 0),
      2,
    ) ?? 0,
    avg_days_to_close: round(avg(closeDays), 1),
    avg_rating: round(avg(ratings), 1),
  };
}

export const SORTS = ["leads", "closed", "close_rate", "win_rate", "closed_revenue", "group"] as const;
export type GroupSort = (typeof SORTS)[number];

/** Group, aggregate, sort. Time groups default to chronological order. */
export function breakdown(leads: Lead[], by: GroupBy, ctx: GroupContext, sort?: GroupSort): GroupRow[] {
  const groups = new Map<string, Lead[]>();
  for (const lead of leads) {
    for (const key of keysOf(lead, by, ctx)) {
      const list = groups.get(key);
      if (list) list.push(lead);
      else groups.set(key, [lead]);
    }
  }
  const rows = [...groups.entries()].map(([key, ls]) => groupRow(key, ls));
  const effective = sort ?? (TIME_GROUPS.has(by) || by === "weekday" || by === "rating" ? "group" : "leads");
  const value = (r: GroupRow): number => {
    switch (effective) {
      case "closed":
        return r.closed;
      case "close_rate":
        return r.close_rate_pct ?? -1;
      case "win_rate":
        return r.win_rate_pct ?? -1;
      case "closed_revenue":
        return r.closed_revenue;
      default:
        return r.leads;
    }
  };
  if (effective === "group") {
    if (by === "weekday") return rows.sort((a, b) => WEEKDAYS.indexOf(a.group as never) - WEEKDAYS.indexOf(b.group as never));
    if (by === "rating") return rows.sort((a, b) => (Number(a.group) || 99) - (Number(b.group) || 99));
    return rows.sort((a, b) => a.group.localeCompare(b.group));
  }
  return rows.sort((a, b) => value(b) - value(a) || b.leads - a.leads);
}

/* -------------------------------------------------------------- summary */

export interface NamedCount {
  name: string;
  leads: number;
  closed: number;
  close_rate_pct: number | null;
}

function topBy(leads: Lead[], keyOf: (l: Lead) => string, limit: number): NamedCount[] {
  const by = new Map<string, Lead[]>();
  for (const l of leads) {
    const k = keyOf(l);
    const list = by.get(k);
    if (list) list.push(l);
    else by.set(k, [l]);
  }
  return [...by.entries()]
    .map(([name, ls]) => {
      const closed = ls.filter((l) => l.status === "Closed").length;
      const dropped = ls.filter((l) => l.status === "Dropped").length;
      return { name, leads: ls.length, closed, close_rate_pct: pct(closed, closed + dropped) };
    })
    .sort((a, b) => b.leads - a.leads)
    .slice(0, limit);
}

export interface LeadSummary {
  total_leads: number;
  by_status: Record<string, number>;
  outcomes: {
    closed: number;
    dropped: number;
    open: number;
    win_rate_pct: number | null;
    close_rate_pct: number | null;
  };
  revenue: {
    closed_one_time: number;
    closed_recurring_yearly: number;
    avg_closed_deal: number | null;
    quoted_on_ready_leads: number;
    quoted_on_all_open_leads: number;
    avg_quoted_price: number | null;
  };
  velocity: {
    avg_days_to_close: number | null;
    median_days_to_close: number | null;
    avg_days_to_drop: number | null;
    avg_hours_to_first_touch: number | null;
    median_hours_to_first_touch: number | null;
  };
  calling_queue: {
    ready_leads: number;
    overdue: number;
    due_today: number;
    due_next_7_days: number;
    no_follow_up_scheduled: number;
    three_plus_no_pickups_in_a_row: number;
    long_term_due: number;
  };
  rating: { avg: number | null; rated_leads: number };
  fresh_vs_follow_up: { fresh: number; follow_up: number };
  top_categories: NamedCount[];
  top_regions: NamedCount[];
  site_types: NamedCount[];
}

export function summarizeLeads(leads: Lead[], now: Date, tz: string): LeadSummary {
  const byStatus: Record<string, number> = {};
  for (const l of leads) byStatus[l.status] = (byStatus[l.status] ?? 0) + 1;
  const closed = leads.filter((l) => l.status === "Closed");
  const dropped = leads.filter((l) => l.status === "Dropped");
  const open = leads.filter((l) => (OPEN_STATUSES as readonly string[]).includes(l.status));
  const ready = leads.filter((l) => l.status === "Ready");
  const closedPrices = closed.map((l) => money(l.price_quoted)).filter((n): n is number => n !== null);
  const quoted = leads.map((l) => money(l.price_quoted)).filter((n): n is number => n !== null);
  const sum = (ls: Lead[]) => ls.reduce((s, l) => s + (money(l.price_quoted) ?? 0), 0);
  const closeDays = closed.map(daysToClose).filter((d): d is number => d !== null);
  const dropDays = dropped.map(daysToDrop).filter((d): d is number => d !== null);
  const touch = leads.map(hoursToFirstTouch).filter((h): h is number => h !== null);
  const ratings = leads.map((l) => l.rating).filter((r): r is number => typeof r === "number");

  const nowMs = now.getTime();
  const today = localDateKey(now, tz);
  const weekOut = addDays(today, 7);
  const queue = { overdue: 0, dueToday: 0, next7: 0, none: 0 };
  for (const l of ready) {
    if (!l.follow_up_time) {
      queue.none++;
      continue;
    }
    const t = ms(l.follow_up_time);
    const day = localDateKey(l.follow_up_time, tz);
    if (t < nowMs) queue.overdue++;
    else if (day === today) queue.dueToday++;
    else if (day <= weekOut) queue.next7++;
  }

  return {
    total_leads: leads.length,
    by_status: byStatus,
    outcomes: {
      closed: closed.length,
      dropped: dropped.length,
      open: open.length,
      win_rate_pct: pct(closed.length, leads.length),
      close_rate_pct: pct(closed.length, closed.length + dropped.length),
    },
    revenue: {
      closed_one_time: round(closedPrices.reduce((s, n) => s + n, 0), 2) ?? 0,
      closed_recurring_yearly: round(closed.reduce((s, l) => s + (money(l.yearly_price) ?? 0), 0), 2) ?? 0,
      avg_closed_deal: round(avg(closedPrices), 2),
      quoted_on_ready_leads: round(sum(ready), 2) ?? 0,
      quoted_on_all_open_leads: round(sum(open), 2) ?? 0,
      avg_quoted_price: round(avg(quoted), 2),
    },
    velocity: {
      avg_days_to_close: round(avg(closeDays), 1),
      median_days_to_close: round(median(closeDays), 1),
      avg_days_to_drop: round(avg(dropDays), 1),
      avg_hours_to_first_touch: round(avg(touch), 1),
      median_hours_to_first_touch: round(median(touch), 1),
    },
    calling_queue: {
      ready_leads: ready.length,
      overdue: queue.overdue,
      due_today: queue.dueToday,
      due_next_7_days: queue.next7,
      no_follow_up_scheduled: queue.none,
      three_plus_no_pickups_in_a_row: ready.filter((l) => (l.no_pickup_streak ?? 0) >= 3).length,
      long_term_due: leads.filter((l) => l.status === "Long Term" && l.follow_up_time && ms(l.follow_up_time) < nowMs).length,
    },
    rating: { avg: round(avg(ratings), 1), rated_leads: ratings.length },
    fresh_vs_follow_up: {
      fresh: leads.filter((l) => l.fresh_or_followup === "Fresh").length,
      follow_up: leads.filter((l) => l.fresh_or_followup === "Follow Up").length,
    },
    top_categories: topBy(leads, (l) => l.category?.trim() || "(no category)", 8),
    top_regions: topBy(leads, (l) => leadRegion(l), 8),
    site_types: topBy(leads, (l) => l.site_type?.trim() || "(not set)", 6),
  };
}

/** The headline numbers of two summaries side by side, with the change. */
export function compareSummaries(current: LeadSummary, previous: LeadSummary) {
  const delta = (a: number | null, b: number | null) => (a === null || b === null ? null : round(a - b, 2));
  const row = (a: number | null, b: number | null) => ({ current: a, previous: b, change: delta(a, b) });
  return {
    total_leads: row(current.total_leads, previous.total_leads),
    closed: row(current.outcomes.closed, previous.outcomes.closed),
    dropped: row(current.outcomes.dropped, previous.outcomes.dropped),
    close_rate_pct: row(current.outcomes.close_rate_pct, previous.outcomes.close_rate_pct),
    win_rate_pct: row(current.outcomes.win_rate_pct, previous.outcomes.win_rate_pct),
    closed_revenue: row(current.revenue.closed_one_time, previous.revenue.closed_one_time),
    avg_days_to_close: row(current.velocity.avg_days_to_close, previous.velocity.avg_days_to_close),
  };
}

/* ----------------------------------------------------------- follow-ups */

export interface FollowUpRow {
  lead_id: string;
  user_id: string | null;
  fu_status: string;
  created_at: string;
}

export const FU_GROUP_BYS = [
  "day",
  "week",
  "month",
  "agent",
  "lead_local_hour",
  "lead_local_weekday",
  "company_hour",
  "company_weekday",
  "lead_status",
  "region",
] as const;
export type FuGroupBy = (typeof FU_GROUP_BYS)[number];

export interface FuGroupRow {
  group: string;
  logged: number;
  pickups: number;
  pickup_rate_pct: number | null;
}

export interface FuContext {
  tz: string;
  leadById: Map<string, Lead>;
  agentName: (id: string | null) => string;
}

const hourLabel = (h: number) => `${String(h).padStart(2, "0")}:00`;

function fuKey(row: FollowUpRow, by: FuGroupBy, ctx: FuContext): string | null {
  const lead = ctx.leadById.get(row.lead_id);
  switch (by) {
    case "day":
      return localDateKey(row.created_at, ctx.tz);
    case "week":
      return localWeekKey(row.created_at, ctx.tz);
    case "month":
      return localMonthKey(row.created_at, ctx.tz);
    case "agent":
      return ctx.agentName(row.user_id);
    case "company_hour":
      return hourLabel(localHour(row.created_at, ctx.tz));
    case "company_weekday":
      return localWeekday(row.created_at, ctx.tz);
    case "lead_status":
      return lead?.status ?? "(lead not visible)";
    case "region":
      return lead ? leadRegion(lead) : "(lead not visible)";
    case "lead_local_hour":
    case "lead_local_weekday": {
      const zone = lead ? leadTimezone(lead) : null;
      if (!zone) return null;
      return by === "lead_local_hour" ? hourLabel(localHour(row.created_at, zone)) : localWeekday(row.created_at, zone);
    }
  }
}

export function followUpTotals(rows: FollowUpRow[]): { logged: number; pickups: number; no_pickups: number; pickup_rate_pct: number | null } {
  const pickups = rows.filter((r) => r.fu_status === "Pickup").length;
  return { logged: rows.length, pickups, no_pickups: rows.length - pickups, pickup_rate_pct: pct(pickups, rows.length) };
}

export function groupFollowUps(rows: FollowUpRow[], by: FuGroupBy, ctx: FuContext): { rows: FuGroupRow[]; unplaced: number } {
  const groups = new Map<string, { logged: number; pickups: number }>();
  let unplaced = 0;
  for (const r of rows) {
    const key = fuKey(r, by, ctx);
    if (key === null) {
      unplaced++;
      continue;
    }
    const g = groups.get(key) ?? { logged: 0, pickups: 0 };
    g.logged++;
    if (r.fu_status === "Pickup") g.pickups++;
    groups.set(key, g);
  }
  const out = [...groups.entries()].map(([group, g]) => ({
    group,
    logged: g.logged,
    pickups: g.pickups,
    pickup_rate_pct: pct(g.pickups, g.logged),
  }));
  const chronological = by === "day" || by === "week" || by === "month" || by === "lead_local_hour" || by === "company_hour";
  if (chronological) out.sort((a, b) => a.group.localeCompare(b.group));
  else if (by === "lead_local_weekday" || by === "company_weekday") {
    out.sort((a, b) => WEEKDAYS.indexOf(a.group as never) - WEEKDAYS.indexOf(b.group as never));
  } else out.sort((a, b) => b.logged - a.logged);
  return { rows: out, unplaced };
}

/**
 * When do calls get answered? Pickup rate by the hour and weekday AT THE
 * LEAD (their state's timezone — the agents call US businesses from another
 * continent, so the company clock says little about the customer's day).
 * Buckets with fewer than `minSample` calls are left out: a 2-for-2 hour is
 * noise, not a pattern.
 */
export function pickupPatterns(rows: FollowUpRow[], ctx: FuContext, minSample = 8) {
  const rank = (by: FuGroupBy) =>
    groupFollowUps(rows, by, ctx)
      .rows.filter((r) => r.logged >= minSample)
      .sort((a, b) => (b.pickup_rate_pct ?? 0) - (a.pickup_rate_pct ?? 0));
  const hours = rank("lead_local_hour");
  const days = rank("lead_local_weekday");
  return {
    min_calls_per_bucket: minSample,
    best_hours_at_lead: hours.slice(0, 3),
    worst_hours_at_lead: hours.length > 3 ? hours.slice(-3).reverse() : [],
    best_weekdays_at_lead: days.slice(0, 3),
    worst_weekdays_at_lead: days.length > 3 ? days.slice(-2).reverse() : [],
  };
}

/** Calls logged per lead before it closed, over leads closed in the period. */
export function touchesBeforeClose(closedLeads: Lead[], allFollowUps: FollowUpRow[]) {
  const byLead = new Map<string, number>();
  const closedAt = new Map(closedLeads.map((l) => [l.id, l.closed_at ? ms(l.closed_at) : Infinity]));
  for (const f of allFollowUps) {
    const until = closedAt.get(f.lead_id);
    if (until === undefined || ms(f.created_at) > until) continue;
    byLead.set(f.lead_id, (byLead.get(f.lead_id) ?? 0) + 1);
  }
  const counts = closedLeads.map((l) => byLead.get(l.id) ?? 0);
  return {
    closed_leads: closedLeads.length,
    avg_calls_before_close: round(avg(counts), 1),
    median_calls_before_close: round(median(counts), 1),
    closed_with_no_logged_calls: counts.filter((c) => c === 0).length,
  };
}

/** Rows in the period, for callers that hold a wider set. */
export function inWindow<T extends { created_at: string }>(rows: T[], p: Period | null): T[] {
  if (!p) return rows;
  return rows.filter((r) => {
    const t = ms(r.created_at);
    return t >= p.fromMs && t < p.toExMs;
  });
}
