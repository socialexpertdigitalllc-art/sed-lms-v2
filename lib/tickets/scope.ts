import type { createAdminClient } from "@/lib/supabase/admin";

type Admin = ReturnType<typeof createAdminClient>;

export type TicketScope = { all: true } | { all: false; leadIds: Set<string> };

/**
 * Resolve which tickets a user may see. With `tickets.view_all` the whole
 * queue is visible; otherwise only tickets the user created or tickets on
 * leads currently assigned to them (leads.agent_id = userId, non-deleted).
 */
export async function allowedTicketScope(
  admin: Admin,
  userId: string,
  perms: Set<string>
): Promise<TicketScope> {
  if (perms.has("tickets.view_all")) return { all: true };
  const { data } = await admin
    .from("leads")
    .select("id")
    .eq("agent_id", userId)
    .is("deleted_at", null);
  return { all: false, leadIds: new Set((data ?? []).map((l) => l.id as string)) };
}

export function ticketInScope(
  t: { created_by: string | null; lead_id: string },
  userId: string,
  scope: TicketScope
): boolean {
  if (scope.all) return true;
  return (t.created_by !== null && t.created_by === userId) || scope.leadIds.has(t.lead_id);
}
