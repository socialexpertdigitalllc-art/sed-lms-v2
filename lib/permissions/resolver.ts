import { cache } from "react";
import { createClient } from "@/lib/supabase/server";
import { ttlCached, ttlInvalidate } from "@/lib/cache/ttl";
import { resolvePermissions, type OverrideRow } from "./types";

/**
 * How long a resolved permission set is reused across requests. Permissions
 * change only through the admin screens (and SED AI's permission cards), and
 * every one of those writers calls invalidateUserPermissions(), so on the
 * instance that made the change the new set is live at once; other cluster
 * workers catch up within this window.
 */
const PERMS_TTL_MS = 30_000;

/**
 * Resolve the effective permission set for a user (server-side).
 * Fetches department permissions (via the user's department memberships)
 * and user overrides, then composes them with the pure resolver.
 *
 * Two cache layers: React's request-level cache so layout, page and the API
 * routes a render fans out to share one lookup, and a short process-level TTL
 * across requests. The second one matters most: this resolver is three
 * round-trips (department_members → department_permissions → overrides) and
 * ran ~5,600 times a day on prod — one of the top database consumers, all of
 * it re-reading rows that change a few times a month.
 *
 * The returned Set is SHARED between callers — treat it as read-only.
 */
export const getUserPermissions = cache(
  async (userId: string): Promise<Set<string>> =>
    ttlCached("user-perms", userId, PERMS_TTL_MS, () => loadUserPermissions(userId)),
);

/** Drop one user's cached set, or everyone's (a department's permissions changed). */
export function invalidateUserPermissions(userId?: string): void {
  ttlInvalidate("user-perms", userId);
}

async function loadUserPermissions(userId: string): Promise<Set<string>> {
  const supabase = await createClient();

  // department permissions for every department the user belongs to
  const { data: memberships } = await supabase
    .from("department_members")
    .select("department_id")
    .eq("user_id", userId);

  const deptIds = (memberships ?? []).map((m) => m.department_id);

  let deptPermKeys: { permission_key: string }[] = [];
  if (deptIds.length > 0) {
    const { data: dp } = await supabase
      .from("department_permissions")
      .select("permission_key")
      .in("department_id", deptIds);
    deptPermKeys = dp ?? [];
  }

  const { data: overrides } = await supabase
    .from("user_permission_overrides")
    .select("permission_key, is_granted, expires_at")
    .eq("user_id", userId);

  return resolvePermissions(deptPermKeys, (overrides ?? []) as OverrideRow[]);
}
