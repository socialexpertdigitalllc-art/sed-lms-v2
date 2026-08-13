import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getUserPermissions } from "@/lib/permissions/resolver";
import { fetchLiveSiteZip, siteZipFilename } from "@/lib/site-studio/deploy/liveFiles";

export const runtime = "nodejs";
export const maxDuration = 120;

/**
 * The download icon lives on three surfaces with three user classes, so this
 * takes any of their gates (not guard()'s studio.manage alone): the
 * deployments board (studio.manage), the ticket screen's tech users
 * (tickets.resolve), and the lead screen (leads.view / view_all). Read-only —
 * and protected company domains are refused inside fetchLiveSiteZip anyway.
 */
const ALLOWED_PERMS = ["studio.manage", "tickets.resolve", "leads.view", "leads.view_all"];

/**
 * GET /api/site-studio/deployments/download?site=<url|host> — the site's
 * CURRENT files zipped straight off the hosting platform (DirectAdmin for
 * staging subdomains, the shared Hostinger disk for custom domains), not a
 * stored generator artifact.
 */
export async function GET(req: Request) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const perms = await getUserPermissions(user.id);
  if (!ALLOWED_PERMS.some((p) => perms.has(p))) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const site = new URL(req.url).searchParams.get("site") ?? "";
  const result = await fetchLiveSiteZip(site);
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: result.status });

  const admin = createAdminClient();
  await admin.from("activity_log").insert({
    user_id: user.id,
    action: "studio.site.files_downloaded",
    entity_type: "site",
    entity_id: null,
    new_value: { site: result.host, source: result.source, bytes: result.zip.length },
  });

  return new NextResponse(Buffer.from(result.zip), {
    headers: {
      "Content-Type": "application/zip",
      "Content-Disposition": `attachment; filename="${siteZipFilename(result.host, new Date())}"`,
      "Cache-Control": "private, no-store",
    },
  });
}
