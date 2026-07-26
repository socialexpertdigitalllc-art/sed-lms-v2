import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { guard, guardError } from "@/lib/site-studio/service/guard";
import { isTerminal } from "@/lib/site-studio/run/types";
import { loadManifest } from "@/lib/site-studio/run/engine";
import { revertField, type RevertTarget } from "@/lib/site-studio/run/revert";
import type { RunContentDoc } from "@/lib/site-studio/run/applyWritten";
import { contentDocSchema } from "@/lib/site-studio/schema";

export const runtime = "nodejs";
export const maxDuration = 60;

type Ctx = { params: Promise<{ id: string }> };

/** POST: revert one field on one doc page back to its AI-written value
 *  (Task 4's `revertField`). Body is `{ page_index, slot_id?, title?: true,
 *  repeat?: { repeat_id, row_index, slot_id } }` — exactly one of
 *  `slot_id`/`title`/`repeat` — mirroring the `/content` PATCH body shape
 *  (`repeat_id`/`row_index`/`slot_id` there are `repeats: { [repeatId]:
 *  { [rowIndex]: { [slotId]: value } } }`; here they're a single named
 *  triple since a revert only ever targets ONE field, not a batch of edits).
 *  Refused once the run is terminal, same discipline as `/content` and
 *  `/theme`: there is nothing left downstream that would pick a revert up
 *  once a run is done. A field with no AI backup (never operator-edited, or
 *  already reverted once) is a 422 naming the field, never a silent no-op —
 *  `revertField`'s own error text is surfaced verbatim. */
export async function POST(req: Request, ctx: Ctx) {
  const auth = await guard();
  if ("error" in auth) return guardError(auth.error);
  const { id } = await ctx.params;

  const body = (await req.json().catch(() => null)) as
    | {
        page_index?: unknown;
        slot_id?: unknown;
        title?: unknown;
        repeat?: { repeat_id?: unknown; row_index?: unknown; slot_id?: unknown };
      }
    | null;
  if (!body || typeof body.page_index !== "number" || !Number.isInteger(body.page_index)) {
    return NextResponse.json({ error: "page_index (integer) is required" }, { status: 422 });
  }
  const hasSlot = body.slot_id !== undefined;
  const hasTitle = body.title !== undefined;
  const hasRepeat = body.repeat !== undefined;
  if (hasSlot && typeof body.slot_id !== "string") {
    return NextResponse.json({ error: "slot_id must be a string" }, { status: 422 });
  }
  if (hasTitle && body.title !== true) {
    return NextResponse.json({ error: "title must be true" }, { status: 422 });
  }
  if (hasRepeat) {
    const r = body.repeat;
    if (
      typeof r !== "object" ||
      r === null ||
      typeof r.repeat_id !== "string" ||
      typeof r.row_index !== "number" ||
      !Number.isInteger(r.row_index) ||
      r.row_index < 0 ||
      typeof r.slot_id !== "string"
    ) {
      return NextResponse.json(
        { error: "repeat must be { repeat_id: string, row_index: non-negative integer, slot_id: string }" },
        { status: 422 },
      );
    }
  }
  if ([hasSlot, hasTitle, hasRepeat].filter(Boolean).length !== 1) {
    // none, or more than one, of slot_id/title/repeat present
    return NextResponse.json({ error: "Provide exactly one of slot_id, title, or repeat" }, { status: 422 });
  }
  const target: RevertTarget = hasTitle
    ? { title: true }
    : hasRepeat
      ? {
          repeat: {
            repeatId: body.repeat!.repeat_id as string,
            rowIndex: body.repeat!.row_index as number,
            slotId: body.repeat!.slot_id as string,
          },
        }
      : { slotId: body.slot_id as string };

  const admin = createAdminClient();
  const { data: row, error: fetchErr } = await admin.from("studio_runs").select("*").eq("id", id).single();
  if (fetchErr || !row) return NextResponse.json({ error: "Not found" }, { status: 404 });
  if (isTerminal(row.status)) {
    return NextResponse.json({ error: `Cannot revert content: this run is ${row.status}.` }, { status: 409 });
  }
  if (!row.content_doc) return NextResponse.json({ error: "This run has no content yet" }, { status: 422 });

  const doc = row.content_doc as RunContentDoc;
  const pageIndex = body.page_index;
  if (pageIndex < 0 || pageIndex >= doc.pages.length) {
    return NextResponse.json({ error: `page_index out of range (doc has ${doc.pages.length} page(s))` }, { status: 422 });
  }

  // Images have no AI-written value to revert to (review fix, Phase 4a): an
  // image slot's pre-pick value is the TEMPLATE'S own demo sample, seeded
  // long before any Writer call — `applyOperatorEdit` no longer even backs
  // one up (see its own doc comment), but this check names the refusal
  // clearly rather than letting the caller see a generic "no AI backup"
  // message that reads like a fixable timing issue instead of a category
  // that will never have a backup. Checked for a repeat-row target too — a
  // repeat can declare an image slot per row (e.g. a team grid's photo)
  // exactly like a page-level slot can.
  if (hasSlot || hasRepeat) {
    const docPage = doc.pages[pageIndex];
    let manifest;
    try {
      manifest = await loadManifest(admin, row.template_id);
    } catch (e) {
      return NextResponse.json({ error: e instanceof Error ? e.message : "Could not load template" }, { status: 500 });
    }
    const pageDef = manifest.pages.find((p) => p.id === docPage.page_id);
    const slotDef =
      hasSlot && "slotId" in target
        ? pageDef?.slots.find((s) => s.id === target.slotId)
        : "repeat" in target
          ? pageDef?.repeats.find((r) => r.id === target.repeat.repeatId)?.slots.find((s) => s.id === target.repeat.slotId)
          : undefined;
    if (slotDef?.type === "image") {
      return NextResponse.json(
        { error: "Images have no AI-written value to revert to — pick a different image instead." },
        { status: 422 },
      );
    }
  }

  const reverted = revertField(doc, pageIndex, target);
  if (!reverted.ok) {
    return NextResponse.json({ error: reverted.error }, { status: 422 });
  }
  const merged = reverted.doc;

  // Validation gate only — contentDocSchema.parse strips the provenance key
  // (it only describes the renderer-facing shape), so the value PERSISTED
  // below is `merged` itself, never the parsed/stripped result. Matches the
  // same defense-in-depth check `/content` and `/images` run before their
  // own CAS write.
  const check = contentDocSchema.safeParse(merged);
  if (!check.success) {
    return NextResponse.json({ error: `Revert rejected: ${check.error.issues[0]?.message ?? "invalid content"}` }, { status: 422 });
  }

  // CAS on `updated_at` — same discipline as `/content`, `/theme`, and
  // `/images`: a revert landing near-simultaneously with another edit on the
  // same run must not silently clobber whichever finishes last. Zero rows
  // back means someone else wrote this run since `row` was read; refuse
  // rather than overwrite, and tell the operator to redo the action against
  // fresh state.
  const { data: updated, error } = await admin
    .from("studio_runs")
    .update({ content_doc: merged, updated_at: new Date().toISOString() })
    .eq("id", id)
    .eq("updated_at", row.updated_at)
    .select("*")
    .single();
  if (error || !updated) {
    return NextResponse.json(
      { error: "This run changed while you were editing — your view has been refreshed, please redo that change" },
      { status: 409 },
    );
  }

  const fieldLabel = hasTitle
    ? "title"
    : hasRepeat
      ? `repeat "${body.repeat!.repeat_id}" row ${body.repeat!.row_index} slot "${body.repeat!.slot_id}"`
      : `slot "${body.slot_id}"`;
  await admin.from("studio_run_events").insert({
    run_id: id,
    step: "revert",
    level: "info",
    message: `reverted page ${pageIndex}'s ${fieldLabel} to its AI value`,
    detail: { page_index: pageIndex, ...target },
  });
  await admin.from("activity_log").insert({
    user_id: auth.userId,
    action: "studio.run.reverted",
    entity_type: "studio_run",
    entity_id: id,
    new_value: { page_index: pageIndex, ...target },
  });

  return NextResponse.json({ run: updated });
}
