import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getUserPermissions } from "@/lib/permissions/resolver";
import { allowedTicketScope, ticketInScope } from "@/lib/tickets/scope";
import { TicketQueue, type QueueTicket } from "@/components/tickets/TicketQueue";
import type { Ticket, TicketItem } from "@/lib/tickets/types";

export default async function TicketsPage({
  searchParams,
}: {
  searchParams: Promise<{ lead?: string; mine?: string }>;
}) {
  const { lead, mine } = await searchParams;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const perms = await getUserPermissions(user.id);
  if (!perms.has("tickets.view")) redirect("/dashboard");

  const admin = createAdminClient();

  // Cross-lead queue: bypass RLS via the admin client. Safe because this
  // page is itself gated on `tickets.view` above.
  const { data: ticketsRaw } = await admin
    .from("lead_tickets")
    .select("*")
    .order("created_at", { ascending: false });

  // Ticket user-scoping: without `tickets.view_all`, only tickets the user
  // created or tickets on leads assigned to them. Filter before the
  // enrichment queries so ids/names load only for visible tickets.
  const scope = await allowedTicketScope(admin, user.id, perms);
  const ticketRows = ((ticketsRaw ?? []) as Ticket[]).filter((t) =>
    ticketInScope(t, user.id, scope)
  );

  const ticketIds = ticketRows.map((t) => t.id);
  const leadIds = Array.from(new Set(ticketRows.map((t) => t.lead_id)));

  // Lead business_name (+ agent_id, unused here but resolved alongside it)
  const leadsById = new Map<string, { business_name: string; agent_id: string | null }>();
  if (leadIds.length) {
    const { data: leads } = await admin
      .from("leads")
      .select("id, business_name, agent_id")
      .in("id", leadIds);
    for (const l of leads ?? []) {
      leadsById.set(l.id, { business_name: l.business_name, agent_id: l.agent_id ?? null });
    }
  }

  // Items (for progress)
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

  // Assignee display names
  const assigneeIds = Array.from(
    new Set(ticketRows.map((t) => t.assigned_to).filter((v): v is string => Boolean(v)))
  );
  const names = new Map<string, string | null>();
  if (assigneeIds.length) {
    const { data: profiles } = await admin
      .from("profiles")
      .select("id, display_name")
      .in("id", assigneeIds);
    for (const p of profiles ?? []) names.set(p.id, p.display_name ?? null);
  }

  const tickets: QueueTicket[] = ticketRows.map((t) => ({
    ...t,
    business_name: leadsById.get(t.lead_id)?.business_name ?? null,
    items: itemsByTicket.get(t.id) ?? [],
    assigned_to_name: t.assigned_to ? names.get(t.assigned_to) ?? null : null,
  }));

  return (
    <TicketQueue
      tickets={tickets}
      canAssign={perms.has("tickets.assign")}
      canResolve={perms.has("tickets.resolve")}
      currentUserId={user.id}
      initialLeadId={lead ?? null}
      initialMine={mine === "1"}
    />
  );
}
