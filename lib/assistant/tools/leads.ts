import type { Lead } from "@/lib/leads/types";
import { leadRegion } from "@/lib/geo/regions";
import { allowedTicketScope, ticketInScope } from "@/lib/tickets/scope";
import {
  breakdown,
  compareSummaries,
  GROUP_BYS,
  money,
  SORTS,
  summarizeLeads,
  type GroupBy,
  type GroupSort,
} from "../analytics";
import { addDays, localDateKey, previousPeriod } from "../dates";
import {
  boolArg,
  canonical,
  filterLeads,
  intArg,
  LEAD_FILTER_PROPERTIES,
  localStamp,
  parseLeadFilters,
} from "./filters";
import { ToolError, type AssistantTool, type ToolContext } from "./types";

const fmtMoney = (n: number) =>
  n >= 1000 ? `$${(n / 1000).toFixed(n >= 100_000 ? 0 : 1)}k` : `$${Math.round(n).toLocaleString("en-US")}`;

/** How far this user's lead visibility reaches, in words for the model. */
export async function leadScopeLine(ctx: ToolContext): Promise<string> {
  if (ctx.perms.has("leads.view_all")) return "all agents' leads (statuses you are allowed to see)";
  const team = await ctx.data.teamAgentIds();
  return team.length
    ? `your own leads and your team's (${team.length} agent${team.length === 1 ? "" : "s"})`
    : "only your own leads";
}

/* ------------------------------------------------------- pipeline summary */

export const pipelineSummaryTool: AssistantTool = {
  name: "get_pipeline_summary",
  label: "Reading the pipeline",
  description:
    "Headline numbers for the leads the user can see: totals by status, win rate and close rate, closed and quoted revenue, days to close, hours to first call, the calling queue (overdue, due today, never scheduled), ratings, top categories, regions and site types. Filter by period (and which date the period applies to), agent, status, region, category or site type. Set compare_previous to also get the equal-length period just before, with the change. Start here for any 'how are we / am I doing' question.",
  parameters: {
    type: "object",
    properties: {
      ...LEAD_FILTER_PROPERTIES,
      compare_previous: {
        type: "boolean",
        description: "Also compute the same headline numbers for the equal-length period just before (needs a period).",
      },
    },
  },
  available: (perms) => perms.has("leads.view"),
  async run(args, ctx) {
    const filters = parseLeadFilters(args);
    const result = await filterLeads(filters, ctx);
    const summary = summarizeLeads(result.leads, ctx.now, ctx.timezone);
    const data: Record<string, unknown> = {
      visible_scope: await leadScopeLine(ctx),
      filters: result.applied,
      summary,
    };
    if (boolArg(args.compare_previous, false)) {
      if (!result.period) {
        result.notes.push("compare_previous needs a period (from/to), so no comparison was made.");
      } else {
        const prev = previousPeriod(result.period, ctx.timezone);
        const prevLeads = await filterLeads({ ...filters, from: prev.from, to: prev.to }, ctx);
        data.previous_period = { from: prev.from, to: prev.to };
        data.vs_previous_period = compareSummaries(summary, summarizeLeads(prevLeads.leads, ctx.now, ctx.timezone));
      }
    }
    if (result.notes.length) data.notes = result.notes;
    return {
      data,
      summary: `${summary.total_leads} leads · ${summary.outcomes.closed} closed · ${fmtMoney(summary.revenue.closed_one_time)} closed revenue`,
    };
  },
};

/* -------------------------------------------------------------- breakdown */

export const breakdownLeadsTool: AssistantTool = {
  name: "breakdown_leads",
  label: "Breaking the numbers down",
  description:
    "Group the visible leads by one dimension and get, per group: leads, count per status, win rate, close rate, closed and recurring revenue, average closed deal, open quoted value, average days to close and average rating. Use it to find patterns: which agent, category, region, site type, service, month/week/day, weekday or rating closes best. Time groups (month/week/day/weekday) use the date chosen by date_field. Weeks start on Monday.",
  parameters: {
    type: "object",
    properties: {
      group_by: { type: "string", enum: [...GROUP_BYS], description: "The dimension to group by." },
      sort_by: {
        type: "string",
        enum: [...SORTS],
        description: "Order of the groups (default: chronological for time groups, otherwise most leads first).",
      },
      limit: { type: "integer", minimum: 1, maximum: 60, description: "Most groups to return (default 25)." },
      ...LEAD_FILTER_PROPERTIES,
    },
    required: ["group_by"],
  },
  available: (perms) => perms.has("leads.view"),
  async run(args, ctx) {
    if (typeof args.group_by !== "string") throw new ToolError(`group_by is required: one of ${GROUP_BYS.join(", ")}.`);
    const by = canonical(args.group_by, GROUP_BYS, "group_by") as GroupBy;
    const sort = typeof args.sort_by === "string" ? (canonical(args.sort_by, SORTS, "sort_by") as GroupSort) : undefined;
    const limit = intArg(args.limit, 25, 1, 60);
    const filters = parseLeadFilters(args);
    const result = await filterLeads(filters, ctx);
    const agentName = await ctx.data.names();
    const rows = breakdown(result.leads, by, { tz: ctx.timezone, dateField: result.dateField, agentName }, sort);
    const data: Record<string, unknown> = {
      visible_scope: await leadScopeLine(ctx),
      group_by: by,
      filters: result.applied,
      total_leads: result.leads.length,
      total_groups: rows.length,
      groups: rows.slice(0, limit),
    };
    if (rows.length > limit) data.truncated = `Showing ${limit} of ${rows.length} groups.`;
    if (by === "service") data.note = "A lead with several services counts once in each of them, so group totals can exceed total_leads.";
    if (result.notes.length) data.notes = result.notes;
    const top = rows[0];
    return {
      data,
      summary: `${rows.length} ${by} group${rows.length === 1 ? "" : "s"}${top ? ` · top: ${top.group} (${top.leads})` : ""}`,
    };
  },
};

/* ----------------------------------------------------------------- search */

const FOLLOW_UP_FILTERS = ["overdue", "due_today", "next_7_days", "none_scheduled"] as const;
const SEARCH_SORTS = ["newest", "oldest", "recently_updated", "follow_up_soonest", "price_high", "rating_high", "no_pickup_streak"] as const;

function matchesText(lead: Lead, q: string): boolean {
  const digits = q.replace(/\D/g, "");
  if (digits.length >= 4 && (lead.business_phone ?? "").replace(/\D/g, "").includes(digits)) return true;
  const hay = [
    lead.business_name,
    lead.owner_name,
    lead.business_email,
    lead.category,
    leadRegion(lead),
    ...(lead.services ?? []),
    lead.comments,
    lead.about_business,
  ]
    .filter(Boolean)
    .join(" \n ")
    .toLowerCase();
  return hay.includes(q.toLowerCase());
}

export const searchLeadsTool: AssistantTool = {
  name: "search_leads",
  label: "Searching leads",
  description:
    "Find specific leads the user can see and list them (compact rows with a link). Text query matches business name, owner, email, phone digits, category, state, services, comments and the about-the-business notes. Also filter by the follow-up queue (overdue, due today, next 7 days, none scheduled), a minimum no-pickup streak, a price range, or the shared lead filters. Use it for 'who should I call', 'which leads mention X', 'my biggest open deals'.",
  parameters: {
    type: "object",
    properties: {
      query: { type: "string", description: "Free-text search." },
      follow_up: { type: "string", enum: [...FOLLOW_UP_FILTERS], description: "Filter by the next scheduled follow-up." },
      min_no_pickup_streak: { type: "integer", minimum: 1, description: "Only leads with at least this many unanswered calls in a row." },
      min_price: { type: "number", description: "Minimum quoted one-time price." },
      max_price: { type: "number", description: "Maximum quoted one-time price." },
      sort: { type: "string", enum: [...SEARCH_SORTS], description: "Order of results (default newest)." },
      limit: { type: "integer", minimum: 1, maximum: 50, description: "Most rows to return (default 20)." },
      ...LEAD_FILTER_PROPERTIES,
    },
  },
  available: (perms) => perms.has("leads.view"),
  async run(args, ctx) {
    const filters = parseLeadFilters(args);
    const result = await filterLeads(filters, ctx);
    let leads = result.leads;
    const q = typeof args.query === "string" ? args.query.trim() : "";
    if (q) leads = leads.filter((l) => matchesText(l, q));

    const nowMs = ctx.now.getTime();
    const today = localDateKey(ctx.now, ctx.timezone);
    const weekOut = addDays(today, 7);
    if (typeof args.follow_up === "string") {
      const which = canonical(args.follow_up, FOLLOW_UP_FILTERS, "follow_up");
      leads = leads.filter((l) => {
        if (which === "none_scheduled") return !l.follow_up_time;
        if (!l.follow_up_time) return false;
        const t = new Date(l.follow_up_time).getTime();
        const day = localDateKey(l.follow_up_time, ctx.timezone);
        if (which === "overdue") return t < nowMs;
        if (which === "due_today") return t >= nowMs && day === today;
        return t >= nowMs && day <= weekOut;
      });
    }
    const minStreak = intArg(args.min_no_pickup_streak, 0, 0, 1000);
    if (minStreak > 0) leads = leads.filter((l) => (l.no_pickup_streak ?? 0) >= minStreak);
    if (typeof args.min_price === "number") leads = leads.filter((l) => (money(l.price_quoted) ?? -Infinity) >= (args.min_price as number));
    if (typeof args.max_price === "number") leads = leads.filter((l) => (money(l.price_quoted) ?? Infinity) <= (args.max_price as number));

    const sort = typeof args.sort === "string" ? canonical(args.sort, SEARCH_SORTS, "sort") : "newest";
    const t = (iso: string | null | undefined, missing: number) => (iso ? new Date(iso).getTime() : missing);
    const sorted = [...leads].sort((a, b) => {
      switch (sort) {
        case "oldest":
          return t(a.created_at, 0) - t(b.created_at, 0);
        case "recently_updated":
          return t(b.updated_at, 0) - t(a.updated_at, 0);
        case "follow_up_soonest":
          return t(a.follow_up_time, Infinity) - t(b.follow_up_time, Infinity);
        case "price_high":
          return (money(b.price_quoted) ?? -1) - (money(a.price_quoted) ?? -1);
        case "rating_high":
          return (b.rating ?? -1) - (a.rating ?? -1);
        case "no_pickup_streak":
          return (b.no_pickup_streak ?? 0) - (a.no_pickup_streak ?? 0);
        default:
          return t(b.created_at, 0) - t(a.created_at, 0);
      }
    });

    const limit = intArg(args.limit, 20, 1, 50);
    const agentName = await ctx.data.names();
    const rows = sorted.slice(0, limit).map((l) => ({
      id: l.id,
      business_name: l.business_name,
      status: l.status,
      agent: agentName(l.agent_id),
      category: l.category ?? null,
      region: leadRegion(l),
      price_quoted: money(l.price_quoted),
      yearly_price: money(l.yearly_price),
      rating: l.rating,
      next_follow_up: localStamp(l.follow_up_time, ctx.timezone),
      last_call: l.last_followup_status,
      no_pickup_streak: l.no_pickup_streak ?? 0,
      created: localDateKey(l.created_at, ctx.timezone),
      closed: l.closed_at ? localDateKey(l.closed_at, ctx.timezone) : null,
      link: `/leads/${l.id}`,
    }));
    const data: Record<string, unknown> = {
      visible_scope: await leadScopeLine(ctx),
      filters: { ...result.applied, ...(q ? { query: q } : {}), sort },
      total_matches: sorted.length,
      showing: rows.length,
      leads: rows,
    };
    if (result.notes.length) data.notes = result.notes;
    return { data, summary: `${sorted.length} match${sorted.length === 1 ? "" : "es"}${sorted.length > rows.length ? ` · showing ${rows.length}` : ""}` };
  },
};

/* ---------------------------------------------------------------- details */

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const clip = (s: string | null | undefined, n: number) => (s && s.length > n ? `${s.slice(0, n)}…` : s ?? null);

export const leadDetailsTool: AssistantTool = {
  name: "get_lead_details",
  label: "Opening the lead",
  description:
    "Everything about ONE lead the user can see: its fields, contact details, price and notes, its full follow-up call history with comments, its status history, and (where the user may see them) its tickets and contracts. Pass the lead's id (from search_leads) or its business name.",
  parameters: {
    type: "object",
    properties: {
      lead_id: { type: "string", description: "The lead's id." },
      business_name: { type: "string", description: "The business name, when the id is unknown." },
    },
  },
  available: (perms) => perms.has("leads.view"),
  async run(args, ctx) {
    const visible = await ctx.data.leads();
    let lead: Lead | undefined;
    const id = typeof args.lead_id === "string" ? args.lead_id.trim() : "";
    const name = typeof args.business_name === "string" ? args.business_name.trim() : "";
    if (id) {
      if (!UUID.test(id)) throw new ToolError(`"${id}" is not a lead id. Use search_leads to find it, or pass business_name.`);
      lead = visible.find((l) => l.id === id);
      if (!lead) throw new ToolError("No lead with that id is visible to you.");
    } else if (name) {
      const lower = name.toLowerCase();
      const exact = visible.filter((l) => l.business_name.trim().toLowerCase() === lower);
      const hits = exact.length ? exact : visible.filter((l) => l.business_name.toLowerCase().includes(lower));
      if (!hits.length) throw new ToolError(`No visible lead is called "${name}".`);
      if (hits.length > 1) {
        return {
          data: {
            ambiguous: true,
            message: `${hits.length} visible leads match "${name}". Ask which one, or call again with its lead_id.`,
            candidates: hits.slice(0, 10).map((l) => ({ id: l.id, business_name: l.business_name, status: l.status, region: leadRegion(l) })),
          },
          summary: `${hits.length} leads match "${name}"`,
        };
      }
      lead = hits[0];
    } else {
      throw new ToolError("Pass lead_id or business_name.");
    }

    const agentName = await ctx.data.names();
    // Visibility is already proven: the lead came back through the USER's
    // client. The ledger below is service-role only (like the Agent Report
    // that reads it), so it is read for this one visible lead and nothing else.
    const [{ data: fus }, { data: events }] = await Promise.all([
      ctx.db
        .from("lead_follow_ups")
        .select("fu_status, comments, next_follow_up_time, status_change, created_at, user_id")
        .eq("lead_id", lead.id)
        .order("created_at", { ascending: false })
        .limit(40),
      ctx.admin
        .from("lead_status_events")
        .select("from_status, to_status, changed_by, changed_at, source")
        .eq("lead_id", lead.id)
        .order("changed_at", { ascending: true })
        .limit(60),
    ]);

    const data: Record<string, unknown> = {
      lead: {
        id: lead.id,
        link: `/leads/${lead.id}`,
        business_name: lead.business_name,
        owner_name: lead.owner_name ?? null,
        status: lead.status,
        agent: agentName(lead.agent_id),
        closed_by: lead.closed_by ? agentName(lead.closed_by) : null,
        phone: lead.business_phone,
        email: lead.business_email,
        region: leadRegion(lead),
        category: lead.category ?? null,
        site_type: lead.site_type,
        platform: lead.platform,
        services: lead.services,
        service_areas: lead.service_areas,
        pages: lead.num_webpages,
        add_ons: Array.isArray(lead.add_ons) ? lead.add_ons.map((a) => a?.label).filter(Boolean) : [],
        price_quoted: money(lead.price_quoted),
        yearly_price: money(lead.yearly_price),
        rating: lead.rating,
        fresh_or_follow_up: lead.fresh_or_followup,
        next_follow_up: localStamp(lead.follow_up_time, ctx.timezone),
        next_follow_up_is_exact_time: lead.follow_up_is_specific ?? false,
        last_call: lead.last_followup_status,
        no_pickup_streak: lead.no_pickup_streak ?? 0,
        website: lead.website_link,
        created: localStamp(lead.created_at, ctx.timezone),
        first_call: localStamp(lead.first_touch_at, ctx.timezone),
        closed: localStamp(lead.closed_at, ctx.timezone),
        dropped: localStamp(lead.dropped_at, ctx.timezone),
        comments: clip(lead.comments, 2000),
        about_business: clip(lead.about_business, 2000),
        developer_instructions: clip(lead.developer_instructions, 1000),
      },
      follow_up_calls: (fus ?? []).map((f) => ({
        at: localStamp(f.created_at as string, ctx.timezone),
        by: agentName(f.user_id as string | null),
        result: f.fu_status,
        comments: clip(f.comments as string | null, 400),
        next_follow_up: localStamp(f.next_follow_up_time as string | null, ctx.timezone),
        status_change: f.status_change,
      })),
      status_history: (events ?? []).map((e) => ({
        at: localStamp(e.changed_at as string, ctx.timezone),
        from: e.from_status,
        to: e.to_status,
        by: e.changed_by ? agentName(e.changed_by as string) : null,
        approximate: e.source === "backfill_approx",
      })),
    };

    if (ctx.perms.has("tickets.view")) {
      // Same rule as the Tickets page: the queue is read with the service role
      // and narrowed to what this user may see.
      const scope = await allowedTicketScope(ctx.admin, ctx.userId, ctx.perms);
      const { data: tickets } = await ctx.admin
        .from("lead_tickets")
        .select("id, lead_id, created_by, assigned_to, title, category, priority, status, created_at, resolved_at, due_date")
        .eq("lead_id", lead.id)
        .order("created_at", { ascending: false })
        .limit(20);
      data.tickets = (tickets ?? [])
        .filter((t) => ticketInScope(t as { created_by: string | null; lead_id: string }, ctx.userId, scope))
        .map((t) => ({
          title: t.title,
          category: t.category,
          priority: t.priority,
          status: t.status,
          assigned_to: t.assigned_to ? agentName(t.assigned_to as string) : null,
          opened: localStamp(t.created_at as string, ctx.timezone),
          resolved: localStamp(t.resolved_at as string | null, ctx.timezone),
          link: `/tickets/${t.id}`,
        }));
    }
    if (ctx.perms.has("contracts.view") || ctx.perms.has("contracts.send")) {
      const { data: contracts } = await ctx.db
        .from("contracts")
        .select("status, sent_at, one_time_price, yearly_price, created_at")
        .eq("lead_id", lead.id)
        .order("created_at", { ascending: false })
        .limit(10);
      data.contracts = (contracts ?? []).map((c) => ({
        status: c.status,
        sent: localStamp(c.sent_at as string | null, ctx.timezone),
        one_time_price: money(c.one_time_price),
        yearly_price: money(c.yearly_price),
      }));
    }

    const calls = (fus ?? []).length;
    return { data, summary: `${lead.business_name} · ${lead.status} · ${calls} call${calls === 1 ? "" : "s"} logged` };
  },
};
