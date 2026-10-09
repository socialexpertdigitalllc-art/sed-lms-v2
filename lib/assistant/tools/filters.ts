import type { Lead } from "@/lib/leads/types";
import { LEAD_STATUSES, SITE_TYPES } from "@/lib/leads/types";
import { leadRegion } from "@/lib/geo/regions";
import { codeOfState } from "@/lib/geo/areaCodes";
import { DATE_FIELDS, dateOf, type DateField } from "../analytics";
import { PeriodError, resolvePeriod, type Period } from "../dates";
import { ToolError, type ToolContext } from "./types";

/**
 * The lead filters every lead tool shares: the JSON-Schema the model sees,
 * and the lenient-in, strict-out parsing behind it. Lenient because models
 * write "closed" for "Closed" and "TX" for "Texas"; strict because a filter
 * that silently matched nothing would read as "you have no such leads".
 */

export const PERIOD_PROPERTIES = {
  from: { type: "string", description: "Start date, YYYY-MM-DD, inclusive, in the company timezone." },
  to: { type: "string", description: "End date, YYYY-MM-DD, inclusive. Defaults to today when `from` is given." },
};

export const LEAD_FILTER_PROPERTIES = {
  ...PERIOD_PROPERTIES,
  date_field: {
    type: "string",
    enum: [...DATE_FIELDS],
    description:
      "Which date the from/to period applies to. created (default) = leads ADDED in the period; closed = leads CLOSED in the period; dropped = DROPPED in the period; first_touch = first call logged in the period; follow_up = next follow-up scheduled in the period; updated = last edited in the period.",
  },
  status: {
    type: "array",
    items: { type: "string", enum: [...LEAD_STATUSES] },
    description: "Only leads currently in these statuses.",
  },
  agent: { type: "string", description: "The agent who owns the leads, by name; or \"me\". Omit for everyone you can see." },
  region: { type: "string", description: "US state, by name or 2-letter code (Texas or TX)." },
  category: { type: "string", description: "Business category, e.g. Plumbing (case-insensitive)." },
  site_type: { type: "string", enum: [...SITE_TYPES], description: "Website type sold." },
};

export interface LeadFilters {
  from?: string;
  to?: string;
  dateField: DateField;
  statuses: string[] | null;
  agent?: string;
  region?: string;
  category?: string;
  siteType?: string;
}

const str = (v: unknown): string | undefined => (typeof v === "string" && v.trim() ? v.trim() : undefined);

/** Map loose input onto a canonical value, case- and spacing-insensitively. */
export function canonical<T extends string>(value: string, allowed: readonly T[], what: string): T {
  const norm = (s: string) => s.toLowerCase().replace(/[\s_-]+/g, "");
  const hit = allowed.find((a) => norm(a) === norm(value));
  if (!hit) throw new ToolError(`Unknown ${what} "${value}". Use one of: ${allowed.join(", ")}.`);
  return hit;
}

export function parseLeadFilters(args: Record<string, unknown>): LeadFilters {
  const rawStatus = args.status;
  const statusList = Array.isArray(rawStatus) ? rawStatus : typeof rawStatus === "string" && rawStatus.trim() ? [rawStatus] : [];
  const statuses = statusList
    .filter((s): s is string => typeof s === "string" && s.trim().length > 0)
    .map((s) => canonical(s.trim(), LEAD_STATUSES, "status"));
  const dateField = str(args.date_field) ? canonical(str(args.date_field)!, DATE_FIELDS, "date_field") : "created";
  const siteType = str(args.site_type) ? canonical(str(args.site_type)!, SITE_TYPES, "site_type") : undefined;
  return {
    from: str(args.from),
    to: str(args.to),
    dateField,
    statuses: statuses.length ? [...new Set(statuses)] : null,
    agent: str(args.agent),
    region: str(args.region),
    category: str(args.category),
    siteType,
  };
}

/** The period, or a ToolError the model can act on. */
export function periodFrom(
  input: { from?: string; to?: string },
  ctx: Pick<ToolContext, "timezone" | "now">,
  fallback: number | "all",
): Period | null {
  try {
    return resolvePeriod(input, ctx.timezone, ctx.now, fallback);
  } catch (e) {
    if (e instanceof PeriodError) throw new ToolError(e.message);
    throw e;
  }
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * A person, by name, id, or "me". Exact (case-insensitive) name first, then a
 * unique partial match; several partial matches is an error listing them, so
 * the model asks instead of guessing between two Alis.
 */
export async function resolveUser(input: string, ctx: ToolContext): Promise<{ id: string; name: string }> {
  const dir = await ctx.data.directory();
  const q = input.trim();
  if (/^(me|myself|i|mine|my)$/i.test(q)) return { id: ctx.userId, name: ctx.displayName };
  if (UUID.test(q)) {
    const u = dir.get(q);
    if (u) return { id: u.id, name: u.display_name ?? "Unknown user" };
    throw new ToolError(`No user has the id ${q}.`);
  }
  const users = [...dir.values()].filter((u) => u.display_name);
  const lower = q.toLowerCase();
  const exact = users.filter((u) => u.display_name!.trim().toLowerCase() === lower);
  if (exact.length === 1) return { id: exact[0].id, name: exact[0].display_name! };
  const partial = (exact.length ? exact : users).filter((u) => u.display_name!.toLowerCase().includes(lower));
  if (partial.length === 1) return { id: partial[0].id, name: partial[0].display_name! };
  if (partial.length > 1) {
    throw new ToolError(`"${q}" matches several people: ${partial.slice(0, 8).map((u) => u.display_name).join(", ")}. Which one?`);
  }
  throw new ToolError(`Nobody called "${q}" was found.`);
}

/** Does `region` (a state name or code) name this lead's state? */
export function regionMatches(lead: Lead, region: string): boolean {
  const r = leadRegion(lead);
  const q = region.trim().toLowerCase();
  return r.toLowerCase() === q || (codeOfState(r) ?? "").toLowerCase() === q;
}

export interface FilteredLeads {
  leads: Lead[];
  period: Period | null;
  dateField: DateField;
  /** Human-readable facts about the filtering the model should relay. */
  notes: string[];
  applied: Record<string, unknown>;
}

/**
 * Apply the shared filters to the user's visible leads. When the user asks
 * about someone else's leads without being able to see them, says so — an
 * empty result must not read as "Ali has no leads".
 */
export async function filterLeads(
  f: LeadFilters,
  ctx: ToolContext,
  periodFallback: number | "all" = "all",
): Promise<FilteredLeads> {
  const period = periodFrom({ from: f.from, to: f.to }, ctx, periodFallback);
  let leads = await ctx.data.leads();
  const notes: string[] = [];
  const applied: Record<string, unknown> = {};

  if (period) {
    leads = leads.filter((l) => {
      const at = dateOf(l, f.dateField);
      if (!at) return false;
      const t = new Date(at).getTime();
      return t >= period.fromMs && t < period.toExMs;
    });
    applied.period = { from: period.from, to: period.to, applies_to: f.dateField, timezone: ctx.timezone };
  }
  if (f.statuses) {
    const set = new Set(f.statuses);
    leads = leads.filter((l) => set.has(l.status));
    applied.status = f.statuses;
  }
  if (f.agent) {
    const agent = await resolveUser(f.agent, ctx);
    leads = leads.filter((l) => l.agent_id === agent.id);
    applied.agent = agent.name;
    if (agent.id !== ctx.userId && !ctx.perms.has("leads.view_all")) {
      const team = await ctx.data.teamAgentIds();
      if (!team.includes(agent.id)) {
        notes.push(`You can only see your own leads${team.length ? " and your team's" : ""}, so ${agent.name}'s leads are not visible to you.`);
      }
    }
  }
  if (f.region) {
    leads = leads.filter((l) => regionMatches(l, f.region!));
    applied.region = f.region;
  }
  if (f.category) {
    const q = f.category.toLowerCase();
    const exact = leads.filter((l) => (l.category ?? "").trim().toLowerCase() === q);
    leads = exact.length ? exact : leads.filter((l) => (l.category ?? "").toLowerCase().includes(q));
    applied.category = f.category;
  }
  if (f.siteType) {
    leads = leads.filter((l) => l.site_type === f.siteType);
    applied.site_type = f.siteType;
  }
  return { leads, period, dateField: f.dateField, notes, applied };
}

const stampFormatters = new Map<string, Intl.DateTimeFormat>();

/** "2026-10-09 14:30" in the given timezone — what a person would say. */
export function localStamp(iso: string | null | undefined, tz: string): string | null {
  if (!iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  let f = stampFormatters.get(tz);
  if (!f) {
    f = new Intl.DateTimeFormat("en-CA", {
      timeZone: tz,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      hourCycle: "h23",
    });
    stampFormatters.set(tz, f);
  }
  const p: Record<string, string> = {};
  for (const part of f.formatToParts(d)) p[part.type] = part.value;
  return `${p.year}-${p.month}-${p.day} ${p.hour === "24" ? "00" : p.hour}:${p.minute}`;
}

/** Numbers as numbers, everything else dropped — tolerant of "20" for 20. */
export function intArg(v: unknown, fallback: number, min: number, max: number): number {
  const n = typeof v === "number" ? v : typeof v === "string" ? Number(v) : NaN;
  if (!Number.isFinite(n)) return fallback;
  return Math.max(min, Math.min(max, Math.trunc(n)));
}

export function boolArg(v: unknown, fallback: boolean): boolean {
  if (typeof v === "boolean") return v;
  if (v === "true") return true;
  if (v === "false") return false;
  return fallback;
}
