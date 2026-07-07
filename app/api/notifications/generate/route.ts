import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { effectiveSetting, shouldRemind } from "@/lib/notifications/logic";
import { formatDateTime } from "@/lib/leads/format";

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

    const agentIds = Array.from(new Set(leads.map((l) => l.agent_id)));

    const { data: settings } = await admin
      .from("user_notification_settings")
      .select("user_id, enabled, lead_time_minutes")
      .eq("event_key", "followup_reminder")
      .in("user_id", agentIds);

    const settingMap = new Map(
      (settings ?? []).map((s) => [s.user_id, s])
    );

    const now = new Date();
    const rows: {
      user_id: string;
      event_key: string;
      lead_id: string;
      title: string;
      body: string;
      dedup_key: string;
    }[] = [];

    for (const lead of leads) {
      const s = effectiveSetting("followup_reminder", settingMap.get(lead.agent_id));
      if (!s.enabled) continue;
      if (!shouldRemind(lead.follow_up_time, s.leadTimeMinutes, now)) continue;
      rows.push({
        user_id: lead.agent_id,
        event_key: "followup_reminder",
        lead_id: lead.id,
        title: "Follow-up due soon",
        body: `${lead.business_name} — follow up at ${formatDateTime(lead.follow_up_time)}`,
        dedup_key: `followup_reminder:${lead.id}:${new Date(lead.follow_up_time).toISOString()}`,
      });
    }

    if (rows.length) {
      await admin
        .from("notifications")
        .upsert(rows, { onConflict: "dedup_key", ignoreDuplicates: true });
    }

    return NextResponse.json({ created: rows.length });
  } catch (error) {
    return NextResponse.json({ error }, { status: 500 });
  }
}
