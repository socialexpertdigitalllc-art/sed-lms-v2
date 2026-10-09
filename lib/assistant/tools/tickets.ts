import { allowedTicketScope, ticketInScope } from "@/lib/tickets/scope";
import { isOverdue } from "@/lib/tickets/logic";
import { TICKET_STATUSES, type TicketStatus } from "@/lib/tickets/types";
import { avg, median, round } from "../analytics";
import { fetchAll, fetchByIds } from "./data";
import { canonical, intArg, localStamp, PERIOD_PROPERTIES, periodFrom, resolveUser } from "./filters";
import type { AssistantTool } from "./types";

interface TicketLite {
  id: string;
  lead_id: string;
  created_by: string | null;
  assigned_to: string | null;
  title: string | null;
  category: string;
  priority: string;
  status: string;
  created_at: string;
  resolved_at: string | null;
  due_date: string | null;
}

const LISTS = ["oldest_open", "overdue", "recent", "none"] as const;

export const ticketsOverviewTool: AssistantTool = {
  name: "get_tickets_overview",
  label: "Reviewing tickets",
  description:
    "The website change/improvement tickets the user can see (the same queue as the Tickets page): counts by status, priority and category, open and overdue against SLA, average and median resolution time, workload per assignee, and a list (oldest open, overdue, or most recent). Filter by created date, status or assignee.",
  parameters: {
    type: "object",
    properties: {
      ...PERIOD_PROPERTIES,
      status: { type: "array", items: { type: "string", enum: [...TICKET_STATUSES] }, description: "Only these statuses." },
      assigned_to: { type: "string", description: "Only tickets assigned to this person (name, or \"me\")." },
      list: { type: "string", enum: [...LISTS], description: "Which tickets to list (default oldest_open)." },
      limit: { type: "integer", minimum: 1, maximum: 30, description: "Most tickets to list (default 10)." },
    },
  },
  available: (perms) => perms.has("tickets.view"),
  async run(args, ctx) {
    const period = periodFrom({ from: args.from as string | undefined, to: args.to as string | undefined }, ctx, "all");
    // The Tickets page's own rule: read the queue with the service role, then
    // keep what this user may see (everything with tickets.view_all; else
    // tickets they opened or on leads assigned to them).
    const [rows, scope, name] = await Promise.all([
      fetchAll<TicketLite>((from, to) =>
        ctx.admin
          .from("lead_tickets")
          .select("id, lead_id, created_by, assigned_to, title, category, priority, status, created_at, resolved_at, due_date")
          .order("created_at", { ascending: false })
          .order("id", { ascending: true })
          .range(from, to),
      ),
      allowedTicketScope(ctx.admin, ctx.userId, ctx.perms),
      ctx.data.names(),
    ]);
    let tickets = rows.filter((t) => ticketInScope(t, ctx.userId, scope));
    const applied: Record<string, unknown> = {};
    if (period) {
      tickets = tickets.filter((t) => {
        const at = new Date(t.created_at).getTime();
        return at >= period.fromMs && at < period.toExMs;
      });
      applied.created = { from: period.from, to: period.to };
    }
    const statusArg = Array.isArray(args.status) ? args.status : typeof args.status === "string" ? [args.status] : [];
    if (statusArg.length) {
      const set = new Set(statusArg.filter((s): s is string => typeof s === "string").map((s) => canonical(s, TICKET_STATUSES, "status")));
      tickets = tickets.filter((t) => set.has(t.status as TicketStatus));
      applied.status = [...set];
    }
    if (typeof args.assigned_to === "string" && args.assigned_to.trim()) {
      const who = await resolveUser(args.assigned_to, ctx);
      tickets = tickets.filter((t) => t.assigned_to === who.id);
      applied.assigned_to = who.name;
    }

    const count = (key: keyof TicketLite) => {
      const m: Record<string, number> = {};
      for (const t of tickets) m[String(t[key])] = (m[String(t[key])] ?? 0) + 1;
      return m;
    };
    const open = tickets.filter((t) => t.status !== "Resolved");
    const overdue = open.filter((t) => isOverdue(t.due_date, t.status as TicketStatus, ctx.now));
    const resHours = tickets
      .filter((t) => t.resolved_at)
      .map((t) => (new Date(t.resolved_at!).getTime() - new Date(t.created_at).getTime()) / 3_600_000)
      .filter((h) => h >= 0);

    const byAssignee = new Map<string, { open: number; resolved: number; hours: number[] }>();
    for (const t of tickets) {
      const who = t.assigned_to ? name(t.assigned_to) : "Unassigned";
      const a = byAssignee.get(who) ?? { open: 0, resolved: 0, hours: [] };
      if (t.status === "Resolved") {
        a.resolved++;
        if (t.resolved_at) a.hours.push((new Date(t.resolved_at).getTime() - new Date(t.created_at).getTime()) / 3_600_000);
      } else a.open++;
      byAssignee.set(who, a);
    }

    const which = typeof args.list === "string" ? canonical(args.list, LISTS, "list") : "oldest_open";
    const limit = intArg(args.limit, 10, 1, 30);
    const pick =
      which === "none"
        ? []
        : which === "overdue"
          ? [...overdue].sort((a, b) => a.created_at.localeCompare(b.created_at))
          : which === "recent"
            ? [...tickets].sort((a, b) => b.created_at.localeCompare(a.created_at))
            : [...open].sort((a, b) => a.created_at.localeCompare(b.created_at));
    const listed = pick.slice(0, limit);
    const leadNames = new Map<string, string>();
    const leadIds = [...new Set(listed.map((t) => t.lead_id))];
    if (leadIds.length) {
      const leads = await fetchByIds<{ id: string; business_name: string }>(leadIds, (chunk) =>
        ctx.admin.from("leads").select("id, business_name").in("id", chunk),
      );
      for (const l of leads) leadNames.set(l.id, l.business_name);
    }

    const data = {
      filters: applied,
      visible_scope: ctx.perms.has("tickets.view_all") ? "every ticket" : "tickets you opened and tickets on your leads",
      total: tickets.length,
      open: open.length,
      overdue_against_sla: overdue.length,
      by_status: count("status"),
      by_priority: count("priority"),
      by_category: count("category"),
      resolution_hours: { average: round(avg(resHours), 1), median: round(median(resHours), 1), resolved: resHours.length },
      by_assignee: [...byAssignee.entries()]
        .map(([assignee, a]) => ({ assignee, open: a.open, resolved: a.resolved, avg_resolution_hours: round(avg(a.hours), 1) }))
        .sort((a, b) => b.open - a.open),
      list: which === "none" ? undefined : which,
      tickets: listed.map((t) => ({
        title: t.title,
        lead: leadNames.get(t.lead_id) ?? null,
        status: t.status,
        priority: t.priority,
        category: t.category,
        assigned_to: t.assigned_to ? name(t.assigned_to) : null,
        opened: localStamp(t.created_at, ctx.timezone),
        age_days: round((ctx.now.getTime() - new Date(t.created_at).getTime()) / 86_400_000, 1),
        due: localStamp(t.due_date, ctx.timezone),
        link: `/tickets/${t.id}`,
      })),
    };
    return { data, summary: `${tickets.length} tickets · ${open.length} open · ${overdue.length} overdue` };
  },
};
