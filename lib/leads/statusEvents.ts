import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * Column patch for a status transition: entering Closed/Dropped stamps that
 * column and clears the other; entering any open status clears both.
 * NOTE: reports query these columns directly — the ledger is the audit trail,
 * not a fallback. A failed patch here degrades report accuracy until the
 * backfill script is re-run.
 */
export function statusTimestampPatch(
  to: string,
  at: string
): { closed_at: string | null; dropped_at: string | null } {
  return {
    closed_at: to === "Closed" ? at : null,
    dropped_at: to === "Dropped" ? at : null,
  };
}

/** Ledger write + column maintenance. Log-and-continue like activity_log. */
export async function recordStatusChange(
  admin: SupabaseClient,
  args: { leadId: string; from: string | null; to: string; userId: string | null; at?: string }
): Promise<void> {
  const at = args.at ?? new Date().toISOString();
  const { error: evError } = await admin.from("lead_status_events").insert({
    lead_id: args.leadId,
    from_status: args.from,
    to_status: args.to,
    changed_by: args.userId,
    changed_at: at,
    source: "app",
  });
  if (evError) console.error("[statusEvents] event insert failed:", evError.message);
  const { error: patchError } = await admin
    .from("leads")
    .update(statusTimestampPatch(args.to, at))
    .eq("id", args.leadId);
  if (patchError) console.error("[statusEvents] lead patch failed:", patchError.message);
}

/** Bulk variant: one event batch + one column update for N leads → `to`. */
export async function bulkRecordStatusChanges(
  admin: SupabaseClient,
  rows: { id: string; status: string }[],
  to: string,
  userId: string | null
): Promise<void> {
  if (rows.length === 0) return;
  const at = new Date().toISOString();
  const { error: evError } = await admin.from("lead_status_events").insert(
    rows.map((r) => ({
      lead_id: r.id,
      from_status: r.status,
      to_status: to,
      changed_by: userId,
      changed_at: at,
      source: "app",
    }))
  );
  if (evError) console.error("[statusEvents] bulk event insert failed:", evError.message);
  const { error: patchError } = await admin
    .from("leads")
    .update(statusTimestampPatch(to, at))
    .in("id", rows.map((r) => r.id));
  if (patchError) console.error("[statusEvents] bulk lead patch failed:", patchError.message);
}

/** Ledger + column stamps for leads CREATED directly in a terminal status. */
export async function stampInitialTerminalStatuses(
  admin: SupabaseClient,
  rows: { id: string; status: string }[],
  userId: string | null
): Promise<void> {
  for (const to of ["Closed", "Dropped"]) {
    const ids = rows.filter((r) => r.status === to).map((r) => r.id);
    if (ids.length === 0) continue;
    const at = new Date().toISOString();
    const { error: evError } = await admin.from("lead_status_events").insert(
      ids.map((id) => ({
        lead_id: id, from_status: null, to_status: to,
        changed_by: userId, changed_at: at, source: "app",
      }))
    );
    if (evError) console.error("[statusEvents] initial event insert failed:", evError.message);
    const { error: patchError } = await admin
      .from("leads").update(statusTimestampPatch(to, at)).in("id", ids);
    if (patchError) console.error("[statusEvents] initial lead patch failed:", patchError.message);
  }
}
