import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { isAdminMember } from "@/lib/permissions/isAdminMember";
import { getAppSettings } from "@/lib/settings/appSettings";
import { loadStatusHistory } from "@/lib/leads/statusHistoryLoad";
import { checkCorrection, lifecycleColumnPatch, STATUS_DATE_CORRECTED } from "@/lib/leads/statusHistory";

/**
 * An admin corrects WHEN a status change happened — a lead closed on Oct 30
 * but marked Closed on Nov 3 belongs in October's numbers. Moves the ledger
 * event, re-mirrors leads.closed_at / dropped_at when it is the event the
 * lead's current status came from (that is what reports count by), and logs
 * the old and new dates so the correction is visible on the lead.
 */
export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ id: string; eventId: string }> }
) {
  const { id, eventId } = await params;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const admin = createAdminClient();
  // Same definition as the other administrative lead fields (Agent, Closed
  // by, Rating): members of the Admin department only.
  if (!(await isAdminMember(admin, user.id))) {
    return NextResponse.json({ error: "Only an admin can change when a status changed." }, { status: 403 });
  }

  const body = (await req.json().catch(() => null)) as { changed_at?: unknown } | null;
  const raw = typeof body?.changed_at === "string" ? body.changed_at : "";
  const at = new Date(raw);
  if (!raw || Number.isNaN(at.getTime())) {
    return NextResponse.json({ error: "Pick a valid date and time." }, { status: 422 });
  }
  const nextIso = at.toISOString();

  const { data: lead } = await admin
    .from("leads")
    .select("id, status, created_at")
    .eq("id", id)
    .is("deleted_at", null)
    .maybeSingle();
  if (!lead) return NextResponse.json({ error: "Lead not found" }, { status: 404 });

  const history = await loadStatusHistory(admin, lead as { id: string; status: string; created_at: string });
  const event = history.events.find((e) => e.id === eventId);
  if (!event) return NextResponse.json({ error: "That status change no longer exists — refresh the page." }, { status: 404 });
  if (new Date(event.changed_at).getTime() === at.getTime()) return NextResponse.json({ ok: true, history });

  const { work_timezone } = await getAppSettings();
  const fmt = (iso: string) =>
    new Date(iso).toLocaleString("en-US", {
      timeZone: work_timezone,
      month: "short",
      day: "numeric",
      year: "numeric",
      hour: "numeric",
      minute: "2-digit",
      timeZoneName: "short",
    });
  const check = checkCorrection(history, eventId, nextIso, new Date(), fmt);
  if (!check.ok) return NextResponse.json({ error: check.message }, { status: 422 });

  // Reports count by leads.closed_at / dropped_at, so that column moves FIRST:
  // if the ledger write below then fails, the numbers are already right and
  // saving again (the event still has its old date) redoes both.
  const patch = lifecycleColumnPatch(history, eventId, nextIso);
  if (patch) {
    const { error: patchError } = await admin.from("leads").update(patch).eq("id", id);
    if (patchError) return NextResponse.json({ error: patchError.message }, { status: 400 });
  }

  const { error } = await admin
    .from("lead_status_events")
    .update({ changed_at: nextIso })
    .eq("id", eventId)
    .eq("lead_id", id);
  if (error) return NextResponse.json({ error: error.message }, { status: 400 });

  await admin.from("activity_log").insert({
    user_id: user.id,
    action: STATUS_DATE_CORRECTED,
    entity_type: "lead",
    entity_id: id,
    old_value: { event_id: eventId, to_status: event.to_status, changed_at: event.changed_at },
    new_value: { event_id: eventId, to_status: event.to_status, changed_at: nextIso },
  });

  return NextResponse.json({ ok: true, history: await loadStatusHistory(admin, lead as { id: string; status: string; created_at: string }) });
}
