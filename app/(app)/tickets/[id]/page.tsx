import { redirect, notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getUserPermissions } from "@/lib/permissions/resolver";
import { techMembers } from "@/lib/tickets/notify";
import { TicketDetail } from "@/components/tickets/TicketDetail";
import type { Ticket, TicketItem, TicketAttachment } from "@/lib/tickets/types";

export default async function TicketDetailPage({
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

  // Cross-lead detail view: bypass RLS via the admin client. Safe because this
  // page is itself gated on `tickets.view` above.
  const { data: ticketRow } = await admin
    .from("lead_tickets")
    .select("*")
    .eq("id", id)
    .single();
  if (!ticketRow) notFound();
  const ticket = ticketRow as Ticket;

  const { data: itemsRaw } = await admin
    .from("ticket_items")
    .select("*")
    .eq("ticket_id", id)
    .order("sort");
  const items = (itemsRaw ?? []) as TicketItem[];

  // Per-item image attachments, served as short-lived signed URLs — the
  // `ticket-attachments` bucket is private, so only the service-role admin
  // client can read it, and only this generated URL is shareable.
  const itemIds = items.map((i) => i.id);
  if (itemIds.length) {
    const { data: attachmentsRaw } = await admin
      .from("ticket_item_attachments")
      .select("*")
      .in("item_id", itemIds);
    const attachments = (attachmentsRaw ?? []) as TicketAttachment[];
    await Promise.all(
      attachments.map(async (att) => {
        const { data: signed } = await admin.storage
          .from("ticket-attachments")
          .createSignedUrl(att.path, 3600);
        att.url = signed?.signedUrl ?? undefined;
      })
    );
    const attachmentsByItem = new Map<string, TicketAttachment[]>();
    for (const att of attachments) {
      const list = attachmentsByItem.get(att.item_id) ?? [];
      list.push(att);
      attachmentsByItem.set(att.item_id, list);
    }
    for (const item of items) {
      item.attachments = attachmentsByItem.get(item.id) ?? [];
    }
  }

  const { data: leadRow } = await admin
    .from("leads")
    .select("id, business_name, agent_id, closed_by, status")
    .eq("id", ticket.lead_id)
    .single();
  if (!leadRow) notFound();
  const lead = leadRow as {
    id: string;
    business_name: string;
    agent_id: string | null;
    closed_by: string | null;
    status: string;
  };

  // Resolve display names for every actor referenced on the page (creator,
  // assignee, resolver, plus the lead's agent/closer for the signature line)
  // via the admin client so display_name is never RLS-nulled for others.
  const userIds = Array.from(
    new Set(
      [ticket.created_by, ticket.assigned_to, ticket.resolved_by, lead.agent_id, lead.closed_by].filter(
        (v): v is string => Boolean(v)
      )
    )
  );
  const names: Record<string, string | null> = {};
  if (userIds.length) {
    const { data: profiles } = await admin
      .from("profiles")
      .select("id, display_name")
      .in("id", userIds);
    for (const p of profiles ?? []) names[p.id] = p.display_name ?? null;
  }

  const canAssign = perms.has("tickets.assign");
  const techs = canAssign ? await techMembers() : [];

  return (
    <TicketDetail
      ticket={ticket}
      items={items}
      lead={lead}
      names={names}
      techMembers={techs}
      canAssign={canAssign}
      canResolve={perms.has("tickets.resolve")}
      isCreator={ticket.created_by === user.id}
    />
  );
}
