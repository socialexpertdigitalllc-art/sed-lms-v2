import { createAdminClient } from "@/lib/supabase/admin";
import { ttlCached, ttlInvalidate } from "@/lib/cache/ttl";
import type { NotificationRule } from "@/lib/notifications/types";

/**
 * Rules are read on every notification-producing hot path (including the
 * minutes-cadence generate poller) but change only when an admin edits them,
 * so reads are TTL-cached per process. The admin rules route calls
 * invalidateRuleCache on write, so same-instance edits apply immediately;
 * other instances converge within the TTL.
 */
const RULES_TTL_MS = 60_000;

export async function getRule(eventKey: string): Promise<NotificationRule | null> {
  return ttlCached("notification-rules", eventKey, RULES_TTL_MS, async () => {
    const admin = createAdminClient();
    const { data } = await admin.from("notification_rules").select("*").eq("event_key", eventKey).maybeSingle();
    return (data as NotificationRule | null) ?? null;
  });
}

export function invalidateRuleCache(eventKey?: string): void {
  ttlInvalidate("notification-rules", eventKey);
}

/** Admin screen listing — uncached: rare, and it must show fresh rows. */
export async function getAllRules(): Promise<NotificationRule[]> {
  const admin = createAdminClient();
  const { data } = await admin.from("notification_rules").select("*");
  return (data ?? []) as NotificationRule[];
}
