import type { SupabaseClient } from "@supabase/supabase-js";
import { isAdminMember } from "@/lib/permissions/isAdminMember";
import { getUserPermissions } from "@/lib/permissions/resolver";
import { resolvePermissions, type OverrideRow } from "@/lib/permissions/types";

/**
 * Who holds a permission, and a person's own permissions without their
 * session — for approvals (who can approve, and does the approver's own
 * access cover the change) and for scheduled work. SERVER ONLY.
 */

/** Active people who currently hold `key` (department grants and personal overrides, expiry respected). */
export async function usersWithPermission(admin: SupabaseClient, key: string): Promise<string[]> {
  const [{ data: grants }, { data: overrides }] = await Promise.all([
    admin.from("department_permissions").select("department_id").eq("permission_key", key),
    admin.from("user_permission_overrides").select("user_id, is_granted, expires_at").eq("permission_key", key),
  ]);
  const deptIds = (grants ?? []).map((g) => g.department_id as string);
  const members = deptIds.length ? ((await admin.from("department_members").select("user_id").in("department_id", deptIds)).data ?? []) : [];
  const now = Date.now();
  const ids = new Set(members.map((m) => m.user_id as string));
  for (const o of overrides ?? []) {
    if (o.expires_at && Date.parse(o.expires_at as string) <= now) continue;
    if (o.is_granted) ids.add(o.user_id as string);
    else ids.delete(o.user_id as string);
  }
  if (!ids.size) return [];
  const { data: active } = await admin.from("profiles").select("id").in("id", [...ids]).eq("is_active", true);
  return (active ?? []).map((p) => p.id as string);
}

/** Someone's effective permissions, read with the service role (no session needed). */
export async function permissionsOf(admin: SupabaseClient, userId: string): Promise<Set<string>> {
  const { data: memberships } = await admin.from("department_members").select("department_id").eq("user_id", userId);
  const deptIds = (memberships ?? []).map((m) => m.department_id as string);
  const dept = deptIds.length ? ((await admin.from("department_permissions").select("permission_key").in("department_id", deptIds)).data ?? []) : [];
  const { data: overrides } = await admin.from("user_permission_overrides").select("permission_key, is_granted, expires_at").eq("user_id", userId);
  return resolvePermissions(dept as { permission_key: string }[], (overrides ?? []) as OverrideRow[]);
}

/** The signed-in person's permissions (their session), falling back to a service-role read. */
export async function sessionPermissions(admin: SupabaseClient, userId: string): Promise<Set<string>> {
  try {
    return await getUserPermissions(userId);
  } catch {
    return permissionsOf(admin, userId);
  }
}

export { isAdminMember };

/** A bell notification straight to one person (no notification rule involved). */
export async function bell(
  admin: SupabaseClient,
  userId: string,
  n: { title: string; body: string; dedupKey: string; targetUrl?: string | null; leadId?: string | null; eventKey?: string },
): Promise<void> {
  const row = {
    user_id: userId,
    event_key: n.eventKey ?? "assistant_action",
    lead_id: n.leadId ?? null,
    title: n.title.slice(0, 200),
    body: n.body.slice(0, 1000),
    dedup_key: n.dedupKey,
    target_url: n.targetUrl ?? null,
    bell: "general",
    deliver_after: new Date().toISOString(),
  };
  const { error } = await admin.from("notifications").upsert(row, { onConflict: "dedup_key", ignoreDuplicates: true });
  if (error) console.warn("[assistant] bell failed:", error.message);
}
