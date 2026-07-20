import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getUserPermissions } from "@/lib/permissions/resolver";
import { kickTemplateProcessor } from "@/lib/template-engine/queue";
import { resumeTarget } from "@/lib/template-engine/control";
import type { GenStep } from "@/lib/template-engine/types";

interface GenRow {
  id: string;
  lead_id: string;
  status: string;
  brief: unknown;
  content_model: unknown;
  image_slots: unknown;
  steps: unknown;
}

function stepArray(v: unknown): GenStep[] {
  if (!Array.isArray(v)) return [];
  return v.filter(
    (s): s is GenStep =>
      !!s && typeof s === "object" && typeof (s as GenStep).key === "string" && typeof (s as GenStep).status === "string",
  );
}

// POST /api/template-engine/generations/[id]/resume — put a PAUSED run back into
// the pipeline. Only `paused` is accepted; a cancelled run goes through /retry
// and a failed one likewise.
//
// Where it resumes to is decided by the pure resumeTarget() (see
// lib/template-engine/control.ts), which mirrors /retry's "reuse the expensive
// plan-phase work when it survived" reasoning with one extra rung, because a
// pause — unlike a failure — can land mid-plan:
//   - paused inside the build phase -> `building` + a fresh kind:'build' row.
//   - paused after the plan phase produced a content model AND image slots ->
//     straight back to `curating`, no queue row: the operator presses Build.
//   - anything earlier -> `queued` + a fresh kind:'plan' row (the plan phase is
//     not resumable part-way, so it re-runs whole).
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
    .select("id, lead_id, status, brief, content_model, image_slots, steps")
    .eq("id", id)
    .maybeSingle();
  if (!genRow) return NextResponse.json({ error: "Generation not found" }, { status: 404 });
  const gen = genRow as GenRow;

  // RLS-scoped lookup: a lead this user cannot see must 404, not resume.
  const { data: lead } = await supabase
    .from("leads")
    .select("id")
    .eq("id", gen.lead_id)
    .is("deleted_at", null)
    .maybeSingle();
  if (!lead) return NextResponse.json({ error: "Lead not found" }, { status: 404 });

  if (gen.status !== "paused") {
    return NextResponse.json({ error: "Only a paused run can be resumed" }, { status: 409 });
  }

  const target = resumeTarget({
    brief: gen.brief,
    content_model: gen.content_model,
    image_slots: gen.image_slots,
    steps: stepArray(gen.steps),
  });

  // CAS on `paused` so a double-click enqueues exactly once. Clearing `control`
  // is what actually un-pauses the run: the runner's checkpoints and the
  // processor's claim guard both read it.
  const { data: updated, error } = await admin
    .from("template_generations")
    .update({
      status: target.status,
      control: null,
      paused_at: null,
      error: null,
      updated_at: new Date().toISOString(),
    })
    .eq("id", id)
    .eq("status", "paused")
    .select("id")
    .maybeSingle();
  if (error) return NextResponse.json({ error: error.message }, { status: 400 });
  if (!updated) return NextResponse.json({ error: "Only a paused run can be resumed" }, { status: 409 });

  if (target.enqueue) {
    const { error: qErr } = await admin
      .from("template_gen_queue")
      .insert({ generation_id: id, enqueued_by: user.id, kind: target.enqueue });
    if (qErr) return NextResponse.json({ error: qErr.message }, { status: 400 });
    kickTemplateProcessor();
  }

  return NextResponse.json({ ok: true, status: target.status }, { status: 202 });
}
