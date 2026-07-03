import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { assertWgeManage } from "@/lib/ai-tools/wge";

export const runtime = "nodejs";

export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const auth = await assertWgeManage();
  if ("error" in auth) return NextResponse.json({ error: auth.error === 401 ? "Unauthorized" : "Forbidden" }, { status: auth.error });

  const admin = createAdminClient();
  const { data, error } = await admin.from("wge_queue").delete().eq("id", id).eq("status", "pending").select("id");
  if (error) return NextResponse.json({ error: error.message }, { status: 400 });
  if (!data?.length) return NextResponse.json({ error: "Only pending rows can be cancelled" }, { status: 409 });
  return NextResponse.json({ ok: true });
}
