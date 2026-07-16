import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getUserPermissions } from "@/lib/permissions/resolver";
import { kickTemplateProcessor } from "@/lib/template-engine/queue";
import { parseImageSlots } from "@/lib/template-engine/imageSlots";
import { emptySlots } from "@/lib/template-engine/curation";

interface GenRow {
  id: string;
  lead_id: string;
  status: string;
  image_slots: unknown;
}

/**
 * Operator confirms curation is done: every slot must already have a pick.
 * Flips the generation to `building` and queues a `kind:'build'` row so
 * queue.ts's processor dispatches to `buildFromSelection` (the regenerate ->
 * verify -> finalize half of the pipeline the plan phase paused before).
 */
export async function POST(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const perms = await getUserPermissions(user.id);
  if (!perms.has("templates.generate")) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const admin = createAdminClient();
  const { data: genRow } = await admin
    .from("template_generations")
    .select("id, lead_id, status, image_slots")
    .eq("id", id)
    .maybeSingle();
  if (!genRow) return NextResponse.json({ error: "Generation not found" }, { status: 404 });
  const gen = genRow as GenRow;

  // RLS-scoped lookup: a lead this user cannot see must 404, not build (mirrors generate/route.ts).
  const { data: lead } = await supabase
    .from("leads")
    .select("id")
    .eq("id", gen.lead_id)
    .is("deleted_at", null)
    .maybeSingle();
  if (!lead) return NextResponse.json({ error: "Lead not found" }, { status: 404 });

  if (gen.status !== "curating") {
    return NextResponse.json({ error: "Not in curation" }, { status: 409 });
  }

  const slots = parseImageSlots(gen.image_slots);
  const empty = emptySlots(slots);
  if (empty.length > 0) {
    return NextResponse.json(
      { error: "Every slot needs at least one selected image", slots: empty },
      { status: 422 },
    );
  }

  // Compare-and-swap on status: a build kicks off a real, non-idempotent side
  // effect (a queued run + processor kick), so a double-submit must only
  // flip + queue once. `.select().maybeSingle()` after the filtered update
  // tells us whether THIS request was the one that won the flip.
  const { data: flipped, error: updateErr } = await admin
    .from("template_generations")
    .update({ status: "building", updated_at: new Date().toISOString() })
    .eq("id", id)
    .eq("status", "curating")
    .select("id")
    .maybeSingle();
  if (updateErr) return NextResponse.json({ error: updateErr.message }, { status: 400 });
  if (!flipped) return NextResponse.json({ error: "Not in curation" }, { status: 409 });

  const { error: qErr } = await admin
    .from("template_gen_queue")
    .insert({ generation_id: id, enqueued_by: user.id, kind: "build" });
  if (qErr) return NextResponse.json({ error: qErr.message }, { status: 400 });

  kickTemplateProcessor();
  return NextResponse.json({ ok: true }, { status: 202 });
}
