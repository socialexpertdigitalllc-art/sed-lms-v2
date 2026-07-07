import type { Lead } from "./types";

export interface Kpis {
  total: number;
  ready: number;
  notReady: number;
  closed: number;
  dropped: number;
  longTerm: number;
  freshCount: number;
  quotedRevenue: number;
  avgRating: number; // 0 when no rated leads
  newThisWeek: number;
}

export function computeKpis(leads: Lead[], now: Date = new Date()): Kpis {
  const weekAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
  let quotedRevenue = 0;
  let ratingSum = 0;
  let ratingCount = 0;
  const counts: Record<string, number> = {
    Ready: 0,
    "Not Ready": 0,
    Closed: 0,
    Dropped: 0,
    "Long Term": 0,
  };
  let freshCount = 0;
  let newThisWeek = 0;

  for (const l of leads) {
    if (l.status in counts) counts[l.status]++;
    if (typeof l.price_quoted === "number") quotedRevenue += l.price_quoted;
    if (typeof l.rating === "number") {
      ratingSum += l.rating;
      ratingCount++;
    }
    if (l.fresh_or_followup === "Fresh") freshCount++;
    if (l.created_at && new Date(l.created_at) >= weekAgo) newThisWeek++;
  }

  return {
    total: leads.length,
    ready: counts.Ready,
    notReady: counts["Not Ready"],
    closed: counts.Closed,
    dropped: counts.Dropped,
    longTerm: counts["Long Term"],
    freshCount,
    quotedRevenue,
    avgRating: ratingCount ? ratingSum / ratingCount : 0,
    newThisWeek,
  };
}

export interface NameValue {
  name: string;
  value: number;
}

export function byStatus(leads: Lead[]): NameValue[] {
  const order = ["Ready", "Not Ready", "Closed", "Dropped", "Long Term"];
  const map = new Map<string, number>();
  for (const l of leads) map.set(l.status, (map.get(l.status) ?? 0) + 1);
  return order.filter((s) => map.has(s)).map((s) => ({ name: s, value: map.get(s)! }));
}

export function byAgent(leads: Lead[], agentNameById: Record<string, string>): NameValue[] {
  const map = new Map<string, number>();
  for (const l of leads) {
    const name = (l.agent_id && agentNameById[l.agent_id]) || "Unassigned";
    map.set(name, (map.get(name) ?? 0) + 1);
  }
  return [...map.entries()]
    .map(([name, value]) => ({ name, value }))
    .sort((a, b) => b.value - a.value);
}

export function bySiteType(leads: Lead[]): NameValue[] {
  const map = new Map<string, number>();
  for (const l of leads) {
    if (!l.site_type) continue;
    map.set(l.site_type, (map.get(l.site_type) ?? 0) + 1);
  }
  return [...map.entries()].map(([name, value]) => ({ name, value }));
}

export function ratingDistribution(leads: Lead[]): NameValue[] {
  const buckets: Record<number, number> = {};
  for (let i = 1; i <= 10; i++) buckets[i] = 0;
  for (const l of leads) {
    if (typeof l.rating === "number" && l.rating >= 1 && l.rating <= 10) buckets[l.rating]++;
  }
  return Object.entries(buckets).map(([k, value]) => ({ name: k, value }));
}

export function freshVsFollowup(leads: Lead[]): { fresh: number; followUp: number } {
  let fresh = 0;
  let followUp = 0;
  for (const l of leads) {
    if (l.fresh_or_followup === "Fresh") fresh++;
    else if (l.fresh_or_followup === "Follow Up") followUp++;
  }
  return { fresh, followUp };
}

/** Cumulative leads per day over the trailing `days` window (for an area trend). */
export function leadsOverTime(leads: Lead[], days = 42, now: Date = new Date()): NameValue[] {
  const start = new Date(now);
  start.setHours(0, 0, 0, 0);
  start.setDate(start.getDate() - (days - 1));

  const perDay = new Map<string, number>();
  for (let i = 0; i < days; i++) {
    const d = new Date(start);
    d.setDate(start.getDate() + i);
    perDay.set(key(d), 0);
  }
  for (const l of leads) {
    if (!l.created_at) continue;
    const d = new Date(l.created_at);
    if (Number.isNaN(d.getTime()) || d < start) continue;
    const k = key(d);
    if (perDay.has(k)) perDay.set(k, perDay.get(k)! + 1);
  }
  return [...perDay.entries()].map(([name, value]) => ({ name, value }));
}

function key(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}
