import Link from "next/link";
import { redirect, notFound } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getUserPermissions } from "@/lib/permissions/resolver";
import { allowedTicketScope, ticketInScope } from "@/lib/tickets/scope";
import { TicketQueue, type QueueTicket } from "@/components/tickets/TicketQueue";
import { StatusPill } from "@/components/leads/StatusPill";
import type { Ticket, TicketItem } from "@/lib/tickets/types";

export default async function LeadTicketsPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const perms = await getUserPermissions(user.id);
  if (!perms.has("tickets.view")) redirect("/dashboard");

  const admin = createAdminClient();

  // Cross-lead view: bypass RLS via the admin client, same as the global
  // tickets queue and the single-ticket detail page — safe because this
  // page is itself gated on `tickets.view` above.
  const { data: leadRow } = await admin
    .from("leads")
    .select("business_name, status")
    .eq("id", id)
    .single();
  if (!leadRow) notFound();
  const lead = leadRow as { business_name: string; status: string };

  const { data: ticketsRaw } = await admin
    .from("lead_tickets")
    .select("*")
    .eq("lead_id", id)
    .order("created_at", { ascending: false });

  // Ticket user-scoping: without `tickets.view_all`, only tickets the user
  // created or tickets on leads assigned to them — even on a colleague's
  // lead the user can open.
  const scope = await allowedTicketScope(admin, user.id, perms);
  const ticketRows = ((ticketsRaw ?? []) as Ticket[]).filter((t) =>
    ticketInScope(t, user.id, scope)
  );
  const ticketIds = ticketRows.map((t) => t.id);

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
    business_name: lead.business_name,
    items: itemsByTicket.get(t.id) ?? [],
    assigned_to_name: t.assigned_to ? names.get(t.assigned_to) ?? null : null,
  }));

  return (
    <div>
      <Link
        href={`/leads/${id}`}
        className="mb-2 inline-flex items-center gap-1 text-xs font-medium text-text-muted hover:text-text"
      >
        <ArrowLeft size={13} /> {lead.business_name}
      </Link>
      <div className="mb-5 flex flex-wrap items-center gap-2">
        <h1 className="font-display text-2xl font-semibold leading-tight text-text">
          Tickets — {lead.business_name}
        </h1>
        <StatusPill status={lead.status} />
      </div>

      <TicketQueue
        tickets={tickets}
        canAssign={perms.has("tickets.assign")}
        canResolve={perms.has("tickets.resolve")}
        currentUserId={user.id}
      />
    </div>
  );
}
