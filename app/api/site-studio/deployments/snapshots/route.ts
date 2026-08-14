import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getUserPermissions } from "@/lib/permissions/resolver";
import { listSiteSnapshots } from "@/lib/site-studio/deploy/snapshots";

export const runtime = "nodejs";

/** Snapshots exist to serve restores (a write), so both endpoints share the
 *  override gate: board operators + ticket-resolving techs. */
const ALLOWED_PERMS = ["studio.manage", "tickets.resolve"];

/** GET /api/site-studio/deployments/snapshots?site= — newest-first rollback
 *  points for a site (taken automatically before every override/restore). */
export async function GET(req: Request) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const perms = await getUserPermissions(user.id);
  if (!ALLOWED_PERMS.some((p) => perms.has(p))) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const site = new URL(req.url).searchParams.get("site") ?? "";
  const snapshots = await listSiteSnapshots(createAdminClient(), site);
  if (snapshots === null) {
    return NextResponse.json({ error: "Could not list snapshots for that site" }, { status: 422 });
  }
  return NextResponse.json({ snapshots });
}
