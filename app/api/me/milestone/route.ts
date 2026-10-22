import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { celebrationFor, markMilestoneSeen, MilestoneError } from "@/lib/milestones";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * The company milestone owed to the signed-in person (lib/milestones.ts):
 * GET → { celebration } (null almost always); POST { milestone } → they've
 * seen it, so it never shows again until the next thousand. The count is
 * company-wide — a number, never anyone's leads.
 */

async function signedIn() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  return user;
}

export async function GET() {
  const user = await signedIn();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  try {
    return NextResponse.json({ celebration: await celebrationFor(createAdminClient(), user.id) });
  } catch {
    // A celebration is never worth an error on screen.
    return NextResponse.json({ celebration: null });
  }
}

export async function POST(req: Request) {
  const user = await signedIn();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const body = (await req.json().catch(() => null)) as { milestone?: unknown } | null;
  const milestone = typeof body?.milestone === "number" ? body.milestone : NaN;
  try {
    return NextResponse.json({ seen: await markMilestoneSeen(createAdminClient(), user.id, milestone) });
  } catch (e) {
    if (e instanceof MilestoneError) return NextResponse.json({ error: e.message }, { status: 422 });
    return NextResponse.json({ error: "Could not save that." }, { status: 500 });
  }
}
