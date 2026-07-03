import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { assertWgeManage } from "@/lib/ai-tools/wge";
import { kickProcessor } from "@/lib/ai-tools/queue";

export const runtime = "nodejs";

export async function POST(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const auth = await assertWgeManage();
  if ("error" in auth) return NextResponse.json({ error: auth.error === 401 ? "Unauthorized" : "Forbidden" }, { status: auth.error });

  const admin = createAdminClient();
  const { data, error } = await admin
    .from("wge_queue")
    .update({ status: "pending", error: null, started_at: null, finished_at: null })
    .eq("id", id)
    .eq("status", "failed")
    .select("id");
  if (error) return NextResponse.json({ error: error.message }, { status: 400 });
  if (!data?.length) return NextResponse.json({ error: "Not a retryable (failed) row" }, { status: 409 });
  kickProcessor();
  return NextResponse.json({ ok: true });
}
