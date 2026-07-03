import type { PreLead } from "./types";
import { LEAD_CATEGORIES } from "./types";

export interface PreLeadKpis {
  total: number;
  strong: number;
  closed: number;
  dropped: number;
  active: number; // not Closed / Dropped
  dueNext24h: number;
  pastDue: number;
  conversionRate: number; // closed / total * 100
}

export function computePreLeadKpis(leads: PreLead[], now: Date = new Date()): PreLeadKpis {
  const in24h = new Date(now.getTime() + 24 * 60 * 60 * 1000);
  let strong = 0,
    closed = 0,
    dropped = 0,
    active = 0,
    dueNext24h = 0,
    pastDue = 0;

  for (const l of leads) {
    if (l.lead_category === "Strong Lead") strong++;
    if (l.status === "Closed") closed++;
    else if (l.status === "Dropped") dropped++;
    else active++;

    if (l.follow_up_time && l.status !== "Closed" && l.status !== "Dropped") {
      const t = new Date(l.follow_up_time);
      if (!Number.isNaN(t.getTime())) {
        if (t >= now && t <= in24h) dueNext24h++;
        else if (t < now) pastDue++;
      }
    }
  }

  return {
    total: leads.length,
    strong,
    closed,
    dropped,
    active,
    dueNext24h,
    pastDue,
    conversionRate: leads.length ? Math.round((closed / leads.length) * 100) : 0,
  };
}

export interface NameValue {
  name: string;
  value: number;
}

export function categoryDistribution(leads: PreLead[]): NameValue[] {
  const map = new Map<string, number>();
  for (const l of leads) map.set(l.lead_category, (map.get(l.lead_category) ?? 0) + 1);
  return LEAD_CATEGORIES.filter((c) => map.has(c)).map((c) => ({ name: c, value: map.get(c)! }));
}

export function serviceSplit(leads: PreLead[]): {
  offered: NameValue[];
  type: NameValue[];
} {
  const off = new Map<string, number>();
  const typ = new Map<string, number>();
  for (const l of leads) {
    if (l.service_offered) off.set(l.service_offered, (off.get(l.service_offered) ?? 0) + 1);
    if (l.service_type) typ.set(l.service_type, (typ.get(l.service_type) ?? 0) + 1);
  }
  return {
    offered: [...off.entries()].map(([name, value]) => ({ name, value })),
    type: [...typ.entries()].map(([name, value]) => ({ name, value })),
  };
}

/** Active leads with a follow-up time within the next 24h, soonest first. */
export function followUpsDue(leads: PreLead[], now: Date = new Date()): PreLead[] {
  const in24h = new Date(now.getTime() + 24 * 60 * 60 * 1000);
  return leads
    .filter((l) => {
      if (l.status === "Closed" || l.status === "Dropped" || !l.follow_up_time) return false;
      const t = new Date(l.follow_up_time);
      return !Number.isNaN(t.getTime()) && t >= now && t <= in24h;
    })
    .sort((a, b) => new Date(a.follow_up_time!).getTime() - new Date(b.follow_up_time!).getTime());
}

/** Active leads whose follow-up time is already in the past, most recent first. */
export function pastDueFollowUps(leads: PreLead[], now: Date = new Date()): PreLead[] {
  return leads
    .filter((l) => {
      if (l.status === "Closed" || l.status === "Dropped" || !l.follow_up_time) return false;
      const t = new Date(l.follow_up_time);
      return !Number.isNaN(t.getTime()) && t < now;
    })
    .sort((a, b) => new Date(b.follow_up_time!).getTime() - new Date(a.follow_up_time!).getTime());
}

export function recentPreLeads(leads: PreLead[], n = 5): PreLead[] {
  return [...leads]
    .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime())
    .slice(0, n);
}
