import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
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

  const admin = createAdminClient();
  const { data: lead } = await admin
    .from("leads")
    .select("agent_id")
    .eq("id", id)
    .is("deleted_at", null)
    .single();
  if (!lead) return NextResponse.json({ error: "Lead not found" }, { status: 404 });

  // Ownership scope (defense-in-depth mirror of the leads read policy):
  // getCapture() uses the service-role admin client, which bypasses RLS
  // entirely, so this route must re-check by hand what `read leads scoped`
  // (0004_lead_scoping.sql) would otherwise enforce. Matches
  // app/api/leads/[id]/route.ts.
  if (!perms.has("leads.view_all") && lead.agent_id !== user.id) {
    // Read-specific wording: this route only reads. The shared 403 shape and
    // the scoping rule match app/api/leads/[id]/route.ts; only the verb differs.
    return NextResponse.json({ error: "You can only view your own leads." }, { status: 403 });
  }

  try {
    return NextResponse.json(await getCapture(id));
  } catch (e) {
    // A silent empty state here is indistinguishable from "no capture yet" —
    // which is exactly what an unapplied migration would look like.
    console.error(`[photo-capture] getCapture failed for lead ${id}:`, e);
    return NextResponse.json({ error: "Photo capture is unavailable" }, { status: 500 });
  }
}
