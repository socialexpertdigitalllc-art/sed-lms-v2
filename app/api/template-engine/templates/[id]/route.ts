import { NextResponse } from "next/server";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getUserPermissions } from "@/lib/permissions/resolver";
import type { TemplateManifest } from "@/lib/template-engine/types";

const PAGE_KINDS = [
  "home",
  "about",
  "services_hub",
  "areas_hub",
  "gallery",
  "contact",
  "service_detail",
  "area_detail",
  "other",
] as const;

const patchSchema = z.object({
  name: z.string().trim().min(1).max(120).optional(),
  status: z.enum(["active", "archived"]).optional(),
  kinds: z.record(z.string(), z.enum(PAGE_KINDS)).optional(),
});

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const perms = await getUserPermissions(user.id);
  if (!perms.has("templates.manage")) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const parsed = patchSchema.safeParse(await req.json());
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid input", issues: parsed.error.flatten() }, { status: 422 });
  }

  const admin = createAdminClient();
  const { data: template } = await admin.from("website_templates").select("*").eq("id", id).single();
  if (!template) return NextResponse.json({ error: "Template not found" }, { status: 404 });

  const updates: Record<string, unknown> = { updated_at: new Date().toISOString() };
  if (parsed.data.name) updates.name = parsed.data.name;
  if (parsed.data.status) updates.status = parsed.data.status;
  if (parsed.data.kinds) {
    const kinds = parsed.data.kinds;
    const manifest = (template.manifest ?? {}) as TemplateManifest;
    updates.manifest = {
      ...manifest,
      pages: (Array.isArray(manifest.pages) ? manifest.pages : []).map((p) =>
        kinds[p.file] ? { ...p, kind: kinds[p.file] } : p
      ),
    };
  }

  const { data: row, error } = await admin
    .from("website_templates")
    .update(updates)
    .eq("id", id)
    .select("*")
    .single();
  if (error || !row) {
    return NextResponse.json({ error: error?.message ?? "Update failed" }, { status: 400 });
  }

  await admin.from("activity_log").insert({
    user_id: user.id,
    action: "template.updated",
    entity_type: "website_template",
    entity_id: id,
    new_value: parsed.data,
  });

  return NextResponse.json({ template: row });
}
