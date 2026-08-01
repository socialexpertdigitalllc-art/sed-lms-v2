import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { FOLLOWUP_STATUSES } from "@/lib/leads/followups";

export const runtime = "nodejs";

const EVENT_KEY = "followup_reminder";

/**
 * GET/PUT the caller's own follow-up reminder preferences
 * (user_notification_settings, revived by migration 0066).
 * statuses null/empty = remind for every eligible status.
 */
export async function GET() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const admin = createAdminClient();
  let { data, error } = await admin
    .from("user_notification_settings")
    .select("enabled, statuses")
    .eq("user_id", user.id)
    .eq("event_key", EVENT_KEY)
    .maybeSingle();
  if (error && /statuses/i.test(error.message)) {
    ({ data, error } = await admin
      .from("user_notification_settings")
      .select("enabled")
      .eq("user_id", user.id)
      .eq("event_key", EVENT_KEY)
      .maybeSingle());
  }
  if (error) return NextResponse.json({ error: error.message }, { status: 400 });

  return NextResponse.json({
    enabled: data?.enabled ?? true,
    statuses: (data as { statuses?: string[] | null } | null)?.statuses ?? [],
    availableStatuses: FOLLOWUP_STATUSES,
  });
}

export async function PUT(req: Request) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = (await req.json().catch(() => ({}))) as { enabled?: unknown; statuses?: unknown };
  const enabled = typeof body.enabled === "boolean" ? body.enabled : true;
  const valid = new Set<string>(FOLLOWUP_STATUSES);
  const statuses = Array.isArray(body.statuses)
    ? body.statuses.filter((s): s is string => typeof s === "string" && valid.has(s))
    : [];

  const admin = createAdminClient();
  const row = { user_id: user.id, event_key: EVENT_KEY, enabled, statuses: statuses.length ? statuses : null };
  let { error } = await admin
    .from("user_notification_settings")
    .upsert(row, { onConflict: "user_id,event_key" });
  if (error && /statuses/i.test(error.message)) {
    ({ error } = await admin
      .from("user_notification_settings")
      .upsert({ user_id: user.id, event_key: EVENT_KEY, enabled }, { onConflict: "user_id,event_key" }));
    if (!error) {
      return NextResponse.json({
        ok: true,
        warning: "Status selection needs DB migration 0066 — only the on/off switch was saved.",
      });
    }
  }
  if (error) return NextResponse.json({ error: error.message }, { status: 400 });
  return NextResponse.json({ ok: true });
}
