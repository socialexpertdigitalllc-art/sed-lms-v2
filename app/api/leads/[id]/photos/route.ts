import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getUserPermissions } from "@/lib/permissions/resolver";
import { getCapture } from "@/lib/photo-capture/store";

export const runtime = "nodejs";

/** Capture state + candidate thumbnails for the lead's Images group. */
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const perms = await getUserPermissions(user.id);
  if (!perms.has("leads.view")) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  try {
    return NextResponse.json(await getCapture(id));
  } catch (e) {
    // A silent empty state here is indistinguishable from "no capture yet" —
    // which is exactly what an unapplied migration would look like.
    console.error(`[photo-capture] getCapture failed for lead ${id}:`, e);
    return NextResponse.json({ error: "Photo capture is unavailable" }, { status: 500 });
  }
}
