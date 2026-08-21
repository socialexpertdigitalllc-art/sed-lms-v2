import { cache } from "react";
import { createAdminClient } from "@/lib/supabase/admin";
import { ttlCached, ttlInvalidate } from "@/lib/cache/ttl";

/**
 * The company name roster — WHO to display for a user id.
 *
 * WHY THIS EXISTS: `profiles` RLS is `id = auth.uid() or is_admin()`
 * (migration 0001), so reading it through the USER client returns exactly one
 * row for a non-admin. Any page that resolved names that way showed the
 * viewer's own name and "Unassigned" for everyone else — which is what a user
 * granted `leads.view_all` saw across every lead but their own. Leads
 * themselves are readable (`read leads ... using (true)`), so the leads were
 * there; only the names were missing.
 *
 * Names are not sensitive inside the company (they already appear in every
 * assignment picker), so this reads through the service-role client and
 * returns ONLY id / display_name / is_active — never emails or any other
 * profile column.
 *
 * Cached two ways: React's request cache dedupes it within one render, and a
 * 60s process TTL keeps a roster that changes ~never off the hot path of
 * every page (see the disk-IO work in v2.11.1). Admin user writes invalidate
 * it, so a rename shows up immediately on the instance that made it.
 */
export interface DirectoryUser {
  id: string;
  display_name: string | null;
  is_active: boolean;
}

export const getUserDirectory = cache(
  async (): Promise<DirectoryUser[]> =>
    ttlCached("user-directory", "all", 60_000, async () => {
      const admin = createAdminClient();
      const { data } = await admin
        .from("profiles")
        .select("id, display_name, is_active")
        .order("display_name");
      return (data ?? []) as DirectoryUser[];
    }),
);

export function invalidateUserDirectory(): void {
  ttlInvalidate("user-directory");
}

/** Assignment pickers show only people who can still be assigned work. */
export async function getActiveUsers(): Promise<DirectoryUser[]> {
  return (await getUserDirectory()).filter((u) => u.is_active);
}

/** id -> display name, with a caller-chosen fallback for unknown ids. */
export function nameMapOf(users: DirectoryUser[], fallback = "—"): Record<string, string> {
  const map: Record<string, string> = {};
  for (const u of users) map[u.id] = u.display_name ?? fallback;
  return map;
}
