import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { guard, guardError } from "@/lib/site-studio/service/guard";
import { isTerminal, canCancel } from "@/lib/site-studio/run/types";
import { setRunPaused } from "@/lib/site-studio/run/engine";
import type { StudioRunRow } from "@/lib/site-studio/run/types";

export const runtime = "nodejs";
export const maxDuration = 30;

type Ctx = { params: Promise<{ id: string }> };

const ACTIONS = new Set(["pause", "resume", "cancel"]);

/**
 * Pause / resume / cancel — spec §7's Stop/Pause/Resume flags. Pause and
 * resume flip `paused` via `setRunPaused` (engine.ts), which bumps
 * `updated_at` in the same statement — see the CONTRACT comment on
 * `persistRun`/`claimRun` in engine.ts: a bare `.update({paused})` here would
 * leave a step that already read the row (at its OLD `updated_at`) free to
 * win `claimRun`'s CAS and run a full step, AI call included, after the
 * pause was requested. Cancel is only reachable while `canCancel` (i.e. the
 * run isn't already terminal) and needs no such bump of its own — the
 * `.update()` below still stamps a fresh `updated_at`, which is enough since
 * a cancelled run's `nextStep` is null forever after (isTerminal).
 */
export async function POST(req: Request, ctx: Ctx) {
  const auth = await guard();
  if ("error" in auth) return guardError(auth.error);
  const { id } = await ctx.params;

  const body = (await req.json().catch(() => null)) as { action?: unknown } | null;
  const action = typeof body?.action === "string" ? body.action : "";
  if (!ACTIONS.has(action)) {
    return NextResponse.json({ error: `action must be one of: pause, resume, cancel` }, { status: 422 });
  }

  const admin = createAdminClient();
  const { data: row, error: fetchErr } = await admin.from("studio_runs").select("*").eq("id", id).single();
  if (fetchErr || !row) return NextResponse.json({ error: "Not found" }, { status: 404 });
  const run = row as StudioRunRow;

  if (action === "cancel") {
    if (!canCancel(run.status)) {
      return NextResponse.json({ error: `Cannot cancel: this run is already "${run.status}".` }, { status: 409 });
    }
    const { data: updated, error } = await admin
      .from("studio_runs")
      .update({ status: "cancelled", updated_at: new Date().toISOString() })
      .eq("id", id)
      .select("*")
      .single();
    if (error || !updated) return NextResponse.json({ error: error?.message ?? "Update failed" }, { status: 400 });

    await admin.from("studio_run_events").insert({ run_id: id, step: "control", level: "info", message: "cancelled" });
    await admin.from("activity_log").insert({
      user_id: auth.userId, action: "studio.run.cancelled", entity_type: "studio_run", entity_id: id, new_value: {},
    });
    return NextResponse.json({ run: updated });
  }

  if (isTerminal(run.status)) {
    return NextResponse.json({ error: `Cannot ${action}: this run is "${run.status}" (finished).` }, { status: 409 });
  }

  const paused = action === "pause";
  const updated = await setRunPaused(admin, run, paused);

  await admin.from("studio_run_events").insert({
    run_id: id, step: "control", level: "info", message: paused ? "paused" : "resumed",
  });
  await admin.from("activity_log").insert({
    user_id: auth.userId, action: `studio.run.${action}`, entity_type: "studio_run", entity_id: id, new_value: { paused },
  });

  return NextResponse.json({ run: updated });
}
