import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getUserPermissions } from "@/lib/permissions/resolver";
import { overrideLiveSite, prepareSiteZip } from "@/lib/site-studio/deploy/liveFiles";
import { readSiteSnapshot, snapshotSite } from "@/lib/site-studio/deploy/snapshots";

export const runtime = "nodejs";
export const maxDuration = 120;

const ALLOWED_PERMS = ["studio.manage", "tickets.resolve"];

/**
 * POST /api/site-studio/deployments/restore?site=  body { path } — put a
 * snapshot's files back on the live site. The current files are snapshotted
 * first, so a restore is itself undoable. `path` is confined to the site's
 * own snapshots/ prefix inside readSiteSnapshot — a caller can never replay
 * some other site's files here.
 */
export async function POST(req: Request) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const perms = await getUserPermissions(user.id);
  if (!ALLOWED_PERMS.some((p) => perms.has(p))) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const site = new URL(req.url).searchParams.get("site") ?? "";
  const body = (await req.json().catch(() => ({}))) as { path?: unknown };
  const path = typeof body.path === "string" ? body.path : "";
  if (!path) return NextResponse.json({ error: "Pick a snapshot to restore" }, { status: 422 });

  const admin = createAdminClient();
  const stored = await readSiteSnapshot(admin, site, path);
  if (!stored.ok) return NextResponse.json({ error: stored.message }, { status: 422 });

  const prepared = prepareSiteZip(stored.zip);
  if (!prepared.ok) {
    return NextResponse.json({ error: `That snapshot is not restorable: ${prepared.message}` }, { status: 422 });
  }

  const now = new Date().toISOString();
  const undo = await snapshotSite(admin, site, now);
  if (!undo.ok) console.warn(`[restore] pre-restore snapshot of ${site} failed: ${undo.message}`);

  const result = await overrideLiveSite(site, prepared.zip, prepared.files);
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: result.status });

  const stamp = { deployed_at: now, updated_at: now, deployed_by: user.id };
  const rows = result.sub
    ? admin.from("studio_deployments").update(stamp).eq("subdomain", result.sub)
    : admin.from("studio_deployments").update(stamp).eq("url", `https://${result.host}`);
  await rows.eq("status", "live");

  await admin.from("activity_log").insert({
    user_id: user.id,
    action: "studio.site.restored",
    entity_type: "site",
    entity_id: null,
    new_value: { site: result.host, source: result.source, files: result.files, from_snapshot: path },
  });

  return NextResponse.json({ ok: true, url: `https://${result.host}`, files: result.files, undoable: undo.ok });
}
