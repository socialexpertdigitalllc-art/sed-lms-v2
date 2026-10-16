import type { SupabaseClient } from "@supabase/supabase-js";
import {
  correctionsByEvent,
  sortEvents,
  STATUS_DATE_CORRECTED,
  type StatusHistory,
} from "./statusHistory";

/**
 * A lead's status history for display. ADMIN client: the ledger, the activity
 * log and other users' profiles are all service-role only — callers must have
 * already checked the viewer may see this lead.
 */
export async function loadStatusHistory(
  admin: SupabaseClient,
  lead: { id: string; status: string; created_at: string },
): Promise<StatusHistory> {
  const [{ data: eventRows }, { data: correctionRows }] = await Promise.all([
    admin
      .from("lead_status_events")
      .select("id, from_status, to_status, changed_by, changed_at, source")
      .eq("lead_id", lead.id)
      .order("changed_at", { ascending: true }),
    admin
      .from("activity_log")
      .select("user_id, created_at, old_value")
      .eq("entity_type", "lead")
      .eq("entity_id", lead.id)
      .eq("action", STATUS_DATE_CORRECTED)
      .order("created_at", { ascending: true }),
  ]);
  const events = (eventRows ?? []) as {
    id: string;
    from_status: string | null;
    to_status: string;
    changed_by: string | null;
    changed_at: string;
    source: string;
  }[];
  const corrections = (correctionRows ?? []) as {
    user_id: string | null;
    created_at: string;
    old_value: { event_id?: unknown; changed_at?: unknown } | null;
  }[];

  const userIds = [...new Set([...events.map((e) => e.changed_by), ...corrections.map((c) => c.user_id)])].filter(
    (id): id is string => !!id,
  );
  const names = new Map<string, string | null>();
  if (userIds.length) {
    const { data: profiles } = await admin.from("profiles").select("id, display_name").in("id", userIds);
    for (const p of (profiles ?? []) as { id: string; display_name: string | null }[]) names.set(p.id, p.display_name);
  }
  const nameOf = (id: string | null) => (id ? names.get(id) ?? null : null);
  const fixes = correctionsByEvent(corrections, nameOf);

  return {
    leadId: lead.id,
    status: lead.status,
    submittedAt: lead.created_at,
    events: sortEvents(events).map((e) => ({
      id: e.id,
      from_status: e.from_status,
      to_status: e.to_status,
      changed_at: e.changed_at,
      by: nameOf(e.changed_by),
      source: e.source,
      correction: fixes.get(e.id) ?? null,
    })),
  };
}
