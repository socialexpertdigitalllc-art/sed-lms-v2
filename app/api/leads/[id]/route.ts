import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getUserPermissions } from "@/lib/permissions/resolver";
import { notify } from "@/lib/notifications/notify";
import { updateLeadSchema } from "@/lib/leads/schema";
import { catSetKey } from "@/lib/leads/categories";

export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const perms = await getUserPermissions(user.id);

  const body = await req.json();
  const keys = Object.keys(body ?? {});
  if (keys.length === 0) {
    return NextResponse.json({ error: "Nothing to update" }, { status: 400 });
  }
  const statusOnly = keys.length === 1 && keys[0] === "status";
  const needed = statusOnly ? "leads.status_change" : "leads.edit";
  if (!perms.has(needed)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const parsed = updateLeadSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid input", issues: parsed.error.flatten() },
      { status: 422 }
    );
  }

  const admin = createAdminClient();
  const { data: before } = await admin
    .from("leads")
    .select("*")
    .eq("id", id)
    .is("deleted_at", null)
    .single();
  if (!before) return NextResponse.json({ error: "Lead not found" }, { status: 404 });

  if (
    parsed.data.status !== undefined &&
    parsed.data.status !== before.status &&
    !perms.has(catSetKey(parsed.data.status))
  ) {
    return NextResponse.json(
      { error: `You are not allowed to set status "${parsed.data.status}"` },
      { status: 403 }
    );
  }

  const { error } = await admin.from("leads").update(parsed.data).eq("id", id);
  if (error) return NextResponse.json({ error: error.message }, { status: 400 });

  const changedKeys = Object.keys(parsed.data);
  const oldValue: Record<string, unknown> = {};
  for (const k of changedKeys) oldValue[k] = (before as Record<string, unknown>)[k];

  await admin.from("activity_log").insert({
    user_id: user.id,
    action: statusOnly ? "lead.status_changed" : "lead.updated",
    entity_type: "lead",
    entity_id: id,
    old_value: oldValue,
    new_value: parsed.data,
  });

  if (parsed.data.status !== undefined && parsed.data.status !== before.status) {
    const newStatus = parsed.data.status;
    const nonce = new Date().toISOString();
    try {
      await notify(
        "lead_status_changed",
        { leadId: id, lead: { agent_id: before.agent_id, closed_by: before.closed_by }, actorId: user.id },
        {
          title: "Lead status changed",
          body: `${before.business_name} → ${newStatus}`,
          dedupKey: `lead_status_changed:${id}:${newStatus}:${nonce}`,
          targetUrl: `/leads/${id}`,
        }
      );
    } catch {}
    if (newStatus === "Ready") {
      try {
        await notify(
          "website_ready",
          { leadId: id, lead: { agent_id: before.agent_id, closed_by: before.closed_by }, actorId: user.id },
          {
            title: "Website ready",
            body: `${before.business_name}'s website is ready`,
            dedupKey: `website_ready:${id}:${nonce}`,
            targetUrl: `/leads/${id}`,
          }
        );
      } catch {}
    }
  }

  return NextResponse.json({ ok: true });
}

export async function DELETE(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const perms = await getUserPermissions(user.id);
  if (!perms.has("leads.delete")) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const admin = createAdminClient();
  const { error } = await admin
    .from("leads")
    .update({ deleted_at: new Date().toISOString() })
    .eq("id", id);
  if (error) return NextResponse.json({ error: error.message }, { status: 400 });

  await admin.from("activity_log").insert({
    user_id: user.id,
    action: "lead.deleted",
    entity_type: "lead",
    entity_id: id,
  });

  return NextResponse.json({ ok: true });
}
