import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { reminderAllowed, shouldRemind } from "@/lib/notifications/logic";
import { getRule } from "@/lib/notifications/rules";

type ReminderSetting = { enabled: boolean; statuses?: string[] | null };

/**
 * Per-user reminder settings for the agents in play. Tolerates the `statuses`
 * column not existing yet (migration 0066): falls back to enabled-only rows.
 */
async function loadReminderSettings(
  admin: ReturnType<typeof createAdminClient>,
  userIds: string[],
): Promise<Map<string, ReminderSetting>> {
  const map = new Map<string, ReminderSetting>();
  if (!userIds.length) return map;
  let { data, error } = await admin
    .from("user_notification_settings")
    .select("user_id, enabled, statuses")
    .eq("event_key", "followup_reminder")
    .in("user_id", userIds);
  if (error && /statuses/i.test(error.message)) {
    const fallback = await admin
      .from("user_notification_settings")
      .select("user_id, enabled")
      .eq("event_key", "followup_reminder")
      .in("user_id", userIds);
    data = (fallback.data ?? []) as unknown as typeof data;
  }
  for (const row of data ?? []) {
    map.set(row.user_id as string, {
      enabled: Boolean(row.enabled),
      statuses: (row as { statuses?: string[] | null }).statuses ?? null,
    });
  }
  return map;
}

export const runtime = "nodejs";

export async function POST(req: Request) {
  const expected = process.env.WGE_PROCESSOR_SECRET;
  const secret = req.headers.get("x-wge-secret");
  // Fail closed: if the secret isn't configured, reject everything (never
  // process unauthenticated, which would otherwise pass when expected is undefined).
  if (!expected || !secret || secret !== expected) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const rule = await getRule("followup_reminder");
    if (!rule || !rule.enabled) {
      return NextResponse.json({ created: 0 });
    }

    const admin = createAdminClient();

    const { data: leads } = await admin
      .from("leads")
      .select("id, business_name, agent_id, status, follow_up_time")
      .is("deleted_at", null)
      .not("follow_up_time", "is", null)
      .not("agent_id", "is", null)
      .in("status", ["Ready", "Long Term"]);

    if (!leads || leads.length === 0) {
      return NextResponse.json({ created: 0 });
    }

    const agentIds = Array.from(new Set(leads.map((l) => l.agent_id as string)));
    const settings = await loadReminderSettings(admin, agentIds);

    const now = new Date();
    const rows: {
      user_id: string;
      event_key: string;
      lead_id: string;
      title: string;
      body: string;
      dedup_key: string;
      target_url: string;
      bell: string;
      deliver_after: string;
    }[] = [];

    for (const lead of leads) {
      if (!shouldRemind(lead.follow_up_time, rule.delay_minutes, now)) continue;
      if (!reminderAllowed(lead.status, settings.get(lead.agent_id))) continue;
      rows.push({
        user_id: lead.agent_id,
        event_key: "followup_reminder",
        lead_id: lead.id,
        title: "Follow-up due soon",
        body: `${lead.business_name} — follow up soon`,
        dedup_key: `followup_reminder:${lead.id}:${lead.follow_up_time}:${lead.agent_id}`,
        target_url: `/leads/${lead.id}`,
        bell: "general",
        deliver_after: now.toISOString(),
      });
    }

    if (rows.length) {
      await admin
        .from("notifications")
        .upsert(rows, { onConflict: "dedup_key", ignoreDuplicates: true });
    }

    // Housekeeping piggybacked on the poller: a notification nobody opened in
    // 30 days is noise, not news — auto-mark it read so bells stay honest
    // signals. Cheap: the (user_id, read_at, created_at) index covers it.
    try {
      const cutoff = new Date(now.getTime() - 30 * 86_400_000).toISOString();
      await admin
        .from("notifications")
        .update({ read_at: now.toISOString() })
        .is("read_at", null)
        .lt("created_at", cutoff);
    } catch {
      /* best-effort */
    }

    return NextResponse.json({ created: rows.length });
  } catch (error) {
    return NextResponse.json({ error }, { status: 500 });
  }
}
