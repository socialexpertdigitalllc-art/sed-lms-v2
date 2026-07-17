import { NextResponse } from "next/server";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getUserPermissions } from "@/lib/permissions/resolver";
import { isToolId } from "@/lib/ai-tools/config";
import { kickTemplateProcessor } from "@/lib/template-engine/queue";
import { generateInputSchema } from "@/lib/template-engine/generateInput";
import type { TemplateManifest } from "@/lib/template-engine/types";

const DEFAULT_PER_PAGE_MS = 25000;
const BASE_OVERHEAD_MS = 15000;

// avg ai_ms per built page over the last 5 successful runs (template+tool,
// falling back to global, falling back to 25s/page)
async function avgPerPageMs(admin: SupabaseClient, templateId: string, tool: string): Promise<number> {
  const sample = async (scoped: boolean): Promise<number | null> => {
    let query = admin
      .from("template_generations")
      .select("ai_ms, pages_built")
      .in("status", ["review", "ready_for_review", "deployed"])
      .not("ai_ms", "is", null)
      .gt("pages_built", 0)
      .order("created_at", { ascending: false })
      .limit(5);
    if (scoped) query = query.eq("template_id", templateId).eq("tool", tool);
    const { data } = await query;
    const rows = (data ?? []).filter((r) => Number(r.ai_ms) > 0 && Number(r.pages_built) > 0);
    if (rows.length === 0) return null;
    return rows.reduce((sum, r) => sum + Number(r.ai_ms) / Number(r.pages_built), 0) / rows.length;
  };
  return (await sample(true)) ?? (await sample(false)) ?? DEFAULT_PER_PAGE_MS;
}

export async function POST(req: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const perms = await getUserPermissions(user.id);
  if (!perms.has("templates.generate")) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const parsed = generateInputSchema.safeParse(await req.json());
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid input", issues: parsed.error.flatten() }, { status: 422 });
  }
  const { leadId, templateId, pages, tool, model } = parsed.data;
  if (!isToolId(tool)) {
    return NextResponse.json({ error: `Unknown tool: ${tool}` }, { status: 422 });
  }

  const admin = createAdminClient();
  // RLS-scoped lookup: a lead this user cannot see must 404, not generate.
  const { data: lead } = await supabase
    .from("leads")
    .select("id")
    .eq("id", leadId)
    .is("deleted_at", null)
    .maybeSingle();
  if (!lead) return NextResponse.json({ error: "Lead not found" }, { status: 404 });

  const { data: template } = await admin
    .from("website_templates")
    .select("id, status, manifest")
    .eq("id", templateId)
    .maybeSingle();
  if (!template) return NextResponse.json({ error: "Template not found" }, { status: 404 });
  if (template.status !== "active") {
    return NextResponse.json({ error: "Template is archived" }, { status: 422 });
  }

  const manifest = (template.manifest ?? {}) as TemplateManifest;
  const manifestFiles = new Set((Array.isArray(manifest.pages) ? manifest.pages : []).map((p) => p.file));
  const unknown = pages.filter((p) => !manifestFiles.has(p));
  if (unknown.length > 0) {
    return NextResponse.json(
      { error: `Pages not in this template: ${unknown.join(", ")}` },
      { status: 422 }
    );
  }

  const perPageMs = await avgPerPageMs(admin, templateId, tool);
  const estimateMs = Math.round(perPageMs * pages.length + BASE_OVERHEAD_MS);

  const { data: gen, error: genErr } = await admin
    .from("template_generations")
    .insert({
      lead_id: leadId,
      template_id: templateId,
      tool,
      model,
      requested_pages: pages,
      status: "queued",
      estimate_ms: estimateMs,
      created_by: user.id,
      options: parsed.data.options,
    })
    .select("id")
    .single();
  if (genErr || !gen) {
    return NextResponse.json({ error: genErr?.message ?? "Could not create generation" }, { status: 400 });
  }

  const { error: qErr } = await admin
    .from("template_gen_queue")
    .insert({ generation_id: gen.id, enqueued_by: user.id });
  if (qErr) {
    return NextResponse.json({ error: qErr.message }, { status: 400 });
  }

  kickTemplateProcessor();
  return NextResponse.json({ id: gen.id }, { status: 201 });
}
