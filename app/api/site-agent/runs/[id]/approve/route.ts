// app/api/site-agent/runs/[id]/approve/route.ts
import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { agentRunAccess } from "@/lib/site-agent/access";
import { snapshotSite } from "@/lib/site-studio/deploy/snapshots";
import { overrideLiveSite, prepareSiteZip } from "@/lib/site-studio/deploy/liveFiles";
import { AGENT_SITES_BUCKET, resultZipPath } from "@/lib/site-agent/types";

export const runtime = "nodejs";
export const maxDuration = 300;

type Ctx = { params: Promise<{ id: string }> };

/**
 * POST — the human gate. Everything before this point never touched the
 * hosting; this route replays EXACTLY what the manual ticket upload does:
 * snapshot the live site first (rollback point), then override in place,
 * then stamp the ticket-proof activity row the ticket screen already renders
 * (`studio.site.files_overridden`, entity ticket) plus our own deploy row.
 */
export async function POST(_req: Request, ctx: Ctx) {
  const { id } = await ctx.params;
  const admin = createAdminClient();
  const access = await agentRunAccess(admin, id);
  if ("error" in access) return access.error;
  const run = access.run;

  // CAS: only a run sitting in review deploys, and only once.
  const { data: claimed } = await admin
    .from("site_agent_runs")
    .update({ status: "deploying", updated_at: new Date().toISOString() })
    .eq("id", run.id)
    .eq("status", "review")
    .select("id")
    .maybeSingle();
  if (!claimed) return NextResponse.json({ error: "This run is not awaiting review." }, { status: 409 });

  const rollback = async (message: string, status: number) => {
    await admin.from("site_agent_runs")
      .update({ status: "review", error: message, updated_at: new Date().toISOString() })
      .eq("id", run.id).eq("status", "deploying");
    return NextResponse.json({ error: message }, { status });
  };

  const { data: blob } = await admin.storage.from(AGENT_SITES_BUCKET).download(resultZipPath(run.id));
  if (!blob) return rollback("The edited site's zip is missing from storage.", 500);
  const prepared = prepareSiteZip(new Uint8Array(await blob.arrayBuffer()));
  if (!prepared.ok) return rollback(`The edited site failed validation: ${prepared.message}`, 422);

  const nowIso = new Date().toISOString();
  const snapshot = await snapshotSite(admin, run.site_host, nowIso);
  if (!snapshot.ok) console.warn(`[site-agent] snapshot of ${run.site_host} failed: ${snapshot.message}`);

  const result = await overrideLiveSite(run.site_host, prepared.zip, prepared.files);
  if (!result.ok) return rollback(result.error, result.status);

  await admin.from("site_agent_runs")
    .update({ status: "deployed", error: null, updated_at: nowIso })
    .eq("id", run.id).eq("status", "deploying");

  // Best-effort board stamp — mirrors the manual override route's tail
  // exactly: matched rows update, untracked sites match zero rows, and only
  // rows whose board status is "live" are stamped.
  const stamp = { deployed_at: nowIso, updated_at: nowIso, deployed_by: access.userId };
  const rows = result.sub
    ? admin.from("studio_deployments").update(stamp).eq("subdomain", result.sub)
    : admin.from("studio_deployments").update(stamp).eq("url", `https://${result.host}`);
  await rows.eq("status", "live");

  // Ticket proof (the ticket page queries exactly this action+entity pair),
  // then our own history row.
  if (run.ticket_id) {
    await admin.from("activity_log").insert({
      user_id: access.userId, action: "studio.site.files_overridden",
      entity_type: "ticket", entity_id: run.ticket_id,
      new_value: { site: run.site_host, files: prepared.files, via: "site_agent", run_id: run.id },
    });
  }
  await admin.from("activity_log").insert({
    user_id: access.userId, action: "site_agent.run.deployed",
    entity_type: "ticket", entity_id: run.ticket_id,
    new_value: { run_id: run.id, site: run.site_host, files: prepared.files },
  });

  return NextResponse.json({ ok: true, url: `https://${result.host}` });
}
