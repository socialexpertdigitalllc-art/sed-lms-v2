import { NextResponse } from "next/server";
import { actionError, actionGuard } from "@/lib/assistant/actions/http";
import { describeSchedule, getRuleTemplate, type StoredRule } from "@/lib/assistant/rules";

export const runtime = "nodejs";

/** The caller's reminders, standing rules and handovers. */
export async function GET() {
  const guard = await actionGuard();
  if (!guard.ok) return guard.response;
  const { ctx } = guard.value;
  try {
    const [reminders, rules, handoffs] = await Promise.all([
      ctx.admin.from("assistant_reminders").select("id, text, remind_at, status, lead_id, target_url, sent_at").eq("user_id", ctx.userId).order("remind_at", { ascending: false }).limit(50),
      ctx.admin.from("assistant_rules").select("id, user_id, name, template, params, schedule, enabled, last_run_at, next_run_at, last_result, runs, created_at").eq("user_id", ctx.userId).order("created_at", { ascending: false }),
      ctx.admin.from("assistant_handoffs").select("id, from_agent, to_agent, lead_ids, ends_at, status, returned_count, error, created_at").or(`user_id.eq.${ctx.userId},from_agent.eq.${ctx.userId},to_agent.eq.${ctx.userId}`).order("created_at", { ascending: false }).limit(20),
    ]);
    for (const r of [reminders, rules, handoffs]) if (r.error) throw new Error(r.error.message);
    const people = [...new Set(((handoffs.data ?? []) as { from_agent: string; to_agent: string }[]).flatMap((h) => [h.from_agent, h.to_agent]))];
    const { data: profs } = people.length ? await ctx.admin.from("profiles").select("id, display_name").in("id", people) : { data: [] };
    const name = new Map(((profs ?? []) as { id: string; display_name: string | null }[]).map((p) => [p.id, p.display_name ?? "Someone"]));
    return NextResponse.json({
      reminders: reminders.data ?? [],
      rules: ((rules.data ?? []) as StoredRule[]).map((r) => ({
        id: r.id,
        name: r.name,
        what: getRuleTemplate(r.template)?.describe(r.params) ?? r.template,
        when: describeSchedule(r.schedule),
        enabled: r.enabled,
        lastRunAt: r.last_run_at,
        nextRunAt: r.next_run_at,
        lastResult: r.last_result,
      })),
      handoffs: ((handoffs.data ?? []) as { id: string; from_agent: string; to_agent: string; lead_ids: string[]; ends_at: string; status: string; returned_count: number; error: string | null }[]).map((h) => ({
        id: h.id,
        from: name.get(h.from_agent) ?? "Someone",
        to: name.get(h.to_agent) ?? "Someone",
        count: h.lead_ids.length,
        endsAt: h.ends_at,
        status: h.status,
        returned: h.returned_count,
        error: h.error,
      })),
    });
  } catch (e) {
    return actionError(e, "Could not load your automations.");
  }
}
