import { NextResponse } from "next/server";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getUserPermissions } from "@/lib/permissions/resolver";
import { gatherMoreCandidates, deriveBusinessType } from "@/lib/template-engine/gatherImages";
import { mergeCandidates, parseImageSlots, type ImageSlot } from "@/lib/template-engine/imageSlots";
import type { ContentModel } from "@/lib/template-engine/contentModel";
import type { GenerationBrief } from "@/lib/template-engine/brief";

interface GenRow {
  id: string;
  lead_id: string;
  status: string;
  content_model: unknown;
  image_slots: unknown;
  brief: unknown;
}

const bodySchema = z.object({ allow: z.boolean() });

/**
 * Per-slot "Allow people" override.
 *
 * `exclude_people` is a whole-generation option and is by far the dominant
 * filter — for a team/about shot, or a niche trade with almost no people-free
 * stock, it can empty a slot on its own. This flips it for ONE slot without
 * touching the generation, and (when turning it ON) immediately re-gathers
 * from page 1 with the gate down: the photos previously rejected for showing
 * people are exactly the ones the operator is now asking to see, so the
 * re-gather deliberately ignores `seen_pexels_ids`. Turning it back OFF only
 * persists the flag — nothing already on screen is yanked away.
 */
export async function POST(
  req: Request,
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

  const parsed = bodySchema.safeParse(await req.json());
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid input", issues: parsed.error.flatten() }, { status: 422 });
  }

  const admin = createAdminClient();
  const { data: genRow } = await admin
    .from("template_generations")
    .select("id, lead_id, status, content_model, image_slots, brief")
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

  const allow = parsed.data.allow;
  let updatedSlot: ImageSlot = { ...slot, allow_people: allow };

  if (allow) {
    if (!gen.content_model) {
      return NextResponse.json({ error: "Generation has no content model" }, { status: 500 });
    }
    if (!gen.brief) {
      return NextResponse.json({ error: "Generation has no frozen brief" }, { status: 500 });
    }
    const brief = (gen.content_model as ContentModel).image_briefs.find((b) => b.slot_id === slotId);
    if (!brief) {
      return NextResponse.json({ error: "No image brief found for this slot" }, { status: 500 });
    }
    const businessType = deriveBusinessType(gen.brief as GenerationBrief);
    const fresh = await gatherMoreCandidates({
      brief,
      businessType,
      admin,
      excludePeople: false,
      excludeIds: [], // deliberately re-judge from page 1: the rejects are the point
      presentMax: slot.present_max,
      startPage: 1,
    });
    updatedSlot = {
      ...updatedSlot,
      candidates: mergeCandidates(slot.candidates, fresh.candidates),
      seen_pexels_ids: Array.from(new Set([...slot.seen_pexels_ids, ...fresh.fetchedIds])),
      next_page: Math.max(slot.next_page ?? 2, fresh.nextPage),
      last_gather: fresh.stats,
    };
  }

  const updatedSlots = slots.map((s) => (s.id === slotId ? updatedSlot : s));
  const { error: updateErr } = await admin
    .from("template_generations")
    .update({ image_slots: updatedSlots, updated_at: new Date().toISOString() })
    .eq("id", id);
  if (updateErr) return NextResponse.json({ error: updateErr.message }, { status: 400 });

  return NextResponse.json({ slot: updatedSlot });
}
