import { NextResponse } from "next/server";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getUserPermissions } from "@/lib/permissions/resolver";
import { NOTIFICATION_EVENTS } from "@/lib/notifications/events";
import { invalidateRuleCache } from "@/lib/notifications/rules";
import type { NotificationRule } from "@/lib/notifications/types";

async function guard(): Promise<{ error: 401 } | { error: 403 } | { userId: string }> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: 401 };
  const perms = await getUserPermissions(user.id);
  if (!perms.has("admin.notifications.manage")) return { error: 403 };
  return { userId: user.id };
}

function guardError(status: 401 | 403) {
  return NextResponse.json(
    { error: status === 401 ? "Unauthorized" : "Forbidden" },
    { status }
  );
}

const bodySchema = z.object({
  enabled: z.boolean(),
  target_departments: z.array(z.enum(["sales", "management", "tech", "support", "admin"])),
  target_users: z.array(z.string().uuid()),
  target_roles: z.array(z.string()),
  delay_minutes: z.number().int().min(0),
});

export async function PUT(
  req: Request,
  { params }: { params: Promise<{ eventKey: string }> }
) {
  const auth = await guard();
  if ("error" in auth) return guardError(auth.error);
  const { eventKey } = await params;

  const event = NOTIFICATION_EVENTS.find((e) => e.key === eventKey);
  if (!event) return NextResponse.json({ error: "Unknown event" }, { status: 404 });

  const parsed = bodySchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid input", issues: parsed.error.flatten() },
      { status: 422 }
    );
  }

  // target_roles must be a subset of this event's availableRoles — a role that
  // doesn't apply to the event (e.g. "lead_closer" on a ticket event) can never
  // resolve to a recipient, so reject it up front instead of saving dead config.
  const allowedRoles = [...event.availableRoles] as string[];
  const invalidRoles = parsed.data.target_roles.filter((r) => !allowedRoles.includes(r));
  if (invalidRoles.length > 0) {
    return NextResponse.json(
      {
        error: `Invalid target_roles for "${eventKey}": ${invalidRoles.join(", ")}`,
        issues: { availableRoles: allowedRoles },
      },
      { status: 422 }
    );
  }

  const admin = createAdminClient();
  const { data, error } = await admin
    .from("notification_rules")
    .upsert(
      {
        event_key: eventKey,
        enabled: parsed.data.enabled,
        target_departments: parsed.data.target_departments,
        target_users: parsed.data.target_users,
        target_roles: parsed.data.target_roles,
        delay_minutes: parsed.data.delay_minutes,
        updated_at: new Date().toISOString(),
        updated_by: auth.userId,
      },
      { onConflict: "event_key" }
    )
    .select("*")
    .single();
  if (error || !data) {
    return NextResponse.json({ error: error?.message ?? "Update failed" }, { status: 400 });
  }
  invalidateRuleCache(eventKey);

  await admin.from("activity_log").insert({
    user_id: auth.userId,
    action: "notification.rule.updated",
    entity_type: "notification_rule",
    new_value: data,
  });

  return NextResponse.json({ rule: data as NotificationRule });
}
