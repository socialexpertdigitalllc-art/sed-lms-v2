import { catSetKey } from "@/lib/leads/categories";
import { zonedParts } from "./dates";
import { parseDateTime } from "./actions/fields";
import { callRoute } from "./actions/invoke";
import { bell } from "./actions/people";
import { need } from "./actions/helpers";
import type { ActionContext } from "./actions/types";

/**
 * STANDING RULES: things a person asks SED AI to keep doing for them — "after
 * three no-pickups in a row, move the lead to Long Term", "every morning, tell
 * me my overdue follow-ups". SERVER ONLY.
 *
 * A rule is one of the FIXED templates below with the person's parameters —
 * never free-form instructions — created through a confirmation card like any
 * other action, and run by the scheduler AS the person (their session, their
 * permissions, the app's own endpoints). A rule whose permission the person
 * later loses simply stops being able to do anything.
 */

export type RuleSchedule = { every: "hour" } | { every: "day"; at: string } | { every: "week"; weekday: number; at: string };

export interface StoredRule {
  id: string;
  user_id: string;
  name: string;
  template: string;
  params: Record<string, unknown>;
  schedule: RuleSchedule;
  enabled: boolean;
  last_run_at: string | null;
  next_run_at: string | null;
  last_result: Record<string, unknown> | null;
  runs: number;
  created_at: string;
}

export interface RuleRun {
  /** One line for the rule's "last run". */
  summary: string;
  changed: number;
}

export interface RuleTemplate {
  key: string;
  title: string;
  /** The rule in words, with its parameters: "Move my Ready leads to Long Term after 3 no-pickups in a row." */
  describe: (p: Record<string, unknown>) => string;
  /** Can this person have it? null = yes. */
  allowed: (ctx: ActionContext, p: Record<string, unknown>) => string | null;
  defaultSchedule: RuleSchedule;
  run: (rule: StoredRule, ctx: ActionContext) => Promise<RuleRun>;
}

const leadRoute = () => import("@/app/api/leads/[id]/route");
const MOVE_TARGETS = ["Long Term", "Dropped"] as const;

export const RULE_TEMPLATES: RuleTemplate[] = [
  {
    key: "no_pickup_move",
    title: "Move leads after repeated no-pickups",
    describe: (p) => `Move my Ready leads to ${String(p.to_status ?? "Long Term")} after ${Number(p.streak ?? 3)} no-pickups in a row.`,
    allowed: (ctx, p) => need(ctx, "leads.status_change", catSetKey(String(p.to_status ?? "Long Term"))),
    defaultSchedule: { every: "hour" },
    async run(rule, ctx) {
      const streak = Math.min(Math.max(Number(rule.params.streak) || 3, 2), 20);
      const to = MOVE_TARGETS.includes(rule.params.to_status as (typeof MOVE_TARGETS)[number]) ? String(rule.params.to_status) : "Long Term";
      const { data } = await ctx.db
        .from("leads")
        .select("id, business_name")
        .eq("agent_id", ctx.userId)
        .eq("status", "Ready")
        .gte("no_pickup_streak", streak)
        .is("deleted_at", null)
        .limit(100);
      const leads = (data ?? []) as { id: string; business_name: string }[];
      let moved = 0;
      for (const l of leads) {
        try {
          await callRoute(leadRoute, "PATCH", { path: `/api/leads/${l.id}`, params: { id: l.id }, body: { status: to } });
          moved++;
        } catch {
          /* counted as not moved; the summary says so */
        }
      }
      if (moved) {
        await bell(ctx.admin, ctx.userId, {
          title: `Moved ${moved} lead${moved === 1 ? "" : "s"} to ${to}`,
          body: `${leads.slice(0, 5).map((l) => l.business_name).join(", ")}${leads.length > 5 ? "…" : ""} — ${streak}+ no-pickups in a row (your rule “${rule.name}”).`,
          dedupKey: `assistant_rule:${rule.id}:${new Date().toISOString().slice(0, 13)}`,
          targetUrl: "/leads",
          eventKey: "assistant_rule",
        });
      }
      return { summary: leads.length ? `Moved ${moved} of ${leads.length} leads to ${to}.` : "Nothing to move.", changed: moved };
    },
  },
  {
    key: "overdue_digest",
    title: "Tell me my overdue follow-ups",
    describe: () => "Tell me how many of my follow-ups are overdue.",
    allowed: (ctx) => need(ctx, "leads.view"),
    defaultSchedule: { every: "day", at: "09:00" },
    async run(rule, ctx) {
      const { count } = await ctx.db
        .from("leads")
        .select("id", { count: "exact", head: true })
        .eq("agent_id", ctx.userId)
        .in("status", ["Ready", "Long Term"])
        .lt("follow_up_time", new Date().toISOString())
        .is("deleted_at", null);
      const n = count ?? 0;
      if (n) {
        await bell(ctx.admin, ctx.userId, {
          title: `${n} overdue follow-up${n === 1 ? "" : "s"}`,
          body: "Open your follow-ups — or ask SED AI to reschedule them.",
          dedupKey: `assistant_rule:${rule.id}:${new Date().toISOString().slice(0, 10)}`,
          targetUrl: "/leads/follow-ups",
          eventKey: "assistant_rule",
        });
      }
      return { summary: n ? `${n} overdue — you were notified.` : "No overdue follow-ups.", changed: 0 };
    },
  },
  {
    key: "stale_not_ready",
    title: "Flag Not Ready leads nobody touched",
    describe: (p) => `Tell me about my Not Ready leads untouched for ${Number(p.days ?? 14)} days.`,
    allowed: (ctx) => need(ctx, "leads.view"),
    defaultSchedule: { every: "week", weekday: 1, at: "09:00" },
    async run(rule, ctx) {
      const days = Math.min(Math.max(Number(rule.params.days) || 14, 2), 180);
      const { data } = await ctx.db
        .from("leads")
        .select("id, business_name")
        .eq("agent_id", ctx.userId)
        .eq("status", "Not Ready")
        .lt("updated_at", new Date(Date.now() - days * 86_400_000).toISOString())
        .is("deleted_at", null)
        .order("updated_at", { ascending: true })
        .limit(50);
      const leads = (data ?? []) as { id: string; business_name: string }[];
      if (leads.length) {
        await bell(ctx.admin, ctx.userId, {
          title: `${leads.length} Not Ready lead${leads.length === 1 ? "" : "s"} untouched for ${days}+ days`,
          body: `${leads.slice(0, 5).map((l) => l.business_name).join(", ")}${leads.length > 5 ? "…" : ""}`,
          dedupKey: `assistant_rule:${rule.id}:${new Date().toISOString().slice(0, 10)}`,
          targetUrl: leads.length === 1 ? `/leads/${leads[0].id}` : "/leads",
          eventKey: "assistant_rule",
        });
      }
      return { summary: leads.length ? `${leads.length} stale leads — you were notified.` : "No stale leads.", changed: 0 };
    },
  },
  {
    key: "closed_no_receipt",
    title: "Remind me of closed deals without a receipt",
    describe: () => "Remind me of deals closed in the last 30 days that have no payment receipt.",
    allowed: (ctx) => need(ctx, "receipts.send"),
    defaultSchedule: { every: "day", at: "10:00" },
    async run(rule, ctx) {
      const since = new Date(Date.now() - 30 * 86_400_000).toISOString();
      const { data: leads } = await ctx.db.from("leads").select("id, business_name").eq("status", "Closed").gte("closed_at", since).is("deleted_at", null).limit(200);
      const ids = ((leads ?? []) as { id: string }[]).map((l) => l.id);
      const { data: receipts } = ids.length ? await ctx.db.from("lead_receipts").select("lead_id").in("lead_id", ids) : { data: [] };
      const done = new Set(((receipts ?? []) as { lead_id: string }[]).map((r) => r.lead_id));
      const missing = ((leads ?? []) as { id: string; business_name: string }[]).filter((l) => !done.has(l.id));
      if (missing.length) {
        await bell(ctx.admin, ctx.userId, {
          title: `${missing.length} closed deal${missing.length === 1 ? "" : "s"} without a receipt`,
          body: `${missing.slice(0, 5).map((l) => l.business_name).join(", ")}${missing.length > 5 ? "…" : ""} — ask SED AI to prepare the receipts.`,
          dedupKey: `assistant_rule:${rule.id}:${new Date().toISOString().slice(0, 10)}`,
          targetUrl: missing.length === 1 ? `/leads/${missing[0].id}` : "/leads",
          eventKey: "assistant_rule",
        });
      }
      return { summary: missing.length ? `${missing.length} without a receipt — you were notified.` : "Every closed deal has a receipt.", changed: 0 };
    },
  },
  {
    key: "ready_no_build",
    title: "Remind me of Ready leads with no website build",
    describe: () => "Tell me which of my Ready leads have no Site Builder run yet.",
    allowed: (ctx) => need(ctx, "studio.manage"),
    defaultSchedule: { every: "day", at: "11:00" },
    async run(rule, ctx) {
      const { data: leads } = await ctx.db.from("leads").select("id, business_name").eq("agent_id", ctx.userId).eq("status", "Ready").is("deleted_at", null).limit(200);
      const ids = ((leads ?? []) as { id: string }[]).map((l) => l.id);
      const { data: runs } = ids.length ? await ctx.admin.from("builder_runs").select("lead_id").in("lead_id", ids) : { data: [] };
      const built = new Set(((runs ?? []) as { lead_id: string }[]).map((r) => r.lead_id));
      const missing = ((leads ?? []) as { id: string; business_name: string }[]).filter((l) => !built.has(l.id));
      if (missing.length) {
        await bell(ctx.admin, ctx.userId, {
          title: `${missing.length} Ready lead${missing.length === 1 ? "" : "s"} without a website build`,
          body: `${missing.slice(0, 5).map((l) => l.business_name).join(", ")}${missing.length > 5 ? "…" : ""} — ask SED AI to start the builds.`,
          dedupKey: `assistant_rule:${rule.id}:${new Date().toISOString().slice(0, 10)}`,
          targetUrl: "/ai-tools/site-builder/new",
          eventKey: "assistant_rule",
        });
      }
      return { summary: missing.length ? `${missing.length} without a build — you were notified.` : "Every Ready lead has a build.", changed: 0 };
    },
  },
];

export function getRuleTemplate(key: string): RuleTemplate | undefined {
  return RULE_TEMPLATES.find((t) => t.key === key);
}

export const WEEKDAY_NAMES = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"] as const;

export function describeSchedule(s: RuleSchedule): string {
  if (s.every === "hour") return "every hour";
  if (s.every === "day") return `every day at ${s.at}`;
  return `every ${WEEKDAY_NAMES[(s.weekday - 1 + 7) % 7]} at ${s.at}`;
}

const pad = (n: number) => String(n).padStart(2, "0");

/** The next time a schedule fires after `after`, in the company timezone. */
export function nextRunAt(s: RuleSchedule, after: Date, tz: string): Date {
  if (s.every === "hour") {
    const t = new Date(after.getTime());
    t.setUTCMinutes(0, 0, 0);
    return new Date(t.getTime() + 3_600_000);
  }
  const [h, m] = (/^\d{1,2}:\d{2}$/.test(s.at) ? s.at : "09:00").split(":").map(Number);
  for (let i = 0; i <= 8; i++) {
    const day = zonedParts(after.getTime() + i * 86_400_000, tz);
    const isoWeekday = day.weekday === 0 ? 7 : day.weekday;
    if (s.every === "week" && isoWeekday !== s.weekday) continue;
    const at = parseDateTime(`${day.year}-${pad(day.month)}-${pad(day.day)}T${pad(h)}:${pad(m)}`, tz);
    if (at && at.getTime() > after.getTime()) return at;
  }
  return new Date(after.getTime() + 86_400_000);
}
