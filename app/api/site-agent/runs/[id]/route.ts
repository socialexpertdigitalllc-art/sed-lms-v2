// app/api/site-agent/runs/[id]/route.ts
import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { agentRunAccess } from "@/lib/site-agent/access";
import { HEARTBEAT_STALE_MS } from "@/lib/site-agent/types";

export const runtime = "nodejs";
export const maxDuration = 30;

type Ctx = { params: Promise<{ id: string }> };

/** GET — the panel's 2s poll. The row is small BY DESIGN (no file contents in
 *  jsonb); workerOnline lets the panel say "worker offline" instead of
 *  showing an eternal queue. */
export async function GET(_req: Request, ctx: Ctx) {
  const { id } = await ctx.params;
  const admin = createAdminClient();
  const access = await agentRunAccess(admin, id);
  if ("error" in access) return access.error;

  const { data: settings } = await admin.from("app_settings").select("agent_worker_seen_at").limit(1).maybeSingle();
  const seenAt = (settings?.agent_worker_seen_at as string | null) ?? null;
  const workerOnline = seenAt !== null && Date.now() - new Date(seenAt).getTime() < HEARTBEAT_STALE_MS;

  return NextResponse.json({ run: access.run, workerOnline });
}
