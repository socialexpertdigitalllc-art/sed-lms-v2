import type { createAdminClient } from "@/lib/supabase/admin";

type Admin = ReturnType<typeof createAdminClient>;

/**
 * Who may see which endpoints/submissions. Mirrors lib/tickets/scope.ts:
 * `leads.view_all` sees everything; otherwise only rows on leads currently
 * assigned to the user. Endpoints with no lead are visible only to managers.
 */
export type FormScope = { all: true; manage: boolean } | { all: false; leadIds: Set<string>; manage: boolean };

export async function allowedFormScope(admin: Admin, userId: string, perms: Set<string>): Promise<FormScope> {
  const manage = perms.has("forms.manage");
  if (perms.has("leads.view_all")) return { all: true, manage };
  // Agent OR closer: the form_submission_received rule can target lead_closer,
  // so a closer's bell must land on a page that shows them the submission.
  const { data } = await admin
    .from("leads")
    .select("id")
    .or(`agent_id.eq.${userId},closed_by.eq.${userId}`)
    .is("deleted_at", null);
  return { all: false, leadIds: new Set((data ?? []).map((l) => l.id as string)), manage };
}

export function endpointInScope(e: { lead_id: string | null }, scope: FormScope): boolean {
  if (scope.all) return true;
  if (e.lead_id === null) return scope.manage;
  return scope.leadIds.has(e.lead_id);
}

/** Submissions carry a denormalised lead_id, so the same rule applies. */
export const submissionInScope = endpointInScope;

/** May the caller ATTACH work to this lead? Null (no lead) is always fine —
 *  lead-less endpoints are a manager concern and the caller already holds
 *  forms.manage on every path that gets here. */
export function leadInScope(leadId: string | null, scope: FormScope): boolean {
  if (leadId === null || scope.all) return true;
  return scope.leadIds.has(leadId);
}
