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

  return NextResponse.json(await getCapture(id));
}
