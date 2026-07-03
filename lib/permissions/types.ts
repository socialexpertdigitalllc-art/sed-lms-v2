export interface DeptPermRow {
  permission_key: string;
}

export interface OverrideRow {
  permission_key: string;
  is_granted: boolean;
  expires_at: string | null;
}

/**
 * Pure permission resolution:
 *   FINAL = (union of department permissions) + user grants - user revokes
 * Expired overrides are ignored.
 */
export function resolvePermissions(
  deptPerms: DeptPermRow[],
  overrides: OverrideRow[],
  now: Date = new Date()
): Set<string> {
  const perms = new Set(deptPerms.map((p) => p.permission_key));
  for (const o of overrides) {
    if (o.expires_at && new Date(o.expires_at) <= now) continue;
    if (o.is_granted) perms.add(o.permission_key);
    else perms.delete(o.permission_key);
  }
  return perms;
}
