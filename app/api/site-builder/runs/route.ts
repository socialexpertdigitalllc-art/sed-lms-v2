import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { guard, guardError } from "@/lib/site-studio/service/guard";
import type { SuppliedImage } from "@/lib/site-builder/prompt";

export const runtime = "nodejs";
export const maxDuration = 30;

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
 * Create a run and return it immediately, still "queued" — generation is a
 * SEPARATE request (`POST /runs/[id]/generate`) that the run screen fires
 * the moment it sees a queued run. Split this way so the operator lands on
 * the run screen instantly and watches per-page progress live (the generate
 * route persists every page-state change), instead of staring at a spinner
 * on the New Site screen for the whole generation.
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
  const rawOptions = body?.options && typeof body.options === "object" && !Array.isArray(body.options) ? body.options : {};
  // `auto_deploy` publishes a real client site with no review step, so it is
  // normalised to a STRICT boolean here rather than stored verbatim: a
  // truthy-but-not-true value ("false", 1, {}) must never read as consent
  // downstream (lib/site-builder/generateRun.ts tests it with ===).
  const options = { ...rawOptions, auto_deploy: rawOptions.auto_deploy === true };

  const admin = createAdminClient();

  const { data: lead } = await admin.from("leads").select("*").eq("id", leadId).is("deleted_at", null).single();
  if (!lead) return NextResponse.json({ error: "Lead not found" }, { status: 404 });

  const { data: template } = await admin.from("builder_templates").select("id").eq("id", templateId).single();
  if (!template) return NextResponse.json({ error: "Template not found" }, { status: 404 });

  const { data: run, error: insErr } = await admin
    .from("builder_runs")
    .insert({ lead_id: leadId, template_id: templateId, options, images, status: "queued", created_by: auth.userId })
    .select("*")
    .single();
  if (insErr || !run) return NextResponse.json({ error: insErr?.message ?? "Create failed" }, { status: 400 });

  await admin.from("activity_log").insert({
    user_id: auth.userId,
    action: "site_builder.run.created",
    entity_type: "builder_run",
    entity_id: run.id,
    new_value: { lead_id: leadId, template_id: templateId, business_name: lead.business_name, status: "queued" },
  });

  return NextResponse.json({ run }, { status: 201 });
}
