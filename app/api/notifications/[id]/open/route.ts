import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { safeTarget } from "@/lib/push/payload";

export const runtime = "nodejs";

/** A same-origin redirect. The Location stays relative, so it can only ever
 *  land on this site (safeTarget already refuses anything absolute). */
const goTo = (path: string) => new NextResponse(null, { status: 303, headers: { Location: path } });

/**
 * GET — where a desktop/phone notification click lands: marks the
 * notification read (it was seen) and redirects to its page. Only the owner's
 * row is touched; anything else just goes to the inbox.
 */
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return goTo("/login");

  const admin = createAdminClient();
  const { data: row } = await admin
    .from("notifications")
    .select("id, target_url, lead_id, read_at")
    .eq("id", id)
    .eq("user_id", user.id)
    .maybeSingle();
  if (!row) return goTo("/notifications");
  if (!row.read_at) {
    await admin.from("notifications").update({ read_at: new Date().toISOString() }).eq("id", id).eq("user_id", user.id);
  }
  return goTo(safeTarget(row as { target_url: string | null; lead_id: string | null }));
}
