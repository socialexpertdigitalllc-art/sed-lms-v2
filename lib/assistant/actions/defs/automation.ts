import { describeSchedule, getRuleTemplate, nextRunAt, RULE_TEMPLATES, WEEKDAY_NAMES, type RuleSchedule } from "../../rules";
import type { CardItem } from "../card";
import { formatDateTime } from "../fields";
import { needAdmin, plural, str } from "../helpers";
import { callRoute } from "../invoke";
import type { ActionContext, ActionDef, Problem, Values } from "../types";

/**
 * Automations people set up by asking: standing rules ("after three
 * no-pickups, move the lead to Long Term") and a holiday handover ("give my
 * leads to Sara until Monday" — and back again on Monday, automatically).
 * Both are confirmed on a card like any change, and run later by the
 * scheduler (lib/assistant/scheduler.ts).
 */

const bulkRoute = () => import("@/app/api/leads/bulk/route");

const EVERY = ["Every hour", "Every day", "Every week"] as const;
const TEMPLATE_TITLES = RULE_TEMPLATES.map((t) => t.title);
const templateOf = (v: Values) => RULE_TEMPLATES.find((t) => t.title === v.rule);

function scheduleOf(v: Values): RuleSchedule {
  const at = /^\d{1,2}:\d{2}$/.test(str(v.at)) ? str(v.at).padStart(5, "0") : "09:00";
  if (v.every === "Every hour") return { every: "hour" };
  if (v.every === "Every week") return { every: "week", weekday: Math.max(1, WEEKDAY_NAMES.indexOf(v.weekday as (typeof WEEKDAY_NAMES)[number]) + 1), at };
  return { every: "day", at };
}

function paramsOf(v: Values): Record<string, unknown> {
  const t = templateOf(v);
  if (t?.key === "no_pickup_move") return { streak: v.streak ?? 3, to_status: v.to_status ?? "Long Term" };
  if (t?.key === "stale_not_ready") return { days: v.days ?? 14 };
  return {};
}

const ruleCreate: ActionDef = {
  key: "rule.create",
  group: "Personal",
  title: "Set up a standing rule",
  description:
    "Something SED AI keeps doing for the person on a schedule, as them: move Ready leads after repeated no-pickups, a morning count of overdue follow-ups, stale Not Ready leads, closed deals without a receipt, Ready leads without a website build. Only these rule kinds exist.",
  confirmLabel: "Turn on rule",
  risk: (v) => (templateOf(v)?.key === "no_pickup_move" ? "sensitive" : "standard"),
  allowed: () => null,
  // The person's own standing rules: never set up by an approver in their place.
  selfOnly: true,
  fields: [
    { name: "rule", label: "Rule", type: "enum", options: TEMPLATE_TITLES, required: true },
    { name: "streak", label: "No-pickups in a row", type: "integer", min: 2, max: 20, default: 3, showIf: (v) => templateOf(v)?.key === "no_pickup_move" },
    { name: "to_status", label: "Move to", type: "enum", options: ["Long Term", "Dropped"], default: "Long Term", showIf: (v) => templateOf(v)?.key === "no_pickup_move" },
    { name: "days", label: "Untouched for (days)", type: "integer", min: 2, max: 180, default: 14, showIf: (v) => templateOf(v)?.key === "stale_not_ready" },
    {
      name: "every",
      label: "How often",
      type: "enum",
      options: EVERY,
      default: (_ctx: ActionContext, v: Values) => {
        const s = templateOf(v)?.defaultSchedule;
        return s?.every === "hour" ? "Every hour" : s?.every === "week" ? "Every week" : "Every day";
      },
    },
    { name: "at", label: "At (company time)", type: "text", default: "09:00", showIf: (v) => v.every !== "Every hour", help: "HH:mm, 24-hour." },
    { name: "weekday", label: "On", type: "enum", options: WEEKDAY_NAMES, default: "Monday", showIf: (v) => v.every === "Every week" },
    { name: "name", label: "Name", type: "text", max: 120 },
  ],
  label: (v) => str(v.name) || str(v.rule),
  produces: "rule",
  minutesSaved: 5,
  async check(v, ctx) {
    const problems: Problem[] = [];
    const t = templateOf(v);
    if (t) {
      const reason = t.allowed(ctx, paramsOf(v));
      if (reason) problems.push({ field: "rule", message: reason });
    }
    if (v.at !== undefined && !/^\d{1,2}:\d{2}$/.test(str(v.at))) problems.push({ field: "at", message: "Give the time as HH:mm, e.g. 09:30." });
    const { count } = await ctx.admin.from("assistant_rules").select("id", { count: "exact", head: true }).eq("user_id", ctx.userId);
    if ((count ?? 0) >= 20) problems.push({ field: "_", message: "You already have 20 standing rules. Turn one off first (SED AI actions → Reminders & automations)." });
    return { problems };
  },
  async preview(v, ctx) {
    const t = templateOf(v)!;
    const schedule = scheduleOf(v);
    return {
      title: `Standing rule — ${str(v.name) || t.title}`,
      fields: [
        { name: "what", label: "What", value: t.describe(paramsOf(v)) },
        { name: "when", label: "When", value: `${describeSchedule(schedule)} (${ctx.timezone})` },
        { name: "first", label: "First run", value: formatDateTime(nextRunAt(schedule, ctx.now, ctx.timezone), ctx.timezone, ctx.now) },
      ],
      notes: ["It runs as you, with your permissions. Turn it off any time under SED AI actions → Reminders & automations."],
      link: { href: "/assistant/actions?tab=automations", label: "Your automations" },
    };
  },
  async execute(v, ctx, info) {
    const t = templateOf(v)!;
    const schedule = scheduleOf(v);
    const { data, error } = await ctx.admin
      .from("assistant_rules")
      .insert({
        user_id: info.requesterId ?? ctx.userId,
        name: (str(v.name) || t.title).slice(0, 120),
        template: t.key,
        params: paramsOf(v),
        schedule,
        enabled: true,
        next_run_at: nextRunAt(schedule, new Date(), ctx.timezone).toISOString(),
      })
      .select("id")
      .single();
    if (error || !data) throw new Error(error?.message ?? "Could not save the rule");
    return {
      message: `Rule on: ${t.describe(paramsOf(v))} (${describeSchedule(schedule)}).`,
      link: { href: "/assistant/actions?tab=automations", label: "Your automations" },
      data: { id: data.id as string, kind: "rule" },
    };
  },
  undo: {
    async run(stored, ctx) {
      const id = stored.result?.data?.id;
      if (typeof id === "string") await ctx.admin.from("assistant_rules").delete().eq("id", id).eq("user_id", stored.user_id);
      return "the rule is gone.";
    },
  },
};

/* ------------------------------------------------------------ handover */

const MAX_HANDOFF_DAYS = 60;

async function openLeadsOf(ctx: ActionContext, agentId: string): Promise<{ id: string; business_name: string; status: string }[]> {
  const { data } = await ctx.admin
    .from("leads")
    .select("id, business_name, status")
    .eq("agent_id", agentId)
    .is("deleted_at", null)
    .not("status", "in", "(Closed,Dropped)")
    .order("updated_at", { ascending: false })
    .limit(500);
  return (data ?? []) as { id: string; business_name: string; status: string }[];
}

const handoffStart: ActionDef = {
  key: "handoff.start",
  group: "Leads",
  title: "Hand over leads until a date",
  description:
    "Holiday or sick-day cover: give an agent's open leads (or the ones named) to another Sales agent until a date — on that date the leads still with the stand-in go back automatically. Moving leads between agents is admin-only, so others send it for approval from the card.",
  confirmLabel: "Hand over",
  risk: "sensitive",
  allowed: (ctx) => needAdmin(ctx, "leads.assign"),
  fields: [
    { name: "to", label: "Give to", type: "ref", ref: "user", refFilter: "dept:sales", required: true },
    { name: "until", label: "Until", type: "datetime", future: true, required: true, help: "When the leads come back (company time)." },
    { name: "from", label: "Whose leads", type: "ref", ref: "user", default: (ctx: ActionContext) => ctx.userId, help: "Default: the person asking. Admins may hand over someone else's." },
    { name: "leads", label: "Leads", type: "refs", ref: "lead", max: 500, editable: false, help: "Leave out to hand over all their open leads." },
  ],
  bulkField: "leads",
  label: (v) => str(v.__to),
  minutesSaved: 10,
  async check(v, ctx) {
    const problems: Problem[] = [];
    const values: Values = {};
    const from = typeof v.from === "string" ? v.from : ctx.userId;
    if (from !== ctx.userId && !ctx.isAdmin) problems.push({ field: "from", message: "Only an admin can hand over someone else's leads." });
    if (typeof v.to === "string" && v.to === from) problems.push({ field: "to", message: "Pick someone else to cover." });
    if (typeof v.until === "string" && Date.parse(v.until) - ctx.now.getTime() > MAX_HANDOFF_DAYS * 86_400_000) {
      problems.push({ field: "until", message: `A handover can last at most ${MAX_HANDOFF_DAYS} days.` });
    }
    // Someone else's leads are only looked at for an admin.
    const open = from === ctx.userId || ctx.isAdmin ? await openLeadsOf(ctx, from) : [];
    if (Array.isArray(v.leads) && v.leads.length) {
      const mine = new Set(open.map((l) => l.id));
      const foreign = (v.leads as string[]).filter((id) => !mine.has(id));
      if (foreign.length) problems.push({ field: "leads", message: `${plural(foreign.length, "lead")} named are not open leads of that agent.` });
    } else if (open.length) values.leads = open.map((l) => l.id);
    else problems.push({ field: "leads", message: "That agent has no open leads to hand over." });
    if (typeof v.to === "string") {
      const { data } = await ctx.admin.from("profiles").select("display_name").eq("id", v.to).maybeSingle();
      values.__to = (data as { display_name?: string } | null)?.display_name ?? "";
    }
    return { problems, values };
  },
  async preview(v, ctx) {
    const ids = v.leads as string[];
    const { data } = await ctx.admin.from("leads").select("id, business_name, status").in("id", ids);
    const rows = (data ?? []) as { id: string; business_name: string; status: string }[];
    const items: CardItem[] = rows.map((r) => ({ id: r.id, label: r.business_name, detail: r.status, href: `/leads/${r.id}`, selected: true }));
    const back = formatDateTime(String(v.until), ctx.timezone, ctx.now);
    return {
      title: `Hand over ${plural(rows.length, "lead")} to ${str(v.__to)} until ${back}`,
      items,
      notes: [`On ${back} the leads still with ${str(v.__to)} go back automatically. Leads they close or drop meanwhile stay with them.`],
    };
  },
  async execute(v, ctx, info) {
    const ids = v.leads as string[];
    const from = typeof v.from === "string" ? v.from : (info.requesterId ?? ctx.userId);
    await callRoute(bulkRoute, "POST", { path: "/api/leads/bulk", body: { ids, action: "assign", value: v.to } });
    const { data, error } = await ctx.admin
      .from("assistant_handoffs")
      .insert({ user_id: info.requesterId ?? ctx.userId, from_agent: from, to_agent: v.to, lead_ids: ids, ends_at: v.until, action_id: info.actionId })
      .select("id")
      .single();
    if (error || !data) {
      // The leads moved but the return could not be scheduled: say so plainly.
      throw new Error(`The leads were handed over, but the automatic return could not be scheduled (${error?.message ?? "unknown error"}). Move them back by hand on the day.`);
    }
    return {
      message: `Handed over ${plural(ids.length, "lead")} to ${str(v.__to)}; they come back ${formatDateTime(String(v.until), ctx.timezone, ctx.now)}.`,
      link: { href: "/assistant/actions?tab=automations", label: "Your automations" },
      data: { id: data.id as string, kind: "handoff", ids },
    };
  },
  undo: {
    minutes: 30,
    async run(stored, ctx) {
      const id = stored.result?.data?.id;
      const ids = (stored.result?.data?.ids as string[] | undefined) ?? [];
      const { data: h } = await ctx.admin.from("assistant_handoffs").select("from_agent, to_agent, status").eq("id", String(id)).maybeSingle();
      const handoff = h as { from_agent: string; to_agent: string; status: string } | null;
      if (!handoff) throw new Error("The handover record is gone.");
      const { data: still } = await ctx.admin.from("leads").select("id").in("id", ids).eq("agent_id", handoff.to_agent).is("deleted_at", null);
      const back = ((still ?? []) as { id: string }[]).map((l) => l.id);
      if (back.length) await callRoute(bulkRoute, "POST", { path: "/api/leads/bulk", body: { ids: back, action: "assign", value: handoff.from_agent } });
      await ctx.admin.from("assistant_handoffs").update({ status: "cancelled", returned_count: back.length, returned_at: new Date().toISOString() }).eq("id", String(id));
      return `${plural(back.length, "lead")} moved back.`;
    },
  },
};

export const AUTOMATION_ACTIONS: ActionDef[] = [ruleCreate, handoffStart];

export { getRuleTemplate };
