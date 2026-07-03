import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getUserPermissions } from "@/lib/permissions/resolver";
import { createPreLeadSchema } from "@/lib/preleads/schema";

export async function GET() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const perms = await getUserPermissions(user.id);
  if (!perms.has("pre_leads.view")) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  // RLS scopes this to the user's own pre-leads (or all, for admins).
  const { data, error } = await supabase
    .from("pre_leads")
    .select("*")
    .is("deleted_at", null)
    .order("created_at", { ascending: false });
  if (error) return NextResponse.json({ error: error.message }, { status: 400 });

  return NextResponse.json({ preLeads: data ?? [] });
}

export async function POST(req: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const perms = await getUserPermissions(user.id);
  if (!perms.has("pre_leads.create")) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const parsed = createPreLeadSchema.safeParse(await req.json());
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid input", issues: parsed.error.flatten() },
      { status: 422 }
    );
  }

  const admin = createAdminClient();
  const { data, error } = await admin
    .from("pre_leads")
    .insert({ ...parsed.data, agent_id: user.id, last_updated_by: user.id })
    .select("id")
    .single();
  if (error || !data) {
    return NextResponse.json({ error: error?.message ?? "Create failed" }, { status: 400 });
  }

  await admin.from("activity_log").insert({
    user_id: user.id,
    action: "pre_lead.created",
    entity_type: "pre_lead",
    entity_id: data.id,
    new_value: { business_name: parsed.data.business_name, lead_category: parsed.data.lead_category },
  });

  return NextResponse.json({ id: data.id }, { status: 201 });
}
