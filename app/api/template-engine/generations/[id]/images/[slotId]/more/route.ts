import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getUserPermissions } from "@/lib/permissions/resolver";
import { gatherSlotCandidates, deriveBusinessType } from "@/lib/template-engine/gatherImages";
import { mergeCandidates, parseImageSlots, type ImageSlot } from "@/lib/template-engine/imageSlots";
import type { ContentModel } from "@/lib/template-engine/contentModel";
import type { GenerationBrief } from "@/lib/template-engine/brief";

// The row shape this route needs from `template_generations`. `options`,
// `content_model`, `image_slots` and `brief` are DB jsonb — untyped at the
// column level, so each is cast/validated after loading (same posture as
// runnerV2.ts's own GenRow/BuildGenRow).
interface GenRow {
  id: string;
  lead_id: string;
  status: string;
  options: unknown;
  content_model: unknown;
  image_slots: unknown;
  brief: unknown;
}

/**
 * "Show different ones": gather a fresh page of Pexels+vision candidates for
 * one slot and merge them onto what's already there. The slot itself doesn't
 * store the Pexels query it was built from, so the query is recovered from
 * the frozen content model's `image_briefs` (matched by slot id) rather than
 * reconstructed — that's the ONE place the real query lives.
 */
export async function POST(
  _req: Request,
  { params }: { params: Promise<{ id: string; slotId: string }> },
) {
  const { id, slotId } = await params;
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
    .select("id, lead_id, status, options, content_model, image_slots, brief")
    .eq("id", id)
    .maybeSingle();
  if (!genRow) return NextResponse.json({ error: "Generation not found" }, { status: 404 });
  const gen = genRow as GenRow;

  // RLS-scoped lookup: a lead this user cannot see must 404, not curate (mirrors generate/route.ts).
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
  const slot = slots.find((s) => s.id === slotId);
  if (!slot) return NextResponse.json({ error: "Slot not found" }, { status: 404 });

  if (!gen.content_model) {
    return NextResponse.json({ error: "Generation has no content model" }, { status: 500 });
  }
  if (!gen.brief) {
    return NextResponse.json({ error: "Generation has no frozen brief" }, { status: 500 });
  }
  const contentModel = gen.content_model as ContentModel;
  const brief = contentModel.image_briefs.find((b) => b.slot_id === slotId);
  if (!brief) {
    return NextResponse.json({ error: "No image brief found for this slot" }, { status: 500 });
  }

  const businessType = deriveBusinessType(gen.brief as GenerationBrief);
  const options = gen.options as { exclude_people?: unknown } | null;
  const excludePeople = options?.exclude_people !== false;
  const page = slot.next_page ?? 2;

  const fresh = await gatherSlotCandidates({
    brief,
    businessType,
    admin,
    excludePeople,
    excludeIds: slot.seen_pexels_ids,
    presentMax: slot.present_max,
    page,
  });

  const newPexelsIds = fresh.map((c) => c.pexelsId).filter((n): n is number => typeof n === "number");
  const updatedSlot: ImageSlot = {
    ...slot,
    candidates: mergeCandidates(slot.candidates, fresh),
    seen_pexels_ids: [...slot.seen_pexels_ids, ...newPexelsIds],
    next_page: page + 1,
  };
  const updatedSlots = slots.map((s) => (s.id === slotId ? updatedSlot : s));

  const { error: updateErr } = await admin
    .from("template_generations")
    .update({ image_slots: updatedSlots, updated_at: new Date().toISOString() })
    .eq("id", id);
  if (updateErr) return NextResponse.json({ error: updateErr.message }, { status: 400 });

  return NextResponse.json({ slot: updatedSlot });
}
