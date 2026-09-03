import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getUserPermissions } from "@/lib/permissions/resolver";

/**
 * The most recent PICKUP follow-up on a lead — the only kind that carries
 * comments (the POST above nulls them for "No Pickup"). The leads table hovers
 * this per row, so it stays one indexed row: no `select *`, no profile join.
 */
export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const perms = await getUserPermissions(user.id);
  if (!perms.has("leads.view")) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  // RLS-scoped: a viewer who cannot see the lead gets no follow-up either.
  const { data, error } = await supabase
    .from("lead_follow_ups")
    .select("comments, created_at")
    .eq("lead_id", id)
    .eq("fu_status", "Pickup")
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) return NextResponse.json({ error: error.message }, { status: 400 });

  return NextResponse.json({ pickup: data ?? null });
}
