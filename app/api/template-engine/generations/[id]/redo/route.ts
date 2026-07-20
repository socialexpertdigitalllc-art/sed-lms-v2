import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getUserPermissions } from "@/lib/permissions/resolver";
import { kickTemplateProcessor } from "@/lib/template-engine/queue";
import { releasePendingQueue } from "@/lib/template-engine/control";
import { parseImageSlots } from "@/lib/template-engine/imageSlots";
import {
  canRedoFrom,
  describeImagesRedoLoss,
  isRedoStepKey,
  markStale,
  redoRejectionReason,
  redoSpec,
  resetStepsForRedo,
  type RedoStepKey,
} from "@/lib/template-engine/redo";
import type { GenStep } from "@/lib/template-engine/types";

interface GenRow {
  id: string;
  lead_id: string;
  status: string;
  content_model: unknown;
  image_slots: unknown;
  steps: unknown;
  stale_steps: unknown;
}

function stepArray(v: unknown): GenStep[] {
  if (!Array.isArray(v)) return [];
  return v.filter(
    (s): s is GenStep =>
      !!s && typeof s === "object" && typeof (s as GenStep).key === "string" && typeof (s as GenStep).status === "string",
  );
}

// POST /api/template-engine/generations/[id]/redo — re-run ONE step of a run.
// Body: { step: "content" | "images" | "build", confirm?: boolean }
//
// Surgical by design (see lib/template-engine/redo.ts): redoing content does
// not re-gather images, and redoing images does not rebuild. What it DOES do is
// mark the steps downstream of the redone one as stale, so the operator can see
// that their built site now predates the copy it was built from — and redo
// those too, in one click, if they want to.
//
// Same permission + RLS-lead-lookup + CAS-on-status shape as
// /retry, /resume, /pause and /cancel.
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
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

  const body = (await req.json().catch(() => ({}))) as { step?: unknown; confirm?: unknown };
  if (!isRedoStepKey(body.step)) {
    return NextResponse.json({ error: "step must be one of: content, images, build" }, { status: 400 });
  }
  const step: RedoStepKey = body.step;
  const spec = redoSpec(step)!;

  const admin = createAdminClient();
  const { data: genRow } = await admin
    .from("template_generations")
    .select("id, lead_id, status, content_model, image_slots, steps, stale_steps")
    .eq("id", id)
    .maybeSingle();
  if (!genRow) return NextResponse.json({ error: "Generation not found" }, { status: 404 });
  const gen = genRow as GenRow;

  // RLS-scoped lookup: a lead this user cannot see must 404, not redo.
  const { data: lead } = await supabase
    .from("leads")
    .select("id")
    .eq("id", gen.lead_id)
    .is("deleted_at", null)
    .maybeSingle();
  if (!lead) return NextResponse.json({ error: "Lead not found" }, { status: 404 });

  // Redo is for a run AT REST. A run still executing would race the runner's
  // own write-through of steps/status, so say what to do instead of just no.
  if (!canRedoFrom(step, gen.status)) {
    return NextResponse.json({ error: redoRejectionReason(step, gen.status) }, { status: 409 });
  }

  // Both of the steps that consume the content model need one to exist.
  if (step !== "content" && !gen.content_model) {
    return NextResponse.json(
      { error: "This run has no content model yet — redo the content step first." },
      { status: 409 },
    );
  }

  // DESTRUCTIVE: re-gathering images REPLACES `image_slots` wholesale, so every
  // hand-picked photo and every custom URL the operator pasted is gone. The UI
  // must have said so and got a click; a bare POST is refused with the exact
  // sentence it should show.
  if (spec.destructive && body.confirm !== true) {
    return NextResponse.json(
      {
        error: describeImagesRedoLoss(parseImageSlots(gen.image_slots)),
        requires_confirm: true,
        step,
      },
      { status: 409 },
    );
  }

  // A stale pending queue row (or a runner that claimed one between the read
  // above and now) would fight the redo. Drop the pending ones; refuse if a
  // runner is genuinely mid-flight.
  const { runnerInFlight } = await releasePendingQueue(admin, id);
  if (runnerInFlight) {
    return NextResponse.json(
      { error: "A run is in flight for this generation — pause it first, then redo." },
      { status: 409 },
    );
  }

  const steps = resetStepsForRedo(stepArray(gen.steps), step);
  const staleSteps = markStale(gen.stale_steps, step);

  // Reset ONLY this step's own entries and outputs. Note what is NOT here:
  //  - `content_model` survives an images/build redo (it holds the operator's
  //    content edits — a rebuild reads it, never writes it);
  //  - `image_slots` survives a content/build redo (that curation is real work);
  //  - the images redo leaves `image_slots` in place too, because the runner
  //    overwrites it on success — so a redo that fails does not also destroy
  //    the old picks on its way down.
  // `control`/`paused_at`/`error` are cleared so a leftover pause flag from the
  // run's previous life cannot halt the redo at its very first checkpoint.
  const patch: Record<string, unknown> = {
    status: spec.nextStatus,
    steps,
    stale_steps: staleSteps,
    current_step: null,
    control: null,
    paused_at: null,
    error: null,
    updated_at: new Date().toISOString(),
  };
  // The build's verdict belongs to the build being replaced.
  if (step === "build") patch.gate_results = null;

  // CAS on the status we validated, so a double-click enqueues exactly once.
  const { data: updated, error } = await admin
    .from("template_generations")
    .update(patch)
    .eq("id", id)
    .eq("status", gen.status)
    .select("id")
    .maybeSingle();
  if (error) return NextResponse.json({ error: error.message }, { status: 400 });
  if (!updated) {
    return NextResponse.json({ error: "This run changed while you were looking at it — reload and try again." }, { status: 409 });
  }

  const { error: qErr } = await admin
    .from("template_gen_queue")
    .insert({ generation_id: id, enqueued_by: user.id, kind: spec.queueKind });
  if (qErr) return NextResponse.json({ error: qErr.message }, { status: 400 });
  kickTemplateProcessor();

  return NextResponse.json({ ok: true, step, status: spec.nextStatus, stale_steps: staleSteps }, { status: 202 });
}
