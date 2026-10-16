import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getUserPermissions } from "@/lib/permissions/resolver";
import { loadStatusHistory } from "@/lib/leads/statusHistoryLoad";

/**
 * When the lead was submitted and every status change since, oldest first.
 * The leads table hovers this per row (the status pill), so it reads one lead's
 * ledger and nothing else.
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

  // RLS-scoped: a viewer who cannot see the lead learns nothing about it. The
  // ledger itself is service-role only, so it is read with the admin client
  // once visibility is settled.
  const { data: lead } = await supabase
    .from("leads")
    .select("id, status, created_at")
    .eq("id", id)
    .is("deleted_at", null)
    .maybeSingle();
  if (!lead) return NextResponse.json({ error: "Lead not found" }, { status: 404 });

  const history = await loadStatusHistory(createAdminClient(), lead as { id: string; status: string; created_at: string });
  return NextResponse.json({ history });
}
