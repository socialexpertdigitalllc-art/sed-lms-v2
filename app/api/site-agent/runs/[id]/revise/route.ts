// app/api/site-agent/runs/[id]/revise/route.ts
import { NextResponse, after } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { agentRunAccess } from "@/lib/site-agent/access";
import { parseRunOptions, readRunOptions, runEngine } from "@/lib/site-agent/options";
import { minimaxClaim, resolveMinimaxChoice, runClaimedMinimax } from "@/lib/site-agent/minimaxRunner";
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

  const { defaults } = await getAgentDefaults(admin);
  const current = access.run.model ?? null;
  // A follow-up may move an Antigravity run to MiniMax (Antigravity's quota ran
  // out mid-review); MiniMax picks up from the last result. The other way is
  // refused: an office worker that predates MiniMax would start Antigravity
  // from the ORIGINAL site and silently drop MiniMax's edits.
  const fromEngine = runEngine(access.run.options);
  const engine = choice.value.engine ?? fromEngine;
  if (fromEngine === "minimax" && engine === "antigravity") {
    return NextResponse.json(
      { error: "These edits were made by MiniMax — continue with MiniMax, or start a new run to use Antigravity." },
      { status: 422 },
    );
  }
  let modelChoice: { ok: true; model: string | null } | { ok: false; message: string };
  if (engine === "minimax") {
    modelChoice = await resolveMinimaxChoice(body?.model ?? (fromEngine === "minimax" ? current : undefined), defaults);
  } else {
    const { models } = await workerStatus(admin);
    const withdrawn = current !== null && models.length > 0 && !models.some((m) => m.id === current);
    modelChoice = await resolveModelChoice(admin, body?.model, withdrawn ? defaultModelFrom(defaults, models) : current);
  }
  if (!modelChoice.ok) return NextResponse.json({ error: modelChoice.message }, { status: 422 });

  // MiniMax: claimed by this server and started below, never queued.
  const claim = engine === "minimax" ? minimaxClaim() : null;
  const fields: Record<string, unknown> = {
    status: "queued", instructions, error: null, model: modelChoice.model, updated_at: new Date().toISOString(),
    ...(claim ?? {}),
  };
  if (Object.keys(choice.value).length || engine !== fromEngine) {
    const before = readRunOptions(access.run.options);
    const merged = { ...before, ...choice.value };
    if (engine === "minimax") {
      merged.engine = "minimax";
      const minimax = { ...(before.minimax ?? (fromEngine === "minimax" ? {} : defaults.minimax ?? {})), ...(choice.value.minimax ?? {}) };
      if (Object.keys(minimax).length) merged.minimax = minimax;
    }
    fields.options = merged;
  }
  const update = () => admin.from("site_agent_runs").update(fields).eq("id", id).eq("status", "review").select("id").maybeSingle();
  let { data, error } = await update();
  if (error && "options" in fields && isMissingColumn(error, "options")) {
    // Before migration 0086 the follow-up still goes; only its controls can't be kept.
    delete fields.options;
    ({ data, error } = await update());
  }
  if (!data) return NextResponse.json({ error: "This run is not awaiting review." }, { status: 409 });
  if (claim) after(() => runClaimedMinimax(id, claim.claim_id));

  await admin.from("activity_log").insert({
    user_id: access.userId, action: "site_agent.run.revised",
    entity_type: "ticket", entity_id: access.run.ticket_id,
    new_value: {
      run_id: id, instructions: instructions.slice(0, 500), model: modelChoice.model, engine,
      speed: choice.value.speed ?? readRunOptions(access.run.options).speed ?? null,
    },
  });
  return NextResponse.json({ ok: true, model: modelChoice.model });
}
