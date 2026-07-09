import { createAdminClient } from "@/lib/supabase/admin";
import { notify } from "@/lib/notifications/notify";

export async function notifyTicket(opts: {
  eventKey: "ticket_opened" | "ticket_assigned" | "ticket_resolved" | "ticket_reopened" | "ticket_overdue";
  ticketId: string; leadId: string;
  ticket?: { assigned_to: string | null; created_by: string | null } | null;
  lead?: { agent_id: string | null; closed_by: string | null } | null;
  actorId?: string | null;
  title: string; body: string; nonce: string;
}) {
  await notify(
    opts.eventKey,
    { leadId: opts.leadId, ticket: opts.ticket ?? null, lead: opts.lead ?? null, actorId: opts.actorId ?? null },
    { title: opts.title, body: opts.body, dedupKey: `${opts.eventKey}:${opts.ticketId}:${opts.nonce}`, targetUrl: `/tickets/${opts.ticketId}` }
  );
}

/** Tech-department members for the assignment picker. */
export async function techMembers(): Promise<{ id: string; display_name: string }[]> {
  const admin = createAdminClient();
  const { data: dept } = await admin.from("departments").select("id").eq("slug", "tech").single();
  if (!dept) return [];
  const { data } = await admin.from("department_members").select("user_id, profiles!department_members_user_id_fkey(id, display_name)").eq("department_id", dept.id);
  return (data ?? []).map((m: any) => ({ id: m.profiles?.id, display_name: m.profiles?.display_name })).filter((u: any) => u.id);
}
