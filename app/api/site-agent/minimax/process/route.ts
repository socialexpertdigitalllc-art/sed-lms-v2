// app/api/site-agent/minimax/process/route.ts
import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { sweepMinimaxRuns } from "@/lib/site-agent/minimaxRunner";

export const runtime = "nodejs";
// A MiniMax round can use its whole time limit (60 minutes at most).
export const maxDuration = 3900;

/**
 * Recovery sweep for the AI developer's MiniMax engine: a MiniMax run is
 * normally started straight from the route that created it; this picks up one
 * whose start was lost (a restart mid-run). Runs on the LMS server — unlike
 * /api/site-agent/process, which only the office worker box may run. Same
 * x-wge-secret contract as every processor, listed in middleware's isPublic.
 */
export async function POST(req: Request) {
  const expected = process.env.WGE_PROCESSOR_SECRET;
  if (!expected) return NextResponse.json({ error: "WGE_PROCESSOR_SECRET is not configured" }, { status: 503 });
  if (req.headers.get("x-wge-secret") !== expected) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  return NextResponse.json(await sweepMinimaxRuns(createAdminClient()));
}
