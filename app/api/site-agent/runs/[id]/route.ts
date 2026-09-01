// app/api/site-agent/runs/[id]/route.ts
import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { agentRunAccess } from "@/lib/site-agent/access";
import { workerStatus } from "@/lib/site-agent/workerStatus";

export const runtime = "nodejs";
export const maxDuration = 30;

type Ctx = { params: Promise<{ id: string }> };

/** GET — the panel's 2s poll. The row is small BY DESIGN (no file contents in
 *  jsonb); workerOnline lets the panel say "worker offline" instead of
 *  showing an eternal queue, and `models` (v2) feeds the pre-send dialog's
 *  model select from the worker's live-published agy catalogue. */
export async function GET(_req: Request, ctx: Ctx) {
  const { id } = await ctx.params;
  const admin = createAdminClient();
  const access = await agentRunAccess(admin, id);
  if ("error" in access) return access.error;

  const status = await workerStatus(admin);
  return NextResponse.json({ run: access.run, workerOnline: status.workerOnline, models: status.models });
}
