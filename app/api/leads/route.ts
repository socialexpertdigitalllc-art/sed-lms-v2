import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getUserPermissions } from "@/lib/permissions/resolver";
import { createLeadSchema } from "@/lib/leads/schema";
import { catSetKey } from "@/lib/leads/categories";
import { enqueueLeadIfReady } from "@/lib/ai-tools/queue";

export async function GET() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const perms = await getUserPermissions(user.id);
  if (!perms.has("leads.view")) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const { data, error } = await supabase
    .from("leads")
    .select("*")
    .is("deleted_at", null)
    .order("created_at", { ascending: false });
  if (error) return NextResponse.json({ error: error.message }, { status: 400 });

  return NextResponse.json({ leads: data ?? [] });
}

export async function POST(req: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const perms = await getUserPermissions(user.id);
  if (!perms.has("leads.create")) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const parsed = createLeadSchema.safeParse(await req.json());
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid input", issues: parsed.error.flatten() },
      { status: 422 }
    );
  }

  // Submission controls. Without `leads.assign` the lead is auto-assigned to the
  // submitter; without `leads.set_status` it is forced to "Not Ready". These are
  // enforced here (not just hidden in the UI) so they can't be bypassed.
  const payload = { ...parsed.data, created_by: user.id };
  if (!perms.has("leads.assign")) payload.agent_id = user.id;
  if (!perms.has("leads.set_status")) {
    payload.status = "Not Ready";
  } else if (!perms.has(catSetKey(payload.status))) {
    return NextResponse.json(
      { error: `You are not allowed to create a lead with status "${payload.status}"` },
      { status: 403 }
    );
  }

  const admin = createAdminClient();
  const { data, error } = await admin
    .from("leads")
    .insert(payload)
    .select("id")
    .single();
  if (error || !data) {
    return NextResponse.json({ error: error?.message ?? "Create failed" }, { status: 400 });
  }

  await admin.from("activity_log").insert({
    user_id: user.id,
    action: "lead.created",
    entity_type: "lead",
    entity_id: data.id,
    new_value: { business_name: payload.business_name, status: payload.status },
  });

  // Fire-and-forget auto-generation (never blocks lead creation).
  await enqueueLeadIfReady({ ...payload, id: data.id }, user.id);

  return NextResponse.json({ id: data.id }, { status: 201 });
}
