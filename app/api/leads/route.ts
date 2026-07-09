import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getUserPermissions } from "@/lib/permissions/resolver";
import { notify } from "@/lib/notifications/notify";
import { createLeadSchema } from "@/lib/leads/schema";
import { catSetKey } from "@/lib/leads/categories";
import { isReadyGuardError, READY_GUARD_MESSAGE } from "@/lib/leads/errors";
import { enqueueLeadIfReady } from "@/lib/ai-tools/queue";
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

  const body = await req.json();
  const parsed = createLeadSchema.safeParse(body);
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

  // Authoritative duplicate re-check — the client-side check is advisory only and
  // can be bypassed, so collisions are re-verified here before the insert.
  const override = body?.override === true && perms.has("leads.duplicate.override");
  if (!override) {
    const { data: existing } = await admin
      .from("leads")
      .select("id, business_name, business_phone, business_email, agent_id")
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
      phone: l.business_phone,
      email: l.business_email,
      owner: l.agent_id,
      ownerName: l.agent_id ? nameById.get(l.agent_id) ?? null : null,
    }));

    const collisions = findCollisions(
      {
        business_name: parsed.data.business_name,
        phone: asStr(parsed.data.business_phone),
        email: parsed.data.no_email ? undefined : asStr(parsed.data.business_email),
      },
      rows,
      user.id
    );
    if (collisions.length) {
      return NextResponse.json({ error: "duplicate", collisions }, { status: 409 });
    }
  }

  const { data, error } = await admin
    .from("leads")
    .insert(payload)
    .select("id, business_name, agent_id")
    .single();
  if (error || !data) {
    if (isReadyGuardError(error)) {
      return NextResponse.json({ error: READY_GUARD_MESSAGE }, { status: 422 });
    }
    return NextResponse.json({ error: error?.message ?? "Create failed" }, { status: 400 });
  }

  await admin.from("activity_log").insert({
    user_id: user.id,
    action: "lead.created",
    entity_type: "lead",
    entity_id: data.id,
    new_value: { business_name: payload.business_name, status: payload.status },
  });

  try {
    await notify(
      "lead_submitted",
      { leadId: data.id, lead: { agent_id: data.agent_id ?? null, closed_by: null }, actorId: user.id },
      {
        title: "New lead submitted",
        body: data.business_name,
        dedupKey: `lead_submitted:${data.id}`,
        targetUrl: `/leads/${data.id}`,
      }
    );
  } catch {}

  // Fire-and-forget auto-generation (never blocks lead creation).
  await enqueueLeadIfReady({ ...payload, id: data.id }, user.id);

  return NextResponse.json({ id: data.id }, { status: 201 });
}
