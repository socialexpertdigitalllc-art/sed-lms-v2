import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
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

  return (
    <LeadDetail
      lead={lead}
      agents={agents ?? []}
      followUps={followUps}
      closedByName={closedByName}
      tickets={tickets}
      sla={settings.ticket_sla}
    />
  );
}
