import { NextResponse } from "next/server";
import { z } from "zod";
import { actionError, actionGuard } from "@/lib/assistant/actions/http";
import { needAdmin } from "@/lib/assistant/actions/helpers";
import { callRoute } from "@/lib/assistant/actions/invoke";
import { UUID_RE } from "@/lib/assistant/http";
import { nextRunAt, type StoredRule } from "@/lib/assistant/rules";

export const runtime = "nodejs";

/**
 * Manage one of the caller's automations: cancel a reminder; turn a standing
 * rule on or off, or delete it; stop a handover's automatic return, or return
 * the leads now.
 */

const bodySchema = z.object({ action: z.enum(["cancel", "enable", "disable", "delete", "return"]) });
const bulkRoute = () => import("@/app/api/leads/bulk/route");

export async function POST(req: Request, { params }: { params: Promise<{ kind: string; id: string }> }) {
  const guard = await actionGuard();
  if (!guard.ok) return guard.response;
  const { ctx } = guard.value;
  const { kind, id } = await params;
  if (!UUID_RE.test(id)) return NextResponse.json({ error: "Not found" }, { status: 404 });
  const parsed = bodySchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Unknown change." }, { status: 422 });
  const { action } = parsed.data;
  try {
    if (kind === "reminder" && action === "cancel") {
      const { data } = await ctx.admin.from("assistant_reminders").update({ status: "cancelled" }).eq("id", id).eq("user_id", ctx.userId).eq("status", "pending").select("id").maybeSingle();
      if (!data) return NextResponse.json({ error: "That reminder is not pending." }, { status: 409 });
      return NextResponse.json({ ok: true });
    }
    if (kind === "rule" && (action === "enable" || action === "disable" || action === "delete")) {
      if (action === "delete") {
        const { data } = await ctx.admin.from("assistant_rules").delete().eq("id", id).eq("user_id", ctx.userId).select("id").maybeSingle();
        if (!data) return NextResponse.json({ error: "Rule not found" }, { status: 404 });
        return NextResponse.json({ ok: true });
      }
      const { data: rule } = await ctx.admin.from("assistant_rules").select("schedule").eq("id", id).eq("user_id", ctx.userId).maybeSingle();
      if (!rule) return NextResponse.json({ error: "Rule not found" }, { status: 404 });
      const enabled = action === "enable";
      await ctx.admin
        .from("assistant_rules")
        .update({
          enabled,
          updated_at: new Date().toISOString(),
          ...(enabled ? { next_run_at: nextRunAt((rule as Pick<StoredRule, "schedule">).schedule, new Date(), ctx.timezone).toISOString() } : {}),
        })
        .eq("id", id)
        .eq("user_id", ctx.userId);
      return NextResponse.json({ ok: true });
    }
    if (kind === "handoff" && (action === "cancel" || action === "return")) {
      const { data: h } = await ctx.admin.from("assistant_handoffs").select("id, user_id, from_agent, to_agent, lead_ids, status").eq("id", id).maybeSingle();
      const handoff = h as { id: string; user_id: string; from_agent: string; to_agent: string; lead_ids: string[]; status: string } | null;
      if (!handoff || (handoff.user_id !== ctx.userId && handoff.from_agent !== ctx.userId)) return NextResponse.json({ error: "Handover not found" }, { status: 404 });
      if (handoff.status !== "active") return NextResponse.json({ error: "That handover is already over." }, { status: 409 });
      if (action === "cancel") {
        await ctx.admin.from("assistant_handoffs").update({ status: "cancelled" }).eq("id", id).eq("status", "active");
        return NextResponse.json({ ok: true, message: "The leads stay where they are; nothing moves back automatically." });
      }
      const blocked = needAdmin(ctx, "leads.assign");
      if (blocked) return NextResponse.json({ error: `${blocked} Ask SED AI to send it for approval, or wait for the automatic return.` }, { status: 403 });
      const { data: still } = await ctx.admin.from("leads").select("id").in("id", handoff.lead_ids).eq("agent_id", handoff.to_agent).is("deleted_at", null);
      const back = ((still ?? []) as { id: string }[]).map((l) => l.id);
      if (back.length) await callRoute(bulkRoute, "POST", { path: "/api/leads/bulk", body: { ids: back, action: "assign", value: handoff.from_agent } });
      await ctx.admin.from("assistant_handoffs").update({ status: "returned", returned_count: back.length, returned_at: new Date().toISOString() }).eq("id", id);
      return NextResponse.json({ ok: true, message: `${back.length} lead${back.length === 1 ? "" : "s"} moved back.` });
    }
    return NextResponse.json({ error: "Unknown change." }, { status: 422 });
  } catch (e) {
    return actionError(e);
  }
}
