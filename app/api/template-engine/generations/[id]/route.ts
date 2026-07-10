import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getUserPermissions } from "@/lib/permissions/resolver";

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
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
  const { data: gen } = await admin.from("template_generations").select("*").eq("id", id).maybeSingle();
  if (!gen) return NextResponse.json({ error: "Generation not found" }, { status: 404 });

  const [{ data: template }, { data: lead }] = await Promise.all([
    admin.from("website_templates").select("id, name").eq("id", gen.template_id).maybeSingle(),
    admin.from("leads").select("id, business_name").eq("id", gen.lead_id).maybeSingle(),
  ]);

  return NextResponse.json({
    generation: {
      ...gen,
      template_name: template?.name ?? null,
      business_name: lead?.business_name ?? null,
    },
  });
}
