import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";

export async function POST(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id } = await params;

  // The RLS policy on notifications is SELECT-only; there is no UPDATE policy,
  // so a user-scoped client would be blocked from marking rows read. Use the
  // admin (service-role) client, but ALWAYS filter by user_id so a user can
  // only ever mark their OWN notifications read.
  const admin = createAdminClient();
  const readAt = new Date().toISOString();

  let query = admin
    .from("notifications")
    .update({ read_at: readAt })
    .is("read_at", null)
    .eq("user_id", user.id);

  if (id !== "all") query = query.eq("id", id);

  const { error } = await query;
  if (error) return NextResponse.json({ error: error.message }, { status: 400 });

  return NextResponse.json({ ok: true });
}
