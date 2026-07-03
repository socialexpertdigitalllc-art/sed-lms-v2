import { createClient } from "@/lib/supabase/server";
import { resolvePermissions, type OverrideRow } from "./types";

/**
 * Resolve the effective permission set for a user (server-side).
 * Fetches department permissions (via the user's department memberships)
 * and user overrides, then composes them with the pure resolver.
 */
export async function getUserPermissions(userId: string): Promise<Set<string>> {
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
