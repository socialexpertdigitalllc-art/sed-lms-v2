import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { guard, guardAny, guardError } from "@/lib/site-studio/service/guard";
import { TEMPLATE_CATALOGUE_PERMS } from "@/lib/site-builder/templates";
import { listHeroVideos, toCard } from "@/lib/hero-videos/library";

export const runtime = "nodejs";

/**
 * The hero video catalogue.
 *
 * Default: the gallery — ready videos only, as cards. Open to whoever may
 * pick a template on the lead form (same rule as the in-service templates).
 * `?all=1`: every row with its sync state, for the Hero Videos tab (studio only).
 */
export async function GET(req: Request) {
  const all = new URL(req.url).searchParams.get("all") === "1";
  const auth = all ? await guard() : await guardAny(TEMPLATE_CATALOGUE_PERMS);
  if ("error" in auth) return guardError(auth.error);

  const admin = createAdminClient();
  try {
    const rows = await listHeroVideos(admin, { all });
    return NextResponse.json(all ? { videos: rows } : { videos: rows.filter((r) => r.media_url).map(toCard) });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "Could not load the videos" }, { status: 400 });
  }
}
