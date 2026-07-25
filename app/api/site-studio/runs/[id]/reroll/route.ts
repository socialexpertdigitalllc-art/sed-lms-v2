import { NextResponse } from "next/server";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createAdminClient } from "@/lib/supabase/admin";
import { guard, guardError } from "@/lib/site-studio/service/guard";
import { productionWriterCall } from "@/lib/site-studio/run/engine";
import { rerollPage, rerollSlot } from "@/lib/site-studio/run/reroll";
import { buildDossier } from "@/lib/site-studio/run/dossier";
import { manifestSchema, type TemplateManifest } from "@/lib/site-studio/schema";
import type { StudioRunRow } from "@/lib/site-studio/run/types";

export const runtime = "nodejs";
export const maxDuration = 120;

type Ctx = { params: Promise<{ id: string }> };

/** Same tiny loader `engine.ts` uses internally (not exported from there —
 *  duplicated here rather than widening engine.ts's public surface for one
 *  caller). */
async function loadManifest(admin: SupabaseClient, templateId: string): Promise<TemplateManifest> {
  const { data, error } = await admin.from("studio_templates").select("manifest").eq("id", templateId).single();
  if (error || !data?.manifest) {
    throw new Error(`re-roll: template "${templateId}" has no compiled manifest (${error?.message ?? "not found"})`);
  }
  return manifestSchema.parse(data.manifest);
}

async function loadLeadRow(admin: SupabaseClient, leadId: string): Promise<Record<string, unknown> | null> {
  const { data, error } = await admin.from("leads").select("*").eq("id", leadId).single();
  if (error || !data) return null;
  return data as Record<string, unknown>;
}

/**
 * Re-roll is a Gate 1 activity (spec §7): checked here, BEFORE ever loading
 * the template/lead or spending an AI call, so an off-gate call is cheap to
 * refuse. `reroll.ts`'s own `requireGate` re-asserts the same check
 * internally — belt-and-braces, not redundant: this route's check is what
 * keeps a stale/deleted lead or template from even being loaded for a run
 * that isn't at the gate anyway.
 */
export async function POST(req: Request, ctx: Ctx) {
  const auth = await guard();
  if ("error" in auth) return guardError(auth.error);
  const { id } = await ctx.params;

  const body = (await req.json().catch(() => null)) as
    | { page_index?: unknown; slot_id?: unknown; include_operator?: unknown }
    | null;
  if (!body || typeof body.page_index !== "number" || !Number.isInteger(body.page_index)) {
    return NextResponse.json({ error: "page_index (integer) is required" }, { status: 422 });
  }
  const slotId = typeof body.slot_id === "string" && body.slot_id ? body.slot_id : undefined;
  const includeOperator = body.include_operator === true;

  const admin = createAdminClient();
  const { data: row, error: fetchErr } = await admin.from("studio_runs").select("*").eq("id", id).single();
  if (fetchErr || !row) return NextResponse.json({ error: "Not found" }, { status: 404 });
  const run = row as StudioRunRow;
  if (run.status !== "reviewing") {
    return NextResponse.json({ error: `Cannot re-roll: this run is "${run.status}", not at the gate.` }, { status: 409 });
  }
  if (!run.lead_id) return NextResponse.json({ error: "This run has no lead" }, { status: 422 });

  const leadRow = await loadLeadRow(admin, run.lead_id);
  if (!leadRow) return NextResponse.json({ error: "This run's lead no longer exists" }, { status: 422 });
  const dossier = buildDossier(leadRow);

  let manifest: TemplateManifest;
  try {
    manifest = await loadManifest(admin, run.template_id);
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "Could not load template" }, { status: 500 });
  }

  const outcome = slotId
    ? await rerollSlot({ aiCall: productionWriterCall }, manifest, dossier, run, body.page_index, slotId, {
        includeOperatorFields: includeOperator,
      })
    : await rerollPage({ aiCall: productionWriterCall }, manifest, dossier, run, body.page_index, {
        includeOperatorFields: includeOperator,
      });

  if (!outcome.ok) return NextResponse.json({ error: outcome.error }, { status: 422 });

  const { data: updated, error } = await admin
    .from("studio_runs")
    .update({ content_doc: outcome.doc, updated_at: new Date().toISOString() })
    .eq("id", id)
    .select("*")
    .single();
  if (error || !updated) return NextResponse.json({ error: error?.message ?? "Update failed" }, { status: 400 });

  await admin.from("studio_run_events").insert({
    run_id: id,
    step: "reroll",
    level: "info",
    message: slotId
      ? `re-rolled slot "${slotId}" on page ${body.page_index}`
      : `re-rolled page ${body.page_index}`,
    detail: { page_index: body.page_index, slot_id: slotId ?? null, include_operator: includeOperator },
  });
  await admin.from("activity_log").insert({
    user_id: auth.userId,
    action: "studio.run.rerolled",
    entity_type: "studio_run",
    entity_id: id,
    new_value: { page_index: body.page_index, slot_id: slotId ?? null },
  });

  return NextResponse.json({ run: updated });
}
