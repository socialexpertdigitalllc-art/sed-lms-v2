import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { runStep, productionWriterCall } from "@/lib/site-studio/run/engine";
import type { StudioRunRow } from "@/lib/site-studio/run/types";

export const runtime = "nodejs";
export const maxDuration = 300;

// Deliberately EXCLUDES "reviewing" (Gate 1) and every terminal status —
// this is belt-and-braces: `nextStep("reviewing")` already returns null (see
// types.ts), so the machine itself cannot advance a parked run even if it
// were selected here by mistake. Selecting it anyway would just make this
// query needlessly touch rows it can never act on.
const ADVANCEABLE_STATUSES = ["queued", "preparing", "approved", "rendering"];
const IDLE_MINUTES = 2;
const BATCH_LIMIT = 3;

/**
 * Cron entry point: finishes abandoned machine steps for runs the browser
 * has stopped driving (no `POST /step` call in the last two minutes) — never
 * crosses Gate 1, by construction (see `ADVANCEABLE_STATUSES` above).
 * Guarded by a shared secret header, exactly the `app/api/mail/poll`
 * idiom: fails CLOSED when `STUDIO_ADVANCE_SECRET` is unset, rather than
 * becoming an open advance-every-run trigger.
 */
async function advance(req: Request) {
  const expected = process.env.STUDIO_ADVANCE_SECRET;
  const provided = req.headers.get("x-studio-advance-secret");
  if (!expected || !provided || provided !== expected) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const admin = createAdminClient();
  const cutoff = new Date(Date.now() - IDLE_MINUTES * 60 * 1000).toISOString();
  const { data: rows, error } = await admin
    .from("studio_runs")
    .select("*")
    .in("status", ADVANCEABLE_STATUSES)
    .eq("paused", false)
    .lt("updated_at", cutoff)
    .order("updated_at", { ascending: true })
    .limit(BATCH_LIMIT);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  let advanced = 0;
  for (const row of (rows ?? []) as StudioRunRow[]) {
    // One run's failure (a thrown error the engine itself didn't catch) must
    // never abort the batch — the next cron tick picks it back up.
    try {
      const result = await runStep(admin, row, { aiCall: productionWriterCall });
      if (result.claimed) advanced += 1;
    } catch {
      /* skip — the run's own error/event trail (if any) already recorded what happened */
    }
  }

  return NextResponse.json({ advanced });
}

export async function GET(req: Request) {
  return advance(req);
}

export async function POST(req: Request) {
  return advance(req);
}
