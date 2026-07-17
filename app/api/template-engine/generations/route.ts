import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getUserPermissions } from "@/lib/permissions/resolver";

export async function GET() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const perms = await getUserPermissions(user.id);
  if (!perms.has("templates.generate") && !perms.has("templates.manage")) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const admin = createAdminClient();
  // Slim list projection: heavy jsonb (brief, content_model, image_slots, gate_results) stays on the detail route; keep in sync with RunsList/board rendered fields.
  const { data, error } = await admin
    .from("template_generations")
    .select(
      "id, lead_id, template_id, tool, model, requested_pages, status, current_step, steps, estimate_ms, total_ms, tokens_used, cost_usd, pages_built, images_used, ops_applied, ops_missed, site_slug, zip_path, deployed_url, error, created_at, updated_at"
    )
    .order("created_at", { ascending: false })
    .limit(50);
  if (error) return NextResponse.json({ error: error.message }, { status: 400 });

  const rows = data ?? [];
  const templateIds = [...new Set(rows.map((g) => g.template_id))];
  const leadIds = [...new Set(rows.map((g) => g.lead_id))];
  const [templates, leads] = await Promise.all([
    templateIds.length
      ? admin.from("website_templates").select("id, name").in("id", templateIds)
      : Promise.resolve({ data: [] as { id: string; name: string }[] }),
    leadIds.length
      ? admin.from("leads").select("id, business_name").in("id", leadIds)
      : Promise.resolve({ data: [] as { id: string; business_name: string }[] }),
  ]);
  const templateName = new Map((templates.data ?? []).map((t) => [t.id, t.name]));
  const businessName = new Map((leads.data ?? []).map((l) => [l.id, l.business_name]));

  return NextResponse.json({
    generations: rows.map((g) => ({
      ...g,
      template_name: templateName.get(g.template_id) ?? null,
      business_name: businessName.get(g.lead_id) ?? null,
    })),
  });
}
