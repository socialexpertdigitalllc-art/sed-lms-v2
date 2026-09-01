// app/api/site-agent/process/route.ts
import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { processNextAgentRun } from "@/lib/site-agent/worker";
import { fsWorkspace } from "@/lib/site-agent/workspaceFs";
import { runAgy } from "@/lib/site-agent/agy";
import { notify } from "@/lib/notifications/notify";

export const runtime = "nodejs";
// One agy run can legitimately take up to its 15-minute cap.
export const maxDuration = 1200;

/**
 * The Ticket Agent processor — the ONLY instance that may run it is the
 * operator's Windows box (AGENT_WORKER_ENABLED=1 in ITS .env.local; prod
 * must never set it — `agy` isn't installed there, and the whole point of
 * the split is that the agent runs where the operator's Antigravity
 * sign-in lives). Same x-wge-secret contract as every other processor,
 * and like them it MUST be in lib/supabase/middleware.ts's isPublic list.
 */
export async function POST(req: Request) {
  const expected = process.env.WGE_PROCESSOR_SECRET;
  if (!expected) return NextResponse.json({ error: "WGE_PROCESSOR_SECRET is not configured" }, { status: 503 });
  if (req.headers.get("x-wge-secret") !== expected) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (process.env.AGENT_WORKER_ENABLED !== "1") {
    return NextResponse.json({ error: "The agent worker is not enabled on this instance" }, { status: 503 });
  }

  const out = await processNextAgentRun({
    admin: createAdminClient(),
    driver: runAgy,
    workspace: fsWorkspace,
    notify,
  });
  return NextResponse.json(out);
}
