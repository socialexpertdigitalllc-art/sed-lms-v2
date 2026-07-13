import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getUserPermissions } from "@/lib/permissions/resolver";
import { allowedTicketScope, ticketInScope } from "@/lib/tickets/scope";
import type { Ticket, TicketItem } from "@/lib/tickets/types";

export async function GET(req: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const perms = await getUserPermissions(user.id);
  if (!perms.has("tickets.view")) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const url = new URL(req.url);
  const mine = url.searchParams.get("mine");
  const status = url.searchParams.get("status");
  const lead = url.searchParams.get("lead");

  const admin = createAdminClient();

  // Cross-lead queue: bypass RLS via the admin client. Safe because this
  // route is itself gated on `tickets.view` above.
  let query = admin
    .from("lead_tickets")
    .select("*")
    .order("created_at", { ascending: false });
  if (mine) query = query.eq("assigned_to", user.id);
  if (status) query = query.eq("status", status);
  if (lead) query = query.eq("lead_id", lead);

  const { data: rows, error } = await query;
  if (error) return NextResponse.json({ error: error.message }, { status: 400 });

  // Ticket user-scoping: without `tickets.view_all`, only tickets the user
  // created or tickets on leads assigned to them.
  const scope = await allowedTicketScope(admin, user.id, perms);
  const tickets = ((rows ?? []) as Ticket[]).filter((t) =>
    ticketInScope(t, user.id, scope)
  );
  const ticketIds = tickets.map((t) => t.id);
  const leadIds = Array.from(new Set(tickets.map((t) => t.lead_id)));

  // Lead business_name + agent_id, items (for progress), and creator/assignee
  // display names — all resolved via the admin client so they're never
  // RLS-nulled/missing for users other than the viewer.
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

  const userIds = Array.from(
    new Set(
      tickets
        .flatMap((t) => [t.created_by, t.assigned_to])
        .filter((v): v is string => Boolean(v))
    )
  );
  const names = new Map<string, string | null>();
  if (userIds.length) {
    const { data: profiles } = await admin
      .from("profiles")
      .select("id, display_name")
      .in("id", userIds);
    for (const p of profiles ?? []) names.set(p.id, p.display_name ?? null);
  }

  const enriched = tickets.map((t) => {
    const leadInfo = leadsById.get(t.lead_id);
    return {
      ...t,
      business_name: leadInfo?.business_name ?? null,
      agent_id: leadInfo?.agent_id ?? null,
      items: itemsByTicket.get(t.id) ?? [],
      assigned_to_name: t.assigned_to ? names.get(t.assigned_to) ?? null : null,
      created_by_name: t.created_by ? names.get(t.created_by) ?? null : null,
    };
  });

  return NextResponse.json({ tickets: enriched });
}
