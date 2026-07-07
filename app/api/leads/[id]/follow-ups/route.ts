import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getUserPermissions } from "@/lib/permissions/resolver";
import { catSetKey } from "@/lib/leads/categories";
import { nextStreak } from "@/lib/leads/followups";
import { logFollowUpSchema } from "@/lib/leads/followupSchema";

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
  if (
    parsed.data.fu_status === "No Pickup" &&
    (!next || new Date(next).getTime() <= Date.now())
  )
    return NextResponse.json(
      { error: "A future next follow-up time is required." },
      { status: 422 }
    );
  if (isPickup && next && new Date(next).getTime() <= Date.now())
    return NextResponse.json(
      { error: "Next follow-up must be in the future." },
      { status: 422 }
    );
  const statusChange = isPickup ? parsed.data.status_change : null;
  if (statusChange && !perms.has(catSetKey(statusChange)))
    return NextResponse.json(
      { error: `You cannot set status "${statusChange}".` },
      { status: 403 }
    );

  const admin = createAdminClient();
  const { data: fu, error } = await admin
    .from("lead_follow_ups")
    .insert({
      lead_id: id,
      user_id: user.id,
      fu_status: parsed.data.fu_status,
      comments: isPickup ? parsed.data.comments : null,
      next_follow_up_time: next,
      status_change: statusChange,
    })
    .select("*")
    .single();
  if (error) return NextResponse.json({ error: error.message }, { status: 400 });

  await admin
    .from("leads")
    .update({
      follow_up_time: next,
      last_followup_status: parsed.data.fu_status,
      no_pickup_streak: nextStreak(lead.no_pickup_streak ?? 0, parsed.data.fu_status),
      ...(statusChange ? { status: statusChange } : {}),
    })
    .eq("id", id);

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
