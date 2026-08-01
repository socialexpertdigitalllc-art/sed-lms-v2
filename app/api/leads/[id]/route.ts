import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getUserPermissions } from "@/lib/permissions/resolver";
import { notify } from "@/lib/notifications/notify";
import { updateLeadSchema } from "@/lib/leads/schema";
import { catSetKey } from "@/lib/leads/categories";
import { isAllowedClosedBy, CLOSED_BY_MESSAGE } from "@/lib/leads/closedBy";
import { isReadyGuardError, READY_GUARD_MESSAGE } from "@/lib/leads/errors";
import { cancelGenerationsForLeads } from "@/lib/template-engine/forceResolve";
import { recordStatusChange } from "@/lib/leads/statusEvents";

/** True when the user belongs to the Sales department (slug "sales"). */
async function isSalesMember(
  admin: ReturnType<typeof createAdminClient>,
  userId: string
): Promise<boolean> {
  const { data: dept } = await admin
    .from("departments")
    .select("id")
    .eq("slug", "sales")
    .single();
  if (!dept) return false;
  const { data: membership } = await admin
    .from("department_members")
    .select("user_id")
    .eq("department_id", dept.id)
    .eq("user_id", userId)
    .maybeSingle();
  return !!membership;
}

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
  const admin = createAdminClient();

  const body = await req.json();
  const keys = Object.keys(body ?? {});
  if (keys.length === 0) {
    return NextResponse.json({ error: "Nothing to update" }, { status: 400 });
  }
  const statusOnly =
    keys.includes("status") &&
    keys.every((k) => k === "status" || k === "website_link");
  const needed = statusOnly ? "leads.status_change" : "leads.edit";
  const closedByOnly = keys.length === 1 && keys[0] === "closed_by";
  if (!perms.has(needed)) {
    // A Sales-department member may set "Closed by" without leads.edit.
    if (!(closedByOnly && (await isSalesMember(admin, user.id)))) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }
  }

  const parsed = updateLeadSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid input", issues: parsed.error.flatten() },
      { status: 422 }
    );
  }

  const { data: before } = await admin
    .from("leads")
    .select("*")
    .eq("id", id)
    .is("deleted_at", null)
    .single();
  if (!before) return NextResponse.json({ error: "Lead not found" }, { status: 404 });

  // Ownership scope (defense-in-depth mirror of the leads read policy):
  // without leads.view_all a user may only touch their own leads. The Sales
  // closed-by path stays intact — it applies to the member's own leads.
  if (!perms.has("leads.view_all") && before.agent_id !== user.id) {
    return NextResponse.json({ error: "You can only modify your own leads." }, { status: 403 });
  }

  // Reassignment is sensitive and has its own permission — leads.edit alone
  // must not be able to move a lead between agents.
  if (
    parsed.data.agent_id !== undefined &&
    parsed.data.agent_id !== before.agent_id &&
    !perms.has("leads.assign")
  ) {
    return NextResponse.json(
      { error: "Reassigning leads requires the assign permission." },
      { status: 403 }
    );
  }

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

  if (
    parsed.data.closed_by !== undefined &&
    parsed.data.closed_by !== before.closed_by &&
    !(await isAllowedClosedBy(admin, user.id, parsed.data.closed_by))
  ) {
    return NextResponse.json({ error: CLOSED_BY_MESSAGE }, { status: 422 });
  }

  const { error } = await admin.from("leads").update(parsed.data).eq("id", id);
  if (error) {
    if (isReadyGuardError(error)) {
      return NextResponse.json({ error: READY_GUARD_MESSAGE }, { status: 422 });
    }
    return NextResponse.json({ error: error.message }, { status: 400 });
  }

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
    await recordStatusChange(admin, { leadId: id, from: before.status, to: parsed.data.status, userId: user.id });
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
            websiteUrl: parsed.data.website_link ?? before.website_link ?? null,
          }
        );
      } catch {}
    }
  }

  const newLink = parsed.data.website_link;
  if (typeof newLink === "string" && newLink.trim() && newLink !== before.website_link) {
    const nonce = new Date().toISOString();
    try {
      await notify(
        "website_link_added",
        { leadId: id, lead: { agent_id: before.agent_id, closed_by: before.closed_by }, actorId: user.id },
        {
          title: "Website live",
          body: `${before.business_name}'s website is live: ${newLink}`,
          dedupKey: `website_link_added:${id}:${nonce}`,
          targetUrl: `/leads/${id}`,
          websiteUrl: newLink,
        }
      );
    } catch {}
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

  // Ownership scope (defense-in-depth mirror of the leads read policy):
  // without leads.view_all a user may only delete their own leads.
  const { data: before } = await admin
    .from("leads")
    .select("agent_id")
    .eq("id", id)
    .is("deleted_at", null)
    .single();
  if (!before) return NextResponse.json({ error: "Lead not found" }, { status: 404 });
  if (!perms.has("leads.view_all") && before.agent_id !== user.id) {
    return NextResponse.json({ error: "You can only modify your own leads." }, { status: 403 });
  }

  const { error } = await admin
    .from("leads")
    .update({ deleted_at: new Date().toISOString() })
    .eq("id", id);
  if (error) return NextResponse.json({ error: error.message }, { status: 400 });

  // A soft delete leaves `template_generations` untouched, so an in-flight build
  // for this lead would keep running (and keep blocking the single-flight queue)
  // for a lead nobody can open any more — and /pause and /cancel both 404 once
  // the lead is soft-deleted, so it could not even be stopped by hand. Stop them
  // here. Non-fatal by construction: the helper swallows its own failures, and
  // the lead is deleted either way.
  const stopped = await cancelGenerationsForLeads(admin, [id]);
  if (stopped > 0) console.info(`[leads] stopped ${stopped} in-flight generation(s) for deleted lead ${id}`);

  await admin.from("activity_log").insert({
    user_id: user.id,
    action: "lead.deleted",
    entity_type: "lead",
    entity_id: id,
  });

  return NextResponse.json({ ok: true });
}
