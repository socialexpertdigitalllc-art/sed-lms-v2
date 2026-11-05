import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { guard, guardError } from "@/lib/site-studio/service/guard";
import { planSync } from "@/lib/hero-videos/library";

export const runtime = "nodejs";
export const maxDuration = 120;

/**
 * Step 1 of Sync: read the Drive folder, apply the cheap changes (archive,
 * restore, renames) and return the videos still to copy. The Hero Videos tab
 * then imports those one per request (`/import`), showing progress as it goes.
 */
export async function POST() {
  const auth = await guard();
  if ("error" in auth) return guardError(auth.error);
  const admin = createAdminClient();
  try {
    const plan = await planSync(admin);
    return NextResponse.json({ plan });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "Sync failed" }, { status: 400 });
  }
}
