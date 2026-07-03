import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getUserPermissions } from "@/lib/permissions/resolver";
import { updatePreLeadSchema } from "@/lib/preleads/schema";

const FOLLOWUP_KEYS = new Set(["status", "lead_category", "follow_up_time", "reason"]);

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
  // `reason` is captured into comments, not a column.
  const { reason, ...rest } = body ?? {};
  const keys = Object.keys(body ?? {});
  if (keys.length === 0) return NextResponse.json({ error: "Nothing to update" }, { status: 400 });

  const isFollowUp = keys.every((k) => FOLLOWUP_KEYS.has(k));
  const needed = isFollowUp ? "pre_leads.followup" : "pre_leads.edit";
  if (!perms.has(needed)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const parsed = updatePreLeadSchema.safeParse(rest);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid input", issues: parsed.error.flatten() },
      { status: 422 }
    );
  }

  const update: Record<string, unknown> = { ...parsed.data, last_updated_by: user.id };
  if (typeof reason === "string" && reason.trim()) {
    update.comments = reason.trim();
  }

  const admin = createAdminClient();
  const { error } = await admin.from("pre_leads").update(update).eq("id", id);
  if (error) return NextResponse.json({ error: error.message }, { status: 400 });

  await admin.from("activity_log").insert({
    user_id: user.id,
    action: isFollowUp ? "pre_lead.followup" : "pre_lead.updated",
    entity_type: "pre_lead",
    entity_id: id,
    new_value: update,
  });

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
  if (!perms.has("pre_leads.delete")) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const admin = createAdminClient();
  const { error } = await admin
    .from("pre_leads")
    .update({ deleted_at: new Date().toISOString() })
    .eq("id", id);
  if (error) return NextResponse.json({ error: error.message }, { status: 400 });

  await admin.from("activity_log").insert({
    user_id: user.id,
    action: "pre_lead.deleted",
    entity_type: "pre_lead",
    entity_id: id,
  });

  return NextResponse.json({ ok: true });
}
