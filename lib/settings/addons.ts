import { createAdminClient } from "@/lib/supabase/admin";
import type { AddOn } from "@/lib/leads/types";

/**
 * Service-role reader for the website add-ons catalog.
 * Used by pages/routes that need the list (optionally active-only).
 */
export async function listAddons(
  activeOnly = false
): Promise<(AddOn & { is_active: boolean; sort: number })[]> {
  const admin = createAdminClient();
  let q = admin
    .from("website_addons")
    .select("id,label,price,is_active,sort")
    .order("sort");
  if (activeOnly) q = q.eq("is_active", true);
  const { data } = await q;
  return (data ?? []) as (AddOn & { is_active: boolean; sort: number })[];
}
