import { LEAD_CATEGORIES, PRELEAD_STATUSES, type PreLead } from "@/lib/preleads/types";
import { money, pct, round } from "../analytics";
import { addDays, localDateKey } from "../dates";
import { fetchAll } from "./data";
import { canonical, intArg, localStamp, PERIOD_PROPERTIES, periodFrom, resolveUser } from "./filters";
import type { AssistantTool } from "./types";

const countBy = (rows: PreLead[], key: (p: PreLead) => string | null | undefined) => {
  const m: Record<string, number> = {};
  for (const r of rows) {
    const k = key(r)?.trim() || "(not set)";
    m[k] = (m[k] ?? 0) + 1;
  }
  return Object.fromEntries(Object.entries(m).sort((a, b) => b[1] - a[1]));
};

export const preLeadsOverviewTool: AssistantTool = {
  name: "get_pre_leads_overview",
  label: "Reviewing pre-leads",
  description:
    "The pre-leads the user can see (early-stage prospects before they become leads): counts by category, status, service offered and service type; pricing totals; follow-ups overdue or due soon; closed vs dropped; and a list of matches when a text query or list is requested. Filter by created date, category, status or agent.",
  parameters: {
    type: "object",
    properties: {
      ...PERIOD_PROPERTIES,
      category: { type: "string", enum: [...LEAD_CATEGORIES], description: "Only this pre-lead category." },
      status: { type: "string", enum: [...PRELEAD_STATUSES], description: "Only this status." },
      agent: { type: "string", description: "Only this agent's pre-leads (name, or \"me\")." },
      query: { type: "string", description: "Free-text search over business, owner, phone, email, areas, services, comments." },
      list_limit: { type: "integer", minimum: 0, maximum: 40, description: "How many matching pre-leads to list (default 10; 0 for none)." },
    },
  },
  available: (perms) => perms.has("pre_leads.view"),
  async run(args, ctx) {
    const period = periodFrom({ from: args.from as string | undefined, to: args.to as string | undefined }, ctx, "all");
    // RLS scopes pre-leads to the user's own (or all, for admins) — the
    // Pre-Leads page reads them the same way.
    const all = await fetchAll<PreLead>((from, to) =>
      ctx.db
        .from("pre_leads")
        .select("*")
        .is("deleted_at", null)
        .order("created_at", { ascending: false })
        .order("id", { ascending: true })
        .range(from, to),
    );
    let rows = all;
    const applied: Record<string, unknown> = {};
    if (period) {
      rows = rows.filter((p) => {
        const t = new Date(p.created_at).getTime();
        return t >= period.fromMs && t < period.toExMs;
      });
      applied.created = { from: period.from, to: period.to };
    }
    if (typeof args.category === "string" && args.category.trim()) {
      const c = canonical(args.category, LEAD_CATEGORIES, "category");
      rows = rows.filter((p) => p.lead_category === c);
      applied.category = c;
    }
    if (typeof args.status === "string" && args.status.trim()) {
      const s = canonical(args.status, PRELEAD_STATUSES, "status");
      rows = rows.filter((p) => p.status === s);
      applied.status = s;
    }
    if (typeof args.agent === "string" && args.agent.trim()) {
      const who = await resolveUser(args.agent, ctx);
      rows = rows.filter((p) => p.agent_id === who.id);
      applied.agent = who.name;
    }
    const q = typeof args.query === "string" ? args.query.trim().toLowerCase() : "";
    if (q) {
      rows = rows.filter((p) =>
        [p.business_name, p.owner_name, p.phone_number, p.email, ...(p.areas ?? []), ...(p.services ?? []), p.comments]
          .filter(Boolean)
          .join(" ")
          .toLowerCase()
          .includes(q),
      );
      applied.query = q;
    }

    const name = await ctx.data.names();
    const nowMs = ctx.now.getTime();
    const today = localDateKey(ctx.now, ctx.timezone);
    const weekOut = addDays(today, 7);
    const pending = rows.filter((p) => p.status === "Next follow up");
    const closed = rows.filter((p) => p.status === "Closed").length;
    const dropped = rows.filter((p) => p.status === "Dropped").length;
    const prices = rows.map((p) => money(p.pricing)).filter((n): n is number => n !== null);
    const limit = intArg(args.list_limit, 10, 0, 40);

    const data = {
      // Pre-lead RLS is "your own, or everyone's for admins".
      visible_scope: all.some((p) => p.agent_id && p.agent_id !== ctx.userId) ? "everyone's pre-leads" : "your own pre-leads",
      filters: applied,
      total: rows.length,
      by_category: countBy(rows, (p) => p.lead_category),
      by_status: countBy(rows, (p) => p.status),
      by_service_offered: countBy(rows, (p) => p.service_offered),
      by_service_type: countBy(rows, (p) => p.service_type),
      by_agent: countBy(rows, (p) => name(p.agent_id)),
      pricing: { priced: prices.length, total: round(prices.reduce((s, n) => s + n, 0), 2), average: round(prices.length ? prices.reduce((s, n) => s + n, 0) / prices.length : null, 2) },
      outcomes: { closed, dropped, close_rate_pct: pct(closed, closed + dropped) },
      follow_ups: {
        waiting: pending.length,
        overdue: pending.filter((p) => p.follow_up_time && new Date(p.follow_up_time).getTime() < nowMs).length,
        due_today: pending.filter((p) => p.follow_up_time && new Date(p.follow_up_time).getTime() >= nowMs && localDateKey(p.follow_up_time, ctx.timezone) === today).length,
        due_next_7_days: pending.filter((p) => p.follow_up_time && new Date(p.follow_up_time).getTime() >= nowMs && localDateKey(p.follow_up_time, ctx.timezone) <= weekOut).length,
        none_scheduled: pending.filter((p) => !p.follow_up_time).length,
      },
      pre_leads: rows.slice(0, limit).map((p) => ({
        id: p.id,
        business_name: p.business_name,
        category: p.lead_category,
        status: p.status,
        agent: name(p.agent_id),
        pricing: money(p.pricing),
        next_follow_up: localStamp(p.follow_up_time, ctx.timezone),
        link: `/pre-leads/${p.id}`,
      })),
    };
    return { data, summary: `${rows.length} pre-leads · ${pending.length} awaiting follow-up` };
  },
};
