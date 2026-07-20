import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getUserPermissions } from "@/lib/permissions/resolver";
import { kickTemplateProcessor } from "@/lib/template-engine/queue";

interface GenRow {
  id: string;
  lead_id: string;
  status: string;
  brief: unknown;
  content_model: unknown;
}

// POST /api/template-engine/generations/[id]/retry — put a FAILED run back into
// the pipeline. Without this a failing verification gate was terminal: /build
// only accepts `curating` and /reopen only accepts `review`, so the only way
// back was editing the row by hand in the database.
//
// Two shapes of failure, two resets, both on the existing CAS-on-status pattern:
//   - the BUILD phase failed (the frozen brief + content model survive) — reset
//     to `curating` so the operator can adjust content/images and press Build,
//     reusing the plan phase's expensive Gemini + vision work.
//   - the PLAN phase failed (no content model) — reset to `queued` and enqueue a
//     fresh `plan` row so the processor runs the whole thing again.
export async function POST(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  const perms = await getUserPermissions(user.id);
  if (!perms.has("templates.generate")) {
    return NextResponse.json({ error: "Not allowed" }, { status: 403 });
  }

  const admin = createAdminClient();
  const { data: genRow } = await admin
    .from("template_generations")
    .select("id, lead_id, status, brief, content_model")
    .eq("id", id)
    .maybeSingle();
  if (!genRow) return NextResponse.json({ error: "Generation not found" }, { status: 404 });
  const gen = genRow as GenRow;

  // RLS-scoped lookup: a lead this user cannot see must 404, not retry.
  const { data: lead } = await supabase
    .from("leads")
    .select("id")
    .eq("id", gen.lead_id)
    .is("deleted_at", null)
    .maybeSingle();
  if (!lead) return NextResponse.json({ error: "Lead not found" }, { status: 404 });

  if (gen.status !== "failed") {
    return NextResponse.json({ error: "Only a failed run can be retried" }, { status: 409 });
  }

  const canResume = !!gen.brief && !!gen.content_model;
  const nextStatus = canResume ? "curating" : "queued";

  // CAS on `failed` so a double-click resets (and re-queues) exactly once.
  // The stale gate verdict and error belong to the attempt being discarded.
  const { data: updated, error } = await admin
    .from("template_generations")
    .update({ status: nextStatus, gate_results: null, error: null, updated_at: new Date().toISOString() })
    .eq("id", id)
    .eq("status", "failed")
    .select("id")
    .maybeSingle();
  if (error) return NextResponse.json({ error: error.message }, { status: 400 });
  if (!updated) return NextResponse.json({ error: "Only a failed run can be retried" }, { status: 409 });

  if (!canResume) {
    const { error: qErr } = await admin
      .from("template_gen_queue")
      .insert({ generation_id: id, enqueued_by: user.id, kind: "plan" });
    if (qErr) return NextResponse.json({ error: qErr.message }, { status: 400 });
    kickTemplateProcessor();
  }

  return NextResponse.json({ ok: true, status: nextStatus }, { status: 202 });
}
