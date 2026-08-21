import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { guard, guardError } from "@/lib/site-studio/service/guard";

export const runtime = "nodejs";
export const maxDuration = 30;

/**
 * The batch cap. Deliberately small: every run in the batch draws on ONE
 * shared provider budget, and the background processor drains the queue one
 * run at a time by design — so a bigger batch is not faster output, it is a
 * longer parked queue. Fifty runs is already hours of drain time.
 */
const MAX_BULK_LEADS = 50;

type BulkResult = { lead_id: string; created: string } | { lead_id: string; skipped: string };

/** A run in either of these states is ACTIVE — queued for the processor or
 *  mid-generation — and its lead must not be queued again. */
const ACTIVE_STATUSES = ["queued", "generating"];

/**
 * Bulk generation: one `queued` run per lead, and nothing else — the
 * background processor (`POST /api/site-builder/process`) drains the queue
 * single-flight from there, and the runs board (which already shows each
 * run's live status) is the bulk board. This route never generates anything
 * itself; it only queues.
 */
export async function POST(req: Request) {
  const auth = await guard();
  if ("error" in auth) return guardError(auth.error);

  const body = (await req.json().catch(() => null)) as
    | { lead_ids?: unknown; template_id?: unknown; options?: unknown }
    | null;
  const leadIds = Array.isArray(body?.lead_ids) ? body.lead_ids.filter((v): v is string => typeof v === "string" && v.length > 0) : [];
  const templateId = typeof body?.template_id === "string" ? body.template_id : "";
  if (leadIds.length === 0 || !templateId) {
    return NextResponse.json({ error: "lead_ids (non-empty) and template_id are required" }, { status: 422 });
  }
  if (leadIds.length > MAX_BULK_LEADS) {
    return NextResponse.json(
      { error: `At most ${MAX_BULK_LEADS} leads per batch — the processor generates one site at a time on a shared provider budget, so a bigger batch only parks a longer queue.` },
      { status: 422 },
    );
  }
  const rawOptions = body?.options && typeof body.options === "object" && !Array.isArray(body.options) ? body.options : {};
  // Bulk queues up to MAX_BULK_LEADS runs from a single click. Auto-deploy is
  // deliberately STRIPPED here: one click must never publish dozens of client
  // sites to public URLs and rewrite dozens of leads' website links. Bulk runs
  // land in review and are deployed individually, as before.
  const options = { ...rawOptions, auto_deploy: false };

  const admin = createAdminClient();

  const { data: template } = await admin.from("builder_templates").select("id").eq("id", templateId).single();
  if (!template) return NextResponse.json({ error: "Template not found" }, { status: 404 });

  // Two reads up front instead of 2N: which of the leads exist (and are not
  // deleted), and which already have an active run.
  const { data: leadRows } = await admin
    .from("leads")
    .select("id, business_name")
    .in("id", leadIds)
    .is("deleted_at", null);
  const leadById = new Map((leadRows ?? []).map((l) => [l.id as string, l]));

  const { data: activeRows } = await admin
    .from("builder_runs")
    .select("lead_id, status")
    .in("lead_id", leadIds)
    .in("status", ACTIVE_STATUSES);
  const activeLeadIds = new Set((activeRows ?? []).map((r) => r.lead_id as string));

  const results: BulkResult[] = [];
  const seen = new Set<string>();
  for (const leadId of leadIds) {
    // The same id twice in one request is the intra-batch double-queue; the
    // second occurrence is skipped, not inserted.
    if (seen.has(leadId)) {
      results.push({ lead_id: leadId, skipped: "duplicated in this request" });
      continue;
    }
    seen.add(leadId);

    if (!leadById.has(leadId)) {
      results.push({ lead_id: leadId, skipped: "lead not found (or deleted)" });
      continue;
    }
    // A bulk click must not double-queue: a lead whose run is already queued
    // or generating gets a skip with the reason, never a second run — the
    // operator clicking Bulk twice (or including a lead someone else just
    // started) should cost nothing.
    if (activeLeadIds.has(leadId)) {
      results.push({ lead_id: leadId, skipped: "this lead already has a run queued or generating" });
      continue;
    }

    // `images: []` per the bulk spec: bulk runs use whatever the prompts
    // derive from the lead itself — there is no per-lead image-picking step
    // in a batch. The operator can regenerate individual pages with picked
    // images afterwards, from the run screen.
    const { data: run, error: insErr } = await admin
      .from("builder_runs")
      .insert({ lead_id: leadId, template_id: templateId, options, images: [], status: "queued", created_by: auth.userId })
      .select("id")
      .single();
    if (insErr || !run) {
      results.push({ lead_id: leadId, skipped: insErr?.message ?? "insert failed" });
      continue;
    }
    results.push({ lead_id: leadId, created: run.id as string });
  }

  const created = results.filter((r) => "created" in r).length;
  const skipped = results.length - created;

  // ONE summary entry for the whole batch — fifty per-run rows would bury the
  // log, and the per-lead outcomes are in the response for the caller.
  await admin.from("activity_log").insert({
    user_id: auth.userId,
    action: "site_builder.runs.bulk_created",
    entity_type: "builder_run",
    entity_id: null,
    new_value: { template_id: templateId, requested: leadIds.length, created, skipped },
  });

  return NextResponse.json({ results, created, skipped }, { status: 201 });
}
