import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { guard, guardError } from "@/lib/site-studio/service/guard";
import { isTerminal } from "@/lib/site-studio/run/types";
import { applyOperatorEdit, findDisallowedEditField } from "@/lib/site-studio/run/applyWritten";
import { contentDocSchema, type ContentDoc } from "@/lib/site-studio/schema";

export const runtime = "nodejs";
export const maxDuration = 60;

type Ctx = { params: Promise<{ id: string }> };

/** True for a plain object body value (not null, not an array) — the shape
 *  every level of the `repeats` body (repeat id -> row index -> slot id ->
 *  value) is validated against below. */
function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

/** Validates the `repeats` body shape (`{ [repeatId]: { [rowIndex]:
 *  { [slotId]: string } } }`) three levels deep, WITHOUT checking row
 *  indices are in range — that's `applyOperatorEdit`'s job (it throws a
 *  RangeError this route turns into a 422), since only it knows how many
 *  rows each repeat actually has. Returns a human-readable reason for the
 *  first structural problem found, or null when the shape is clean. */
function invalidRepeatsShape(repeats: Record<string, unknown>): string | null {
  for (const rows of Object.values(repeats)) {
    if (!isPlainObject(rows)) return "repeats must be an object of repeat id -> row index -> slot id -> string";
    for (const slots of Object.values(rows)) {
      if (!isPlainObject(slots)) return "repeats must be an object of repeat id -> row index -> slot id -> string";
      for (const value of Object.values(slots)) {
        if (typeof value !== "string") return "repeats must be an object of repeat id -> row index -> slot id -> string";
      }
    }
  }
  return null;
}

/** Operator edits to one page's content. Partial: only the fields supplied
 *  are touched (an edit to one headline must not blank the rest of the
 *  page), and every touched field is stamped provenance "operator" so a
 *  later AI re-roll (which only ever touches AI-written fields) leaves it
 *  alone. Refused once the run is terminal (ready/failed/cancelled) — there
 *  is nothing left downstream that would pick the edit up.
 *
 *  REPEAT ROWS (Phase 4a): `repeats` names a repeat-row target — the SAME
 *  row-aware shape `applyOperatorEdit`'s `OperatorEdit.repeats` and
 *  `PageProvenance.repeats` already use — `{ [repeatId]: { [rowIndex]:
 *  { [slotId]: value } } }`, so a click on one service card's headline in
 *  the Gate 2 preview (`components/site-studio/RunPreview.tsx`) can name
 *  exactly that row without touching any sibling row in the same repeat.
 *  `rowIndex` is a string object key (as every JSON body's keys always are)
 *  — `applyOperatorEdit` is what turns it back into a number and validates
 *  it against the row count. */
export async function PATCH(req: Request, ctx: Ctx) {
  const auth = await guard();
  if ("error" in auth) return guardError(auth.error);
  const { id } = await ctx.params;

  const body = (await req.json().catch(() => null)) as
    | { page_index?: unknown; slots?: unknown; title?: unknown; repeats?: unknown }
    | null;
  if (!body || typeof body.page_index !== "number" || !Number.isInteger(body.page_index)) {
    return NextResponse.json({ error: "page_index (integer) is required" }, { status: 422 });
  }
  const hasSlots = body.slots !== undefined;
  const hasTitle = body.title !== undefined;
  const hasRepeats = body.repeats !== undefined;
  if (hasSlots && (typeof body.slots !== "object" || body.slots === null || Array.isArray(body.slots))) {
    return NextResponse.json({ error: "slots must be an object of slot id -> string" }, { status: 422 });
  }
  if (hasTitle && typeof body.title !== "string") {
    return NextResponse.json({ error: "title must be a string" }, { status: 422 });
  }
  if (hasRepeats) {
    if (!isPlainObject(body.repeats)) {
      return NextResponse.json(
        { error: "repeats must be an object of repeat id -> row index -> slot id -> string" },
        { status: 422 },
      );
    }
    const shapeError = invalidRepeatsShape(body.repeats);
    if (shapeError) return NextResponse.json({ error: shapeError }, { status: 422 });
  }
  if (!hasSlots && !hasTitle && !hasRepeats) return NextResponse.json({ error: "Nothing to update" }, { status: 422 });

  // Hold an operator's hand-typed edit to the same bar the Writer's AI
  // output is held to (see findDisallowedEditField's own note): no markup,
  // no template tokens, no bare links.
  const badField = findDisallowedEditField({
    title: hasTitle ? (body.title as string) : undefined,
    slots: hasSlots ? (body.slots as Record<string, string>) : undefined,
    repeats: hasRepeats ? (body.repeats as Record<string, Record<string, Record<string, string>>>) : undefined,
  });
  if (badField) {
    return NextResponse.json(
      { error: `${badField} contains markup, a URL, or token syntax, which isn't allowed` },
      { status: 422 },
    );
  }

  const admin = createAdminClient();
  const { data: row, error: fetchErr } = await admin.from("studio_runs").select("*").eq("id", id).single();
  if (fetchErr || !row) return NextResponse.json({ error: "Not found" }, { status: 404 });
  if (isTerminal(row.status)) {
    return NextResponse.json({ error: `Cannot edit content: this run is ${row.status}.` }, { status: 409 });
  }
  if (!row.content_doc) return NextResponse.json({ error: "This run has no content yet" }, { status: 422 });

  const doc = row.content_doc as ContentDoc;
  const pageIndex = body.page_index;
  if (pageIndex < 0 || pageIndex >= doc.pages.length) {
    return NextResponse.json({ error: `page_index out of range (doc has ${doc.pages.length} page(s))` }, { status: 422 });
  }

  let merged;
  try {
    merged = applyOperatorEdit(doc, pageIndex, {
      title: hasTitle ? (body.title as string) : undefined,
      slots: hasSlots ? (body.slots as Record<string, string>) : undefined,
      repeats: hasRepeats ? (body.repeats as Record<string, Record<string, Record<string, string>>>) : undefined,
    });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "Invalid edit" }, { status: 422 });
  }

  // Validation gate only — contentDocSchema.parse strips the provenance key
  // (it only describes the renderer-facing shape), so the value PERSISTED
  // below is `merged` itself, never the parsed/stripped result.
  const check = contentDocSchema.safeParse(merged);
  if (!check.success) {
    return NextResponse.json({ error: `Edit rejected: ${check.error.issues[0]?.message ?? "invalid content"}` }, { status: 422 });
  }

  // CAS on `updated_at` (same shape as the engine's own `persistRun`/
  // `claimRun`, see engine.ts's doc comment on that contract): without this,
  // two near-simultaneous operator actions on the same run — e.g. a text
  // edit here landing while an image pick's read->merge->write is also in
  // flight — silently drop whichever finishes last. Zero rows back means
  // someone else wrote this run since `row` was read; refuse rather than
  // overwrite, and tell the operator to redo the edit against fresh state.
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

  return NextResponse.json({ run: updated });
}
