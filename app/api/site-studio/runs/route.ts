import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { guard, guardError } from "@/lib/site-studio/service/guard";

export const runtime = "nodejs";
export const maxDuration = 60;

export async function GET() {
  const auth = await guard();
  if ("error" in auth) return guardError(auth.error);

  const admin = createAdminClient();
  const { data, error } = await admin
    .from("studio_runs")
    .select(
      "id, lead_id, template_id, template_version, status, options, site_slug, zip_path, deployed_url, error, created_at, updated_at, leads(business_name)",
    )
    .order("created_at", { ascending: false });
  if (error) return NextResponse.json({ error: error.message }, { status: 400 });
  return NextResponse.json({ runs: data ?? [] });
}

/** Starts a new generation run: lead + certified template -> queued row. */
export async function POST(req: Request) {
  const auth = await guard();
  if ("error" in auth) return guardError(auth.error);

  const body = (await req.json().catch(() => null)) as
    | { lead_id?: string; template_id?: string; options?: Record<string, unknown> }
    | null;
  const leadId = typeof body?.lead_id === "string" ? body.lead_id : "";
  const templateId = typeof body?.template_id === "string" ? body.template_id : "";
  if (!leadId || !templateId) {
    return NextResponse.json({ error: "lead_id and template_id are required" }, { status: 422 });
  }

  const admin = createAdminClient();

  const { data: lead } = await admin.from("leads").select("id,business_name").eq("id", leadId).is("deleted_at", null).single();
  if (!lead) return NextResponse.json({ error: "Lead not found" }, { status: 404 });

  const { data: template } = await admin.from("studio_templates").select("id,status,version").eq("id", templateId).single();
  if (!template) return NextResponse.json({ error: "Template not found" }, { status: 404 });
  if (template.status !== "certified") {
    return NextResponse.json({ error: "Only a certified template can start a generation run" }, { status: 409 });
  }

  const options = body?.options && typeof body.options === "object" && !Array.isArray(body.options) ? body.options : {};

  const { data: run, error } = await admin
    .from("studio_runs")
    .insert({
      lead_id: leadId,
      template_id: templateId,
      template_version: template.version,
      options,
      status: "queued",
      created_by: auth.userId,
    })
    .select("*")
    .single();

  if (error || !run) {
    // studio_runs_one_active_per_lead (migration 0053) is the real guard —
    // a lead with a run already in queued/preparing/writing/rendering hits
    // this unique-index violation. Convert it into a clear 409 instead of
    // letting the raw Postgres error surface.
    if (error?.code === "23505") {
      return NextResponse.json(
        { error: "This lead already has an active generation run. Finish or cancel it before starting another." },
        { status: 409 },
      );
    }
    return NextResponse.json({ error: error?.message ?? "Create failed" }, { status: 400 });
  }

  await admin.from("activity_log").insert({
    user_id: auth.userId,
    action: "studio.run.created",
    entity_type: "studio_run",
    entity_id: run.id,
    new_value: { lead_id: leadId, template_id: templateId, business_name: lead.business_name },
  });

  return NextResponse.json({ run }, { status: 201 });
}
