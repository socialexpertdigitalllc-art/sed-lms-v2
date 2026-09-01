// app/api/site-agent/runs/[id]/revise/route.ts
import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { agentRunAccess } from "@/lib/site-agent/access";

export const runtime = "nodejs";
export const maxDuration = 30;

type Ctx = { params: Promise<{ id: string }> };

/** POST {instructions} — back to the queue with developer guidance; the
 *  worker continues the SAME agy conversation (conversation_id kept) and
 *  seeds the workspace from the previous result, so follow-ups are
 *  incremental, fast, and cheap on quota. */
export async function POST(req: Request, ctx: Ctx) {
  const { id } = await ctx.params;
  const admin = createAdminClient();
  const access = await agentRunAccess(admin, id);
  if ("error" in access) return access.error;

  const body = (await req.json().catch(() => null)) as { instructions?: string } | null;
  const instructions = typeof body?.instructions === "string" ? body.instructions.trim() : "";
  if (!instructions) return NextResponse.json({ error: "Say what to change." }, { status: 422 });

  const { data } = await admin
    .from("site_agent_runs")
    .update({ status: "queued", instructions, error: null, updated_at: new Date().toISOString() })
    .eq("id", id).eq("status", "review")
    .select("id")
    .maybeSingle();
  if (!data) return NextResponse.json({ error: "This run is not awaiting review." }, { status: 409 });

  await admin.from("activity_log").insert({
    user_id: access.userId, action: "site_agent.run.revised",
    entity_type: "ticket", entity_id: access.run.ticket_id,
    new_value: { run_id: id, instructions: instructions.slice(0, 500) },
  });
  return NextResponse.json({ ok: true });
}
