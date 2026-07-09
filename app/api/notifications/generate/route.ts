import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { shouldRemind } from "@/lib/notifications/logic";
import { getRule } from "@/lib/notifications/rules";

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

    return NextResponse.json({ created: rows.length });
  } catch (error) {
    return NextResponse.json({ error }, { status: 500 });
  }
}
