import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getUserPermissions } from "@/lib/permissions/resolver";
import { enqueueManual, AI_TOOLS_PERMS_OK } from "@/lib/ai-tools/queue";

export const runtime = "nodejs";

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const mine = searchParams.get("mine") === "1";
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  let q = supabase
    .from("wge_queue")
    .select("id, lead_id, tool, model, status, attempts, generation_id, error, enqueued_by, created_at, started_at, finished_at, leads(business_name)")
    .order("created_at", { ascending: false })
    .limit(50);
  if (mine) {
    q = q
      .eq("enqueued_by", user.id)
      .in("status", ["done", "failed"])
      .gte("created_at", new Date(Date.now() - 24 * 3600 * 1000).toISOString());
  }
  const { data, error } = await q;
  if (error) return NextResponse.json({ error: error.message }, { status: 400 });
  return NextResponse.json({ items: data ?? [] });
}

export async function POST(req: Request) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const perms = await getUserPermissions(user.id);
  if (!AI_TOOLS_PERMS_OK(perms)) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const body = await req.json().catch(() => ({}));
  const leadId = typeof body?.leadId === "string" ? body.leadId : null;
  if (!leadId) return NextResponse.json({ error: "Missing leadId" }, { status: 400 });

  // RLS-scoped lookup: a lead this user cannot see must 404, not enqueue.
  const { data: lead } = await supabase
    .from("leads")
    .select("id")
    .eq("id", leadId)
    .is("deleted_at", null)
    .maybeSingle();
  if (!lead) return NextResponse.json({ error: "Lead not found" }, { status: 404 });

  const reason = await enqueueManual(leadId, user.id);
  if (reason) return NextResponse.json({ error: reason }, { status: 400 });
  return NextResponse.json({ queued: true }, { status: 201 });
}
