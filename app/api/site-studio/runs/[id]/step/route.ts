import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { guard, guardError } from "@/lib/site-studio/service/guard";
import { runStep, productionWriterCall } from "@/lib/site-studio/run/engine";
import type { StudioRunRow } from "@/lib/site-studio/run/types";

export const runtime = "nodejs";
export const maxDuration = 300;

type Ctx = { params: Promise<{ id: string }> };

/**
 * Advances one run by exactly ONE step. This is what the cockpit polls/drives
 * — call it repeatedly until the response's `done` is true. Each call does
 * <=30s of work and persists once (see engine.ts); a failed call (network,
 * storage) leaves the row untouched, so calling this again simply retries —
 * nothing here needs its own recovery logic.
 */
export async function POST(_req: Request, ctx: Ctx) {
  const auth = await guard();
  if ("error" in auth) return guardError(auth.error);
  const { id } = await ctx.params;

  const admin = createAdminClient();
  const { data: row, error: fetchErr } = await admin.from("studio_runs").select("*").eq("id", id).single();
  if (fetchErr || !row) return NextResponse.json({ error: "Not found" }, { status: 404 });

  let result;
  try {
    result = await runStep(admin, row as StudioRunRow, { aiCall: productionWriterCall });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "Step failed" }, { status: 500 });
  }

  // A lost claim (another concurrent call already advanced this run) did no
  // work and made no AI call — nothing happened worth an activity_log entry.
  if (result.claimed) {
    await admin.from("activity_log").insert({
      user_id: auth.userId,
      action: "studio.run.step",
      entity_type: "studio_run",
      entity_id: id,
      new_value: { status: result.row.status, done: result.done },
    });
  }

  return NextResponse.json({ run: result.row, done: result.done, claimed: result.claimed, paused: result.paused });
}
