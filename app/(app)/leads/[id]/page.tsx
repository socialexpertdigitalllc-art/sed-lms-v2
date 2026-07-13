import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getUserPermissions } from "@/lib/permissions/resolver";
import { allowedTicketScope, ticketInScope } from "@/lib/tickets/scope";
import { LeadDetail } from "@/components/leads/LeadDetail";
import type { Lead } from "@/lib/leads/types";
import type { LeadFollowUp } from "@/lib/leads/followups";
import type { Ticket, TicketItem } from "@/lib/tickets/types";
import { getAppSettings } from "@/lib/settings/appSettings";
import { notFound } from "next/navigation";

export default async function LeadDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const supabase = await createClient();

  const { data: leadRaw } = await supabase
    .from("leads")
    .select("*")
    .eq("id", id)
    .is("deleted_at", null)
    .single();
  if (!leadRaw) notFound();
  const lead = leadRaw as Lead;

  const { data: agents } = await supabase
    .from("profiles")
    .select("id, display_name")
    .eq("is_active", true)
    .order("display_name");

  const { data: followUpsRaw } = await supabase
    .from("lead_follow_ups")
    .select("*")
    .eq("lead_id", id)
    .order("created_at", { ascending: false });

  const admin = createAdminClient();
  const settings = await getAppSettings();

  // Fetch this lead's tickets + their items via the admin client (mirrors
  // GET /api/leads/[id]/tickets) so the detail-page card is never RLS-scoped.
  const { data: ticketsRaw } = await admin
    .from("lead_tickets")
    .select("*")
    .eq("lead_id", id)
    .order("created_at", { ascending: false });
  const ticketRows = (ticketsRaw ?? []) as Ticket[];
  const ticketIds = ticketRows.map((t) => t.id);
  const itemsByTicket = new Map<string, TicketItem[]>();
  if (ticketIds.length) {
    const { data: items } = await admin
      .from("ticket_items")
      .select("*")
      .in("ticket_id", ticketIds)
      .order("sort");
    for (const item of (items ?? []) as TicketItem[]) {
      const list = itemsByTicket.get(item.ticket_id) ?? [];
      list.push(item);
      itemsByTicket.set(item.ticket_id, list);
    }
  }
  const tickets: Ticket[] = ticketRows.map((t) => ({ ...t, items: itemsByTicket.get(t.id) ?? [] }));

  // Resolve logger + closer names via the admin client so display_name is not RLS-nulled
  // for actors other than the viewer (covers no-longer-active profiles too).
  const userIds = Array.from(
    new Set([...(followUpsRaw ?? []).map((r) => r.user_id), lead.closed_by].filter(Boolean))
  ) as string[];
  const names = new Map<string, string | null>();
  if (userIds.length) {
    const { data: profiles } = await admin
      .from("profiles")
      .select("id, display_name")
      .in("id", userIds);
    for (const p of profiles ?? []) names.set(p.id, p.display_name ?? null);
  }
  const followUps: LeadFollowUp[] = (followUpsRaw ?? []).map((r) => ({
    ...r,
    logger_name: r.user_id ? names.get(r.user_id) ?? null : null,
  }));
  const closedByName = lead.closed_by ? names.get(lead.closed_by) ?? null : null;

  // Current user + permissions for the "Closed by" edit allowance.
  const {
    data: { user },
  } = await supabase.auth.getUser();
  const perms = user ? await getUserPermissions(user.id) : new Set<string>();

  // Ticket user-scoping for the Tickets card: without `tickets.view_all`,
  // only tickets the user created or tickets on leads assigned to them.
  let visibleTickets: Ticket[] = [];
  if (user) {
    const ticketScope = await allowedTicketScope(admin, user.id, perms);
    visibleTickets = tickets.filter((t) => ticketInScope(t, user.id, ticketScope));
  }

  // Closing-department members for the "Closed by" picker (two FKs to profiles → pin the FK).
  // Admin client: department_members RLS is "self or admin" — a user client would
  // return an empty list for regular users.
  const { data: closingDept } = await admin
    .from("departments")
    .select("id")
    .eq("slug", "closing")
    .single();
  let closingUsers: { id: string; display_name: string }[] = [];
  if (closingDept) {
    const { data: members } = await admin
      .from("department_members")
      .select("user_id, profiles!department_members_user_id_fkey(id, display_name)")
      .eq("department_id", closingDept.id);
    closingUsers = (members ?? [])
      .map((m: any) => ({ id: m.profiles?.id, display_name: m.profiles?.display_name }))
      .filter((u: any) => u.id);
  }

  // A Sales-department member may edit Closed-by even without leads.edit.
  let isSalesMember = false;
  if (user) {
    const { data: salesDept } = await supabase
      .from("departments")
      .select("id")
      .eq("slug", "sales")
      .single();
    if (salesDept) {
      const { data: membership } = await admin
        .from("department_members")
        .select("user_id")
        .eq("department_id", salesDept.id)
        .eq("user_id", user.id)
        .maybeSingle();
      isSalesMember = !!membership;
    }
  }
  const canEditClosedBy = perms.has("leads.edit") || isSalesMember;

  return (
    <LeadDetail
      lead={lead}
      agents={agents ?? []}
      followUps={followUps}
      closedByName={closedByName}
      closingUsers={closingUsers}
      canEditClosedBy={canEditClosedBy}
      tickets={visibleTickets}
      sla={settings.ticket_sla}
    />
  );
}
