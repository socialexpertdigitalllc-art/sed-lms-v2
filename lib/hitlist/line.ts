import type { createAdminClient } from "@/lib/supabase/admin";

type Admin = ReturnType<typeof createAdminClient>;

/**
 * The HitList's line tag (migration 0102, leads.line_type): is the number we
 * have the owner's DIRECT line or not. One click on the HitList sets it, for
 * anyone who can see the HitList (hitlist.view). Separate from the New Lead
 * form's "Direct Line saved?": this starts empty and only the HitList sets it.
 */

export const LINE_TYPES = ["direct", "not_direct"] as const;
export type LineType = (typeof LINE_TYPES)[number];

export const LINE_LABEL: Record<LineType, string> = { direct: "Direct Line", not_direct: "Not Direct Line" };
export const LINE_SHORT: Record<LineType, string> = { direct: "Direct", not_direct: "Not direct" };
/** The filter's key for leads not tagged yet. */
export const LINE_UNSET = "__none";

/** "direct" | "not_direct", null to clear, or undefined for anything else. */
export function parseLineType(v: unknown): LineType | null | undefined {
  if (v === null || v === "" || v === "none") return null;
  return typeof v === "string" && (LINE_TYPES as readonly string[]).includes(v) ? (v as LineType) : undefined;
}

/** May this person tag? Everyone who can see the HitList. */
export function canTagLine(perms: { has(key: string): boolean }): boolean {
  return perms.has("hitlist.view") || perms.has("hitlist.manage");
}

/** Set (or clear) a HitList lead's line tag. Logged on the lead when it changes. */
export async function setLineType(
  admin: Admin,
  leadId: string,
  value: LineType | null,
  userId: string,
): Promise<{ error?: string; status?: number }> {
  const [{ data: lead, error: leadErr }, { data: hit }] = await Promise.all([
    admin.from("leads").select("id, line_type").eq("id", leadId).is("deleted_at", null).maybeSingle(),
    admin.from("lead_hitlist").select("lead_id").eq("lead_id", leadId).maybeSingle(),
  ]);
  if (leadErr) {
    return /line_type/.test(leadErr.message)
      ? { error: "The Direct Line tag isn't set up in the database yet (migration 0102).", status: 503 }
      : { error: leadErr.message, status: 500 };
  }
  if (!lead) return { error: "Lead not found", status: 404 };
  if (!hit) return { error: "Only leads on the HitList can be tagged here.", status: 409 };
  const old = ((lead as { line_type?: string | null }).line_type ?? null) as LineType | null;
  if (old === value) return {};
  const { error } = await admin.from("leads").update({ line_type: value }).eq("id", leadId);
  if (error) return { error: error.message, status: 500 };
  await admin.from("activity_log").insert({
    user_id: userId,
    action: "lead.line_type",
    entity_type: "lead",
    entity_id: leadId,
    old_value: { line_type: old },
    new_value: { line_type: value },
  });
  return {};
}
