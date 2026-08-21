import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getUserPermissions } from "@/lib/permissions/resolver";
import { notify } from "@/lib/notifications/notify";
import { catSetKey } from "@/lib/leads/categories";
import { isReadyGuardError, READY_GUARD_MESSAGE } from "@/lib/leads/errors";
import { nextStreak, isFollowUpEligible } from "@/lib/leads/followups";
import { logFollowUpSchema } from "@/lib/leads/followupSchema";
import { recordStatusChange } from "@/lib/leads/statusEvents";

export async function GET(
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
  if (!perms.has("leads.view")) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  // RLS-scoped select on the user client → only follow-ups for visible leads.
  const { data: rows, error } = await supabase
    .from("lead_follow_ups")
    .select("*")
    .eq("lead_id", id)
    .order("created_at", { ascending: false });
  if (error) return NextResponse.json({ error: error.message }, { status: 400 });

  // Resolve logger names via the admin client so display_name is not RLS-nulled
  // for follow-ups logged by users other than the viewer.
  const userIds = Array.from(
    new Set((rows ?? []).map((r) => r.user_id).filter(Boolean))
  ) as string[];
  const names = new Map<string, string | null>();
  if (userIds.length) {
    const admin = createAdminClient();
    const { data: profiles } = await admin
      .from("profiles")
      .select("id, display_name")
      .in("id", userIds);
    for (const p of profiles ?? []) names.set(p.id, p.display_name ?? null);
  }
  const followUps = (rows ?? []).map((r) => ({
    ...r,
    logger_name: r.user_id ? names.get(r.user_id) ?? null : null,
  }));

  return NextResponse.json({ followUps });
}

export async function POST(
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
  if (!perms.has("leads.followup")) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const { data: lead } = await supabase
    .from("leads")
    .select("*")
    .eq("id", id)
    .is("deleted_at", null)
    .single();
  if (!lead) return NextResponse.json({ error: "Lead not found" }, { status: 404 });
  if (!isFollowUpEligible(lead.status))
    return NextResponse.json({ error: "Follow-ups apply only to Ready or Long Term leads." }, { status: 422 });

  const parsed = logFollowUpSchema.safeParse(await req.json());
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid input", issues: parsed.error.flatten() },
      { status: 422 }
    );
  }

  const isPickup = parsed.data.fu_status === "Pickup";
  const next = parsed.data.next_follow_up_time
    ? new Date(parsed.data.next_follow_up_time).toISOString()
    : null;
  if (!next || new Date(next).getTime() <= Date.now())
    return NextResponse.json(
      { error: "A future next follow-up time is required." },
      { status: 422 }
    );
  const statusChange = isPickup ? parsed.data.status_change : null;
  if (statusChange && !perms.has(catSetKey(statusChange)))
    return NextResponse.json(
      { error: `You cannot set status "${statusChange}".` },
      { status: 403 }
    );

  const admin = createAdminClient();
  // Only meaningful when a time was actually set: "specific" describes the
  // scheduled time, so a dropped lead with no next time is never specific.
  const isSpecificTime = Boolean(parsed.data.is_specific_time) && Boolean(next);
  const insertRow = {
    lead_id: id,
    user_id: user.id,
    fu_status: parsed.data.fu_status,
    comments: isPickup ? parsed.data.comments : null,
    next_follow_up_time: next,
    status_change: statusChange,
    is_specific_time: isSpecificTime,
  };
  let { data: fu, error } = await admin.from("lead_follow_ups").insert(insertRow).select("*").single();
  if (error && /is_specific_time/i.test(error.message)) {
    // Migration 0068 not applied yet — log the follow-up rather than losing
    // it, just without the flag (same tolerance the notification settings
    // reader uses for its own late column).
    const { is_specific_time: _drop, ...legacy } = insertRow;
    ({ data: fu, error } = await admin.from("lead_follow_ups").insert(legacy).select("*").single());
  }
  if (error || !fu) return NextResponse.json({ error: error?.message ?? "Insert failed" }, { status: 400 });

  // First follow-up ever = the lead's first touch. Guarded server-side so a
  // concurrent second call cannot overwrite it.
  if (!lead.first_touch_at) {
    await admin
      .from("leads")
      .update({ first_touch_at: fu.created_at })
      .eq("id", id)
      .is("first_touch_at", null);
  }

  const leadPatch = {
    follow_up_time: next,
    last_followup_status: parsed.data.fu_status,
    no_pickup_streak: nextStreak(lead.no_pickup_streak ?? 0, parsed.data.fu_status),
    ...(statusChange ? { status: statusChange } : {}),
  };
  // The Follow-ups page filters LEADS, so the flag has to travel with the
  // schedule it describes — and be cleared by any later follow-up that
  // reschedules loosely, which this unconditional write does.
  let { error: leadUpdateError } = await admin
    .from("leads")
    .update({ ...leadPatch, follow_up_is_specific: isSpecificTime })
    .eq("id", id);
  if (leadUpdateError && /follow_up_is_specific/i.test(leadUpdateError.message)) {
    ({ error: leadUpdateError } = await admin.from("leads").update(leadPatch).eq("id", id));
  }

  if (leadUpdateError && isReadyGuardError(leadUpdateError)) {
    return NextResponse.json({ error: READY_GUARD_MESSAGE }, { status: 422 });
  }

  if (!leadUpdateError && statusChange && statusChange !== lead.status) {
    await recordStatusChange(admin, { leadId: id, from: lead.status, to: statusChange, userId: user.id });
    const nonce = new Date().toISOString();
    try {
      await notify(
        "lead_status_changed",
        { leadId: id, lead: { agent_id: lead.agent_id, closed_by: lead.closed_by }, actorId: user.id },
        {
          title: "Lead status changed",
          body: `${lead.business_name} → ${statusChange}`,
          dedupKey: `lead_status_changed:${id}:${statusChange}:${nonce}`,
          targetUrl: `/leads/${id}`,
        }
      );
    } catch {}
    if (statusChange === "Ready") {
      try {
        await notify(
          "website_ready",
          { leadId: id, lead: { agent_id: lead.agent_id, closed_by: lead.closed_by }, actorId: user.id },
          {
            title: "Website ready",
            body: `${lead.business_name}'s website is ready`,
            dedupKey: `website_ready:${id}:${nonce}`,
            targetUrl: `/leads/${id}`,
          }
        );
      } catch {}
    }
  }

  await admin.from("activity_log").insert({
    user_id: user.id,
    action: "lead.followup_logged",
    entity_type: "lead",
    entity_id: id,
    new_value: {
      fu_status: parsed.data.fu_status,
      next_follow_up_time: next,
      status_change: statusChange,
    },
  });

  return NextResponse.json({ followUp: fu }, { status: 201 });
}
