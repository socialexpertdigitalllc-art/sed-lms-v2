import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { guard, guardError } from "@/lib/site-studio/service/guard";
import { isTerminal } from "@/lib/site-studio/run/types";
import { revertField, type RevertTarget } from "@/lib/site-studio/run/revert";
import type { RunContentDoc } from "@/lib/site-studio/run/applyWritten";

export const runtime = "nodejs";
export const maxDuration = 60;

type Ctx = { params: Promise<{ id: string }> };

/** POST: revert one field on one doc page back to its AI-written value
 *  (Task 4's `revertField`). Body is `{ page_index, slot_id? , title?: true }`
 *  — exactly one of `slot_id`/`title` — mirroring the `/content` PATCH body
 *  shape. Refused once the run is terminal, same discipline as `/content`
 *  and `/theme`: there is nothing left downstream that would pick a revert
 *  up once a run is done. A field with no AI backup (never operator-edited,
 *  or already reverted once) is a 422 naming the field, never a silent
 *  no-op — `revertField`'s own error text is surfaced verbatim. */
export async function POST(req: Request, ctx: Ctx) {
  const auth = await guard();
  if ("error" in auth) return guardError(auth.error);
  const { id } = await ctx.params;

  const body = (await req.json().catch(() => null)) as
    | { page_index?: unknown; slot_id?: unknown; title?: unknown }
    | null;
  if (!body || typeof body.page_index !== "number" || !Number.isInteger(body.page_index)) {
    return NextResponse.json({ error: "page_index (integer) is required" }, { status: 422 });
  }
  const hasSlot = body.slot_id !== undefined;
  const hasTitle = body.title !== undefined;
  if (hasSlot && typeof body.slot_id !== "string") {
    return NextResponse.json({ error: "slot_id must be a string" }, { status: 422 });
  }
  if (hasTitle && body.title !== true) {
    return NextResponse.json({ error: "title must be true" }, { status: 422 });
  }
  if (hasSlot === hasTitle) {
    // both present or both absent: exactly one of slot_id/title is required
    return NextResponse.json({ error: "Provide exactly one of slot_id or title" }, { status: 422 });
  }
  const target: RevertTarget = hasTitle ? { title: true } : { slotId: body.slot_id as string };

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

  const reverted = revertField(doc, pageIndex, target);
  if (!reverted.ok) {
    return NextResponse.json({ error: reverted.error }, { status: 422 });
  }
  const merged = reverted.doc;

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

  const fieldLabel = hasTitle ? "title" : `slot "${body.slot_id}"`;
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
