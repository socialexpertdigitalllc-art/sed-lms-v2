import { NextResponse } from "next/server";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getUserPermissions } from "@/lib/permissions/resolver";
import { parseImageSlots, type ImageSlot } from "@/lib/template-engine/imageSlots";
import { validateSelection } from "@/lib/template-engine/curation";
import { bumpCuratedUsage } from "@/lib/template-engine/curatedImages";

interface GenRow {
  id: string;
  lead_id: string;
  status: string;
  image_slots: unknown;
}

const selectSchema = z.object({ urls: z.array(z.string().min(1)) });

/** Operator picks (or clears) which gathered candidates to ship for one slot. */
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

  const parsed = selectSchema.safeParse(await req.json());
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid input", issues: parsed.error.flatten() }, { status: 422 });
  }

  const admin = createAdminClient();
  const { data: genRow } = await admin
    .from("template_generations")
    .select("id, lead_id, status, image_slots")
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

  const validationError = validateSelection(slot, parsed.data.urls);
  if (validationError) {
    return NextResponse.json({ error: validationError }, { status: 422 });
  }

  const updatedSlot: ImageSlot = { ...slot, selected: parsed.data.urls };
  const updatedSlots = slots.map((s) => (s.id === slotId ? updatedSlot : s));

  const { error: updateErr } = await admin
    .from("template_generations")
    .update({ image_slots: updatedSlots, updated_at: new Date().toISOString() })
    .eq("id", id);
  if (updateErr) return NextResponse.json({ error: updateErr.message }, { status: 400 });

  // Usage telemetry for the curated library: count only urls newly selected in
  // THIS request, and only ones that came from `curated_images`. Best-effort.
  const newlyCurated = parsed.data.urls.filter(
    (u) => !slot.selected.includes(u) && slot.candidates.some((c) => c.url === u && c.source === "curated"),
  );
  await bumpCuratedUsage(admin, newlyCurated);

  return NextResponse.json({ slot: updatedSlot });
}
