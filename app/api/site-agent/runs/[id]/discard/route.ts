// app/api/site-agent/runs/[id]/discard/route.ts
import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { agentRunAccess } from "@/lib/site-agent/access";
import { AGENT_SITES_BUCKET, resultZipPath } from "@/lib/site-agent/types";

export const runtime = "nodejs";
export const maxDuration = 30;

type Ctx = { params: Promise<{ id: string }> };

/** POST — from review: throw the result away. From queued/running: cancel —
 *  nulling claim_id breaks the worker's ownership guard (its next guarded
 *  write matches zero rows) and its keepalive miss flips shouldCancel, which
 *  kills the agy process tree. The claim_id null-out is LOAD-BEARING — see
 *  lib/site-agent/worker.ts's header contract. */
export async function POST(_req: Request, ctx: Ctx) {
  const { id } = await ctx.params;
  const admin = createAdminClient();
  const access = await agentRunAccess(admin, id);
  if ("error" in access) return access.error;

  const from = access.run.status;
  if (!["queued", "running", "review"].includes(from)) {
    return NextResponse.json({ error: `Cannot discard a "${from}" run.` }, { status: 409 });
  }
  const { data } = await admin
    .from("site_agent_runs")
    .update({ status: "discarded", claim_id: null, updated_at: new Date().toISOString() })
    .eq("id", id).eq("status", from)
    .select("id")
    .maybeSingle();
  if (!data) return NextResponse.json({ error: "The run changed state — reload." }, { status: 409 });

  // Best-effort result cleanup for EVERY from-status: review always has one;
  // a running run may have uploaded moments before losing its claim (that
  // race can still strand a zip — runId-scoped and harmless, accepted).
  await admin.storage.from(AGENT_SITES_BUCKET).remove([resultZipPath(id)]).catch(() => {});
  await admin.from("activity_log").insert({
    user_id: access.userId, action: "site_agent.run.discarded",
    entity_type: "ticket", entity_id: access.run.ticket_id, new_value: { run_id: id, from },
  });
  return NextResponse.json({ ok: true });
}
