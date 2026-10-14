import type { SupabaseClient } from "@supabase/supabase-js";
import { actAs, ActAsError } from "@/lib/auth/actAs";
import { getUserPermissions } from "@/lib/permissions/resolver";
import { createClient } from "@/lib/supabase/server";
import { getAppSettings } from "@/lib/settings/appSettings";
import { callRoute } from "./actions/invoke";
import { bell, isAdminMember } from "./actions/people";
import { expireStale, isMissingActionTables } from "./actions/store";
import type { ActionContext } from "./actions/types";
import { getRuleTemplate, nextRunAt, type StoredRule } from "./rules";

/**
 * SED AI's clock: everything it promised to do LATER. Run every minute by the
 * instrumentation poller (POST /api/assistant/scheduler). SERVER ONLY.
 *
 *  - reminders that are due become bell notifications;
 *  - holiday handovers that end send the leads back;
 *  - standing rules that are due run, as their owner;
 *  - proposals nobody confirmed in time expire.
 *
 * Each item is CLAIMED before it is worked (a conditional update), so two
 * overlapping ticks — or two servers — never do the same thing twice. Work
 * done for a person runs as them (lib/auth/actAs.ts): their permissions,
 * their row-level security, the app's own endpoints.
 */

export interface SchedulerReport {
  expired: number;
  reminders: number;
  handoffs: number;
  rules: number;
  errors: string[];
}

const BATCH = 25;
const bulkRoute = () => import("@/app/api/leads/bulk/route");

/** An ActionContext for someone, inside their acting session. */
async function contextFor(admin: SupabaseClient, userId: string, timezone: string): Promise<ActionContext> {
  const db = await createClient();
  const [perms, isAdmin, profile] = await Promise.all([
    getUserPermissions(userId),
    isAdminMember(admin, userId).catch(() => false),
    admin.from("profiles").select("display_name, email").eq("id", userId).maybeSingle(),
  ]);
  const p = profile.data as { display_name?: string | null; email?: string } | null;
  return { userId, displayName: p?.display_name || p?.email || "someone", perms, db, admin, timezone, now: new Date(), isAdmin };
}

async function dueReminders(admin: SupabaseClient, now: Date, report: SchedulerReport) {
  const { data } = await admin
    .from("assistant_reminders")
    .select("id, user_id, text, lead_id, target_url")
    .eq("status", "pending")
    .lte("remind_at", now.toISOString())
    .order("remind_at")
    .limit(BATCH);
  for (const r of (data ?? []) as { id: string; user_id: string; text: string; lead_id: string | null; target_url: string | null }[]) {
    const { data: claimed } = await admin
      .from("assistant_reminders")
      .update({ status: "sent", sent_at: now.toISOString() })
      .eq("id", r.id)
      .eq("status", "pending")
      .select("id")
      .maybeSingle();
    if (!claimed) continue;
    await bell(admin, r.user_id, {
      title: "Reminder",
      body: r.text,
      dedupKey: `assistant_reminder:${r.id}`,
      targetUrl: r.target_url ?? (r.lead_id ? `/leads/${r.lead_id}` : null),
      leadId: r.lead_id,
      eventKey: "assistant_reminder",
    });
    report.reminders++;
  }
}

async function dueHandoffs(admin: SupabaseClient, now: Date, report: SchedulerReport) {
  const { data } = await admin
    .from("assistant_handoffs")
    .select("id, user_id, from_agent, to_agent, lead_ids, action_id")
    .eq("status", "active")
    .lte("ends_at", now.toISOString())
    .limit(BATCH);
  for (const h of (data ?? []) as { id: string; user_id: string; from_agent: string; to_agent: string; lead_ids: string[]; action_id: string | null }[]) {
    // Claim: an active handover becomes "returned" exactly once.
    const { data: claimed } = await admin.from("assistant_handoffs").update({ status: "returned", returned_at: now.toISOString() }).eq("id", h.id).eq("status", "active").select("id").maybeSingle();
    if (!claimed) continue;
    // Whoever made the handover (the requester, or the admin who approved it) moves them back.
    const { data: action } = h.action_id ? await admin.from("assistant_actions").select("user_id, approver_id").eq("id", h.action_id).maybeSingle() : { data: null };
    const executor = (action as { approver_id?: string | null; user_id?: string } | null)?.approver_id ?? h.user_id;
    try {
      const { data: still } = await admin.from("leads").select("id").in("id", h.lead_ids).eq("agent_id", h.to_agent).is("deleted_at", null);
      const back = ((still ?? []) as { id: string }[]).map((l) => l.id);
      if (back.length) {
        await actAs(executor, () => callRoute(bulkRoute, "POST", { path: "/api/leads/bulk", body: { ids: back, action: "assign", value: h.from_agent } }));
      }
      await admin.from("assistant_handoffs").update({ returned_count: back.length }).eq("id", h.id);
      for (const uid of new Set([h.from_agent, h.user_id])) {
        await bell(admin, uid, {
          title: "Your leads are back",
          body: `${back.length} lead${back.length === 1 ? "" : "s"} came back from the handover${back.length < h.lead_ids.length ? ` (${h.lead_ids.length - back.length} were closed, dropped or moved meanwhile and stayed)` : ""}.`,
          dedupKey: `assistant_handoff:${h.id}:${uid}`,
          targetUrl: "/leads",
          eventKey: "assistant_handoff",
        });
      }
      report.handoffs++;
    } catch (e) {
      const message = e instanceof ActAsError ? e.message : e instanceof Error ? e.message : String(e);
      await admin.from("assistant_handoffs").update({ status: "failed", error: message.slice(0, 500) }).eq("id", h.id);
      await bell(admin, h.user_id, {
        title: "Handover could not be returned",
        body: `The leads handed over could not be moved back automatically: ${message}. Move them back by hand.`,
        dedupKey: `assistant_handoff_failed:${h.id}`,
        targetUrl: "/leads",
        eventKey: "assistant_handoff",
      });
      report.errors.push(`handoff ${h.id}: ${message}`);
    }
  }
}

async function dueRules(admin: SupabaseClient, now: Date, timezone: string, report: SchedulerReport) {
  const { data } = await admin
    .from("assistant_rules")
    .select("id, user_id, name, template, params, schedule, enabled, last_run_at, next_run_at, last_result, runs, created_at")
    .eq("enabled", true)
    .lte("next_run_at", now.toISOString())
    .order("next_run_at")
    .limit(BATCH);
  // Claim each due rule by moving its next_run_at forward first: only one
  // tick (or server) gets this run.
  const claimed: StoredRule[] = [];
  for (const rule of (data ?? []) as StoredRule[]) {
    const next = nextRunAt(rule.schedule, now, timezone).toISOString();
    const { data: won } = await admin
      .from("assistant_rules")
      .update({ next_run_at: next })
      .eq("id", rule.id)
      .eq("next_run_at", rule.next_run_at as string)
      .select("id")
      .maybeSingle();
    if (won) claimed.push(rule);
  }

  // One acting session per person, however many of their rules are due.
  const byUser = new Map<string, StoredRule[]>();
  for (const r of claimed) byUser.set(r.user_id, [...(byUser.get(r.user_id) ?? []), r]);
  for (const [userId, rules] of byUser) {
    const results = new Map<string, Record<string, unknown>>();
    try {
      await actAs(userId, async () => {
        const ctx = await contextFor(admin, userId, timezone);
        for (const rule of rules) {
          const template = getRuleTemplate(rule.template);
          try {
            if (!template) throw new Error(`Unknown rule kind "${rule.template}".`);
            const blocked = template.allowed(ctx, rule.params);
            if (blocked) throw new Error(blocked);
            const run = await template.run(rule, ctx);
            results.set(rule.id, { ok: true, summary: run.summary, changed: run.changed, at: now.toISOString() });
            report.rules++;
          } catch (e) {
            const message = e instanceof Error ? e.message : String(e);
            results.set(rule.id, { ok: false, error: message.slice(0, 500), at: now.toISOString() });
            report.errors.push(`rule ${rule.id}: ${message}`);
          }
        }
      });
    } catch (e) {
      // Could not act as them at all (deactivated, sign-in failed): every rule says so.
      const message = e instanceof Error ? e.message : String(e);
      for (const rule of rules) if (!results.has(rule.id)) results.set(rule.id, { ok: false, error: message.slice(0, 500), at: now.toISOString() });
      report.errors.push(`rules of ${userId}: ${message}`);
    }
    for (const rule of rules) {
      await admin
        .from("assistant_rules")
        .update({ last_run_at: now.toISOString(), last_result: results.get(rule.id) ?? null, runs: (rule.runs ?? 0) + 1, updated_at: now.toISOString() })
        .eq("id", rule.id);
    }
  }
}

/** One tick. Never throws: a broken part is reported and the rest still runs. */
export async function runScheduler(admin: SupabaseClient, now = new Date()): Promise<SchedulerReport> {
  const report: SchedulerReport = { expired: 0, reminders: 0, handoffs: 0, rules: 0, errors: [] };
  const timezone = (await getAppSettings().catch(() => null))?.work_timezone || "Asia/Karachi";
  const parts: [string, () => Promise<void>][] = [
    ["expire", async () => void (report.expired = await expireStale(admin, now))],
    ["reminders", () => dueReminders(admin, now, report)],
    ["handoffs", () => dueHandoffs(admin, now, report)],
    ["rules", () => dueRules(admin, now, timezone, report)],
  ];
  for (const [name, part] of parts) {
    try {
      await part();
    } catch (e) {
      // Migration 0087 not applied yet: nothing to do, quietly.
      if (isMissingActionTables(e)) return report;
      report.errors.push(`${name}: ${e instanceof Error ? e.message : String(e)}`);
    }
  }
  return report;
}
