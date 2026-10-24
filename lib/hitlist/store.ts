import type { createAdminClient } from "@/lib/supabase/admin";

type Admin = ReturnType<typeof createAdminClient>;

/**
 * The HitList (migration 0095): one company-wide list of premium leads, each
 * with a 1–5 star priority. Admins add and remove (hitlist.manage); closers
 * only view (hitlist.view). Writes go through the service role behind
 * /api/hitlist/[leadId]; reads use it too, after the page's permission check.
 */

export const HITLIST_MIN = 1;
export const HITLIST_MAX = 5;
/** Lead id → priority (1–5 stars). */
export type HitlistMap = Record<string, number>;

/** A whole number 1–5, or null for anything else. */
export function parsePriority(v: unknown): number | null {
  const n = typeof v === "string" && v.trim() !== "" ? Number(v) : v;
  return typeof n === "number" && Number.isInteger(n) && n >= HITLIST_MIN && n <= HITLIST_MAX ? n : null;
}

/** Every hit-listed lead and its priority. Empty when the table isn't there yet. */
export async function loadHitlist(admin: Admin): Promise<HitlistMap> {
  const { data, error } = await admin.from("lead_hitlist").select("lead_id, priority");
  if (error || !data) return {};
  const map: HitlistMap = {};
  for (const r of data as { lead_id: string; priority: number }[]) map[r.lead_id] = r.priority;
  return map;
}

/** Add a lead, or change its priority. Logged on the lead. */
export async function setHitlist(admin: Admin, leadId: string, priority: number, userId: string): Promise<{ error?: string }> {
  const { data: prev } = await admin.from("lead_hitlist").select("priority").eq("lead_id", leadId).maybeSingle();
  const { error } = await admin
    .from("lead_hitlist")
    .upsert({ lead_id: leadId, priority, added_by: userId, updated_at: new Date().toISOString() }, { onConflict: "lead_id" });
  if (error) return { error: error.message };
  const old = (prev as { priority?: number } | null)?.priority ?? null;
  if (old !== priority) {
    await admin.from("activity_log").insert({
      user_id: userId,
      action: old == null ? "lead.hitlist_added" : "lead.hitlist_priority",
      entity_type: "lead",
      entity_id: leadId,
      old_value: old == null ? null : { hitlist_priority: old },
      new_value: { hitlist_priority: priority },
    });
  }
  return {};
}

/** Take a lead off the list. Logged on the lead when it was on it. */
export async function removeHitlist(admin: Admin, leadId: string, userId: string): Promise<{ error?: string }> {
  const { data, error } = await admin.from("lead_hitlist").delete().eq("lead_id", leadId).select("priority");
  if (error) return { error: error.message };
  const old = (data as { priority: number }[] | null)?.[0]?.priority;
  if (old != null) {
    await admin.from("activity_log").insert({
      user_id: userId,
      action: "lead.hitlist_removed",
      entity_type: "lead",
      entity_id: leadId,
      old_value: { hitlist_priority: old },
      new_value: null,
    });
  }
  return {};
}
