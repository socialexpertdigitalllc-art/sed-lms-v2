// app/api/site-agent/runs/[id]/revise/route.ts
import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { agentRunAccess } from "@/lib/site-agent/access";
import { parseRunOptions, readRunOptions } from "@/lib/site-agent/options";
import { defaultModelFrom, getAgentDefaults, isMissingColumn } from "@/lib/site-agent/settings";
import { resolveModelChoice, workerStatus } from "@/lib/site-agent/workerStatus";

export const runtime = "nodejs";
export const maxDuration = 30;

type Ctx = { params: Promise<{ id: string }> };

/** POST {instructions, model?, options?} — back to the queue with developer
 *  guidance; the worker continues the SAME agy conversation (conversation_id
 *  kept) and seeds the workspace from the previous result, so follow-ups are
 *  incremental, fast, and cheap on quota.
 *
 *  The follow-up may switch model or change the run's controls (a quick fix
 *  after a thorough first pass). A run whose model the worker no longer
 *  offers moves to the team default instead of failing: all of Gemini 3.7 was
 *  withdrawn on 2026-10-13, stranding every run created with it. */
export async function POST(req: Request, ctx: Ctx) {
  const { id } = await ctx.params;
  const admin = createAdminClient();
  const access = await agentRunAccess(admin, id);
  if ("error" in access) return access.error;

  const body = (await req.json().catch(() => null)) as { instructions?: string; model?: unknown; options?: unknown } | null;
  const instructions = typeof body?.instructions === "string" ? body.instructions.trim() : "";
  if (!instructions) return NextResponse.json({ error: "Say what to change." }, { status: 422 });

  const choice = parseRunOptions(body?.options);
  if (!choice.ok) return NextResponse.json({ error: choice.message }, { status: 422 });

  const { models } = await workerStatus(admin);
  const { defaults } = await getAgentDefaults(admin);
  const current = access.run.model ?? null;
  const withdrawn = current !== null && models.length > 0 && !models.some((m) => m.id === current);
  const modelChoice = await resolveModelChoice(
    admin,
    body?.model,
    withdrawn ? defaultModelFrom(defaults, models) : current,
  );
  if (!modelChoice.ok) return NextResponse.json({ error: modelChoice.message }, { status: 422 });

  const fields: Record<string, unknown> = {
    status: "queued", instructions, error: null, model: modelChoice.model, updated_at: new Date().toISOString(),
  };
  if (Object.keys(choice.value).length) {
    fields.options = { ...readRunOptions(access.run.options), ...choice.value };
  }
  const update = () => admin.from("site_agent_runs").update(fields).eq("id", id).eq("status", "review").select("id").maybeSingle();
  let { data, error } = await update();
  if (error && "options" in fields && isMissingColumn(error, "options")) {
    // Before migration 0086 the follow-up still goes; only its controls can't be kept.
    delete fields.options;
    ({ data, error } = await update());
  }
  if (!data) return NextResponse.json({ error: "This run is not awaiting review." }, { status: 409 });

  await admin.from("activity_log").insert({
    user_id: access.userId, action: "site_agent.run.revised",
    entity_type: "ticket", entity_id: access.run.ticket_id,
    new_value: {
      run_id: id, instructions: instructions.slice(0, 500), model: modelChoice.model,
      speed: choice.value.speed ?? readRunOptions(access.run.options).speed ?? null,
    },
  });
  return NextResponse.json({ ok: true, model: modelChoice.model });
}
