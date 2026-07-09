import { createAdminClient } from "@/lib/supabase/admin";
import type { NotificationRule } from "@/lib/notifications/types";

export async function getRule(eventKey: string): Promise<NotificationRule | null> {
  const admin = createAdminClient();
  const { data } = await admin.from("notification_rules").select("*").eq("event_key", eventKey).maybeSingle();
  return (data as NotificationRule | null) ?? null;
}

export async function getAllRules(): Promise<NotificationRule[]> {
  const admin = createAdminClient();
  const { data } = await admin.from("notification_rules").select("*");
  return (data ?? []) as NotificationRule[];
}
