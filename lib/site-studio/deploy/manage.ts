import type { SupabaseClient } from "@supabase/supabase-js";
import { docrootFor } from "@/lib/template-engine/directadmin";

type Admin = SupabaseClient;

export interface DeploymentRecord {
  id: string;
  lead_id: string | null;
  subdomain: string;
  url: string;
  status: string;
  origin: string;
}

/**
 * Retire every OTHER live row for a lead — the partial unique index
 * (one live row per lead) rejects a second live row otherwise.
 */
export async function retireOtherLiveRows(
  admin: Admin,
  leadId: string,
  keepId: string | null,
): Promise<string | null> {
  const { data, error } = await admin
    .from("studio_deployments")
    .select("id")
    .eq("lead_id", leadId)
    .eq("status", "live");
  if (error) return error.message;
  for (const row of data ?? []) {
    if (row.id === keepId) continue;
    const { error: closeErr } = await admin
      .from("studio_deployments")
      .update({ status: "taken_down", taken_down_at: new Date().toISOString() })
      .eq("id", row.id as string);
    if (closeErr) return closeErr.message;
  }
  return null;
}

/**
 * Find-or-create the studio_deployments row for a staging subdomain. Untracked
 * subdomains are adopted as origin 'manual' (a live site someone uploaded by
 * hand). Returns the row, or an error string — an origin-check violation means
 * migration 0066 hasn't been applied yet, said out loud.
 */
export async function adoptSubdomain(
  admin: Admin,
  sub: string,
  actorId: string,
): Promise<{ row: DeploymentRecord } | { error: string }> {
  const daDomain = process.env.DA_DOMAIN ?? "";
  const url = `https://${sub}.${daDomain}`;
  const { data: existing } = await admin
    .from("studio_deployments")
    .select("id, lead_id, subdomain, url, status, origin")
    .eq("subdomain", sub)
    .maybeSingle();
  if (existing) return { row: existing as DeploymentRecord };

  const { data: created, error } = await admin
    .from("studio_deployments")
    .insert({
      lead_id: null,
      run_id: null,
      subdomain: sub,
      docroot: docrootFor(sub),
      url,
      status: "live",
      origin: "manual",
      deployed_at: new Date().toISOString(),
      deployed_by: actorId,
    })
    .select("id, lead_id, subdomain, url, status, origin")
    .single();
  if (error || !created) {
    const msg = error?.message ?? "insert failed";
    return {
      error: /origin/.test(msg)
        ? "Tracking this subdomain needs DB migration 0066 (origin 'manual') applied first."
        : msg,
    };
  }
  return { row: created as DeploymentRecord };
}
