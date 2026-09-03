import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * Is this subdomain already someone ELSE's live site?
 *
 * The ownership question that names a first deploy. Deliberately asked of
 * `studio_deployments` rather than of DirectAdmin, because the two answer
 * different questions:
 *
 *  - DirectAdmin only knows a docroot EXISTS. For a name derived from this
 *    lead's own business name, an existing docroot is almost always our own
 *    earlier attempt, and renaming around it would strand that site and hand
 *    the client a `-2` link for no reason.
 *  - `studio_deployments` knows WHOSE it is. A live row under a different lead
 *    is the only case where the clean name genuinely is not ours to take.
 *
 * A NULL `lead_id` counts as another lead's: an orphaned row (`on delete set
 * null`) or an unlinked `v2_import` is not "nobody's site", it is "we do not
 * know whose site this is", and the safe move is to step aside. Taken_down and
 * failed rows are history and may be reclaimed freely.
 */
export async function claimedByAnotherLead(
  admin: SupabaseClient,
  subdomain: string,
  leadId: string | null,
): Promise<boolean> {
  const { data } = await admin
    .from("studio_deployments")
    .select("lead_id, status")
    .eq("subdomain", subdomain)
    .maybeSingle();
  if (!data || data.status !== "live") return false;
  return data.lead_id !== leadId || data.lead_id === null;
}
