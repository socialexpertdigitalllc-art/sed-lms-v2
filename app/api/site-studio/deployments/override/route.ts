import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getUserPermissions } from "@/lib/permissions/resolver";
import { overrideLiveSite, prepareSiteZip } from "@/lib/site-studio/deploy/liveFiles";

export const runtime = "nodejs";
export const maxDuration = 120;

const MAX_ZIP_BYTES = 60 * 1024 * 1024;

/**
 * Overwriting a live site is a WRITE — unlike the download sibling this does
 * NOT admit lead viewers: only board operators (studio.manage) and tech users
 * resolving tickets (tickets.resolve).
 */
const ALLOWED_PERMS = ["studio.manage", "tickets.resolve"];

/**
 * POST /api/site-studio/deployments/override?site=<url|host> (multipart
 * { file }) — replace a hosted site's live files in place, keyed by the
 * site's address rather than a deployment id so the ticket and lead screens
 * can bind the button to the lead's website_link directly (the whole point:
 * the tech never picks a target off the board, so files can't land on the
 * wrong lead's site). The zip is normalized + sanity-checked first
 * (index.html required, shared root folder stripped, zip-slip rejected).
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

  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    return NextResponse.json({ error: "Expected a multipart form upload" }, { status: 400 });
  }
  const file = form.get("file");
  if (!(file instanceof File)) return NextResponse.json({ error: "No zip file uploaded" }, { status: 400 });
  if (!/\.zip$/i.test(file.name) && file.type !== "application/zip") {
    return NextResponse.json({ error: "The upload must be a .zip file" }, { status: 422 });
  }
  if (file.size > MAX_ZIP_BYTES) return NextResponse.json({ error: "Zip is too large (max 60MB)" }, { status: 422 });

  const prepared = prepareSiteZip(new Uint8Array(await file.arrayBuffer()));
  if (!prepared.ok) return NextResponse.json({ error: prepared.message }, { status: 422 });

  const result = await overrideLiveSite(site, prepared.zip, prepared.files);
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: result.status });

  // Board bookkeeping, best-effort: stamp the tracked row if one exists
  // (untracked sites simply match zero rows).
  const admin = createAdminClient();
  const now = new Date().toISOString();
  const stamp = { deployed_at: now, updated_at: now, deployed_by: user.id };
  const rows = result.sub
    ? admin.from("studio_deployments").update(stamp).eq("subdomain", result.sub)
    : admin.from("studio_deployments").update(stamp).eq("url", `https://${result.host}`);
  await rows.eq("status", "live");

  await admin.from("activity_log").insert({
    user_id: user.id,
    action: "studio.site.files_overridden",
    entity_type: "site",
    entity_id: null,
    new_value: { site: result.host, source: result.source, files: result.files, zip_name: file.name },
  });

  return NextResponse.json({ ok: true, url: `https://${result.host}`, files: result.files });
}
