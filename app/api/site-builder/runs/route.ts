import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { guard, guardError } from "@/lib/site-studio/service/guard";
import { loadTemplateBundle } from "@/lib/site-builder/templates";
import { productionSiteBuildCall } from "@/lib/site-builder/generate";
import { runSite, buildBrief, outputPathFor, BUILDER_SITES_BUCKET } from "@/lib/site-builder/run";
import type { SuppliedImage } from "@/lib/site-builder/prompt";

export const runtime = "nodejs";
export const maxDuration = 300;

function sanitizeImages(input: unknown): SuppliedImage[] {
  if (!Array.isArray(input)) return [];
  const out: SuppliedImage[] = [];
  for (const item of input) {
    if (!item || typeof item !== "object") continue;
    const url = typeof (item as Record<string, unknown>).url === "string" ? (item as Record<string, unknown>).url as string : "";
    const purpose = typeof (item as Record<string, unknown>).purpose === "string" ? (item as Record<string, unknown>).purpose as string : "";
    if (url.trim()) out.push({ url: url.trim(), purpose: purpose.trim() || "unspecified" });
  }
  return out;
}

export async function GET() {
  const auth = await guard();
  if ("error" in auth) return guardError(auth.error);

  const admin = createAdminClient();
  const { data, error } = await admin
    .from("builder_runs")
    .select("id, lead_id, template_id, status, options, images, output_path, deployed_url, error, created_at, updated_at, leads(business_name)")
    .order("created_at", { ascending: false });
  if (error) return NextResponse.json({ error: error.message }, { status: 400 });
  return NextResponse.json({ runs: data ?? [] });
}

/**
 * Create+start a run in one request: builds the whole site (every template
 * page in parallel, plus any lead-requested pages the template lacks),
 * assembles the output zip, and leaves the row in "review" (or "failed" only
 * if EVERY page failed) — see runSite's own doc comment. There is no
 * separate step machine to poll; a real page is one AI call, not a pipeline.
 */
export async function POST(req: Request) {
  const auth = await guard();
  if ("error" in auth) return guardError(auth.error);

  const body = (await req.json().catch(() => null)) as
    | { lead_id?: string; template_id?: string; options?: Record<string, unknown>; images?: unknown }
    | null;
  const leadId = typeof body?.lead_id === "string" ? body.lead_id : "";
  const templateId = typeof body?.template_id === "string" ? body.template_id : "";
  if (!leadId || !templateId) {
    return NextResponse.json({ error: "lead_id and template_id are required" }, { status: 422 });
  }
  const images = sanitizeImages(body?.images);
  const options = body?.options && typeof body.options === "object" && !Array.isArray(body.options) ? body.options : {};

  const admin = createAdminClient();

  const { data: lead } = await admin.from("leads").select("*").eq("id", leadId).is("deleted_at", null).single();
  if (!lead) return NextResponse.json({ error: "Lead not found" }, { status: 404 });

  const { data: template } = await admin.from("builder_templates").select("id").eq("id", templateId).single();
  if (!template) return NextResponse.json({ error: "Template not found" }, { status: 404 });

  const { data: run, error: insErr } = await admin
    .from("builder_runs")
    .insert({ lead_id: leadId, template_id: templateId, options, images, status: "generating", created_by: auth.userId })
    .select("*")
    .single();
  if (insErr || !run) return NextResponse.json({ error: insErr?.message ?? "Create failed" }, { status: 400 });

  try {
    const bundle = await loadTemplateBundle(admin, templateId);
    const brief = buildBrief(lead as Record<string, unknown>);
    const requestedPages = Array.isArray(lead.specify_pages) ? (lead.specify_pages as unknown[]).map(String) : [];

    const result = await runSite({ aiCall: productionSiteBuildCall, brief, images, template: bundle, requestedPages });

    let outputPath: string | null = null;
    if (result.zipBytes) {
      outputPath = outputPathFor(run.id);
      const { error: upErr } = await admin.storage
        .from(BUILDER_SITES_BUCKET)
        .upload(outputPath, result.zipBytes, { contentType: "application/zip", upsert: true });
      if (upErr) throw new Error(`zip upload failed: ${upErr.message}`);
    }

    const { data: updated, error: updErr } = await admin
      .from("builder_runs")
      .update({
        status: result.ok ? "review" : "failed",
        pages: result.pages,
        output_path: outputPath,
        error: result.ok ? null : "Every page failed to generate.",
        updated_at: new Date().toISOString(),
      })
      .eq("id", run.id)
      .select("*")
      .single();
    if (updErr || !updated) return NextResponse.json({ error: updErr?.message ?? "Update failed" }, { status: 400 });

    await admin.from("activity_log").insert({
      user_id: auth.userId,
      action: "site_builder.run.created",
      entity_type: "builder_run",
      entity_id: run.id,
      new_value: { lead_id: leadId, template_id: templateId, business_name: lead.business_name, status: updated.status },
    });

    return NextResponse.json({ run: updated }, { status: 201 });
  } catch (e) {
    const message = e instanceof Error ? e.message : "Generation failed";
    await admin
      .from("builder_runs")
      .update({ status: "failed", error: message, updated_at: new Date().toISOString() })
      .eq("id", run.id);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
