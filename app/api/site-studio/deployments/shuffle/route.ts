import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getUserPermissions } from "@/lib/permissions/resolver";
import { findLiveDeploymentBySite, shuffleDeployment } from "@/lib/site-studio/deploy/shuffle";

export const runtime = "nodejs";
export const maxDuration = 300;

/**
 * Moving a site is a WRITE, gated exactly like uploading over it: board
 * operators (studio.manage) and tech users resolving tickets (tickets.resolve).
 * Lead viewers who can download may not shuffle.
 */
const ALLOWED_PERMS = ["studio.manage", "tickets.resolve"];

/**
 * POST /api/site-studio/deployments/shuffle?site=<url|host> — shuffle a live
 * site to a fresh subdomain, keyed by the site's address rather than a
 * deployment id so the lead screen, the ticket screen and the lead table can
 * bind the icon to the lead's website_link directly. Same reasoning as the
 * override route: the tech never picks a target off the board, so the wrong
 * lead's site can never be moved.
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
  const admin = createAdminClient();
  const deployment = await findLiveDeploymentBySite(admin, site);
  if (!deployment) {
    return NextResponse.json(
      { error: "This website is not a live site on the deployments board, so it cannot be shuffled." },
      { status: 404 },
    );
  }

  const result = await shuffleDeployment(admin, { id: deployment.id, actorId: user.id });
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: result.status });
  return NextResponse.json({ ok: true, url: result.url, subdomain: result.subdomain, oldDeleted: result.oldDeleted });
}
