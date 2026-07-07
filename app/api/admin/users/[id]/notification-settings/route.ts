import { NextResponse } from "next/server";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getUserPermissions } from "@/lib/permissions/resolver";
import { NOTIFICATION_EVENTS } from "@/lib/notifications/events";

const EVENT_KEYS = NOTIFICATION_EVENTS.map((e) => e.key) as [string, ...string[]];

const bodySchema = z.object({
  settings: z.array(
    z.object({
      event_key: z.enum(EVENT_KEYS),
      enabled: z.boolean(),
      lead_time_minutes: z.number().int().min(1),
    })
  ),
});

async function requireAdmin() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: NextResponse.json({ error: "Unauthorized" }, { status: 401 }) };
  const perms = await getUserPermissions(user.id);
  if (!perms.has("admin.permissions.manage")) {
    return { error: NextResponse.json({ error: "Forbidden" }, { status: 403 }) };
  }
  return { user };
}

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const gate = await requireAdmin();
  if (gate.error) return gate.error;

  const admin = createAdminClient();
  const { data: settings } = await admin
    .from("user_notification_settings")
    .select("event_key, enabled, lead_time_minutes")
    .eq("user_id", id);

  return NextResponse.json({ settings: settings ?? [] });
}

export async function PUT(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const gate = await requireAdmin();
  if (gate.error) return gate.error;

  const parsed = bodySchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid settings" }, { status: 422 });
  }

  const admin = createAdminClient();
  for (const s of parsed.data.settings) {
    await admin.from("user_notification_settings").upsert(
      {
        user_id: id,
        event_key: s.event_key,
        enabled: s.enabled,
        lead_time_minutes: s.lead_time_minutes,
      },
      { onConflict: "user_id,event_key" }
    );
  }

  await admin.from("activity_log").insert({
    user_id: gate.user.id,
    action: "notification.settings.updated",
    entity_type: "user",
    entity_id: id,
  });

  return NextResponse.json({ ok: true });
}
