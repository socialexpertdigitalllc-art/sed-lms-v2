import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getUserPermissions } from "@/lib/permissions/resolver";
import { notify } from "@/lib/notifications/notify";
import { createPreLeadSchema } from "@/lib/preleads/schema";
import { findCollisions, type DupRow } from "@/lib/leads/duplicate";

/** The schema's optional-string fields type-check as `unknown` (zod preprocess quirk); narrow defensively. */
const asStr = (v: unknown): string | undefined => (typeof v === "string" ? v : undefined);

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

  const body = await req.json();
  const parsed = createPreLeadSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid input", issues: parsed.error.flatten() },
      { status: 422 }
    );
  }

  const admin = createAdminClient();

  // Authoritative duplicate re-check — the client-side check is advisory only and
  // can be bypassed, so collisions are re-verified here before the insert.
  const override = body?.override === true && perms.has("leads.duplicate.override");
  if (!override) {
    const { data: existing } = await admin
      .from("pre_leads")
      .select("id, business_name, phone_number, email, agent_id")
      .is("deleted_at", null);

    const ownerIds = [...new Set((existing ?? []).map((l) => l.agent_id).filter(Boolean))];
    const { data: profs } = await admin
      .from("profiles")
      .select("id, display_name")
      .in("id", ownerIds.length ? ownerIds : ["00000000-0000-0000-0000-000000000000"]);
    const nameById = new Map((profs ?? []).map((p) => [p.id, p.display_name]));

    const rows: DupRow[] = (existing ?? []).map((l) => ({
      id: l.id,
      business_name: l.business_name,
      phone: l.phone_number,
      email: l.email,
      owner: l.agent_id,
      ownerName: l.agent_id ? nameById.get(l.agent_id) ?? null : null,
    }));

    const collisions = findCollisions(
      {
        business_name: parsed.data.business_name,
        phone: asStr(parsed.data.phone_number),
        email: asStr(parsed.data.email),
      },
      rows,
      user.id
    );
    if (collisions.length) {
      return NextResponse.json({ error: "duplicate", collisions }, { status: 409 });
    }
  }

  const { data, error } = await admin
    .from("pre_leads")
    .insert({ ...parsed.data, agent_id: user.id, last_updated_by: user.id })
    .select("id, business_name")
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

  try {
    await notify(
      "prelead_submitted",
      { leadId: null, actorId: user.id },
      {
        title: "New pre-lead submitted",
        body: data.business_name,
        dedupKey: `prelead_submitted:${data.id}`,
        targetUrl: `/pre-leads/${data.id}`,
      }
    );
  } catch {}

  return NextResponse.json({ id: data.id }, { status: 201 });
}
