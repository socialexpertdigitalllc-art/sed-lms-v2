import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getUserPermissions } from "@/lib/permissions/resolver";
import { isTicketEligible } from "@/lib/tickets/logic";
import { createTicketSchema } from "@/lib/tickets/schema";
import { notifyTicket, adminUserIds } from "@/lib/tickets/notify";
import type { Ticket, TicketItem } from "@/lib/tickets/types";

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const perms = await getUserPermissions(user.id);
  if (!perms.has("tickets.view")) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  // RLS-scoped select on the user client → only tickets whose lead is visible
  // to this user (lead_tickets' "read tickets" policy re-checks `leads`, and
  // that inner select is itself subject to the "read leads scoped" policy).
  const { data: rows, error } = await supabase
    .from("lead_tickets")
    .select("*")
    .eq("lead_id", id)
    .order("created_at", { ascending: false });
  if (error) return NextResponse.json({ error: error.message }, { status: 400 });

  const tickets = (rows ?? []) as Ticket[];
  const ticketIds = tickets.map((t) => t.id);
  const admin = createAdminClient();

  // Items + creator/assignee/resolver display names resolved via the admin
  // client so they're never RLS-nulled/missing for users other than the viewer.
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
        .flatMap((t) => [t.created_by, t.assigned_to, t.resolved_by])
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

  const enriched = tickets.map((t) => ({
    ...t,
    items: itemsByTicket.get(t.id) ?? [],
    created_by_name: t.created_by ? names.get(t.created_by) ?? null : null,
    assigned_to_name: t.assigned_to ? names.get(t.assigned_to) ?? null : null,
    resolved_by_name: t.resolved_by ? names.get(t.resolved_by) ?? null : null,
  }));

  return NextResponse.json({ tickets: enriched });
}

export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const perms = await getUserPermissions(user.id);
  if (!perms.has("tickets.create")) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const admin = createAdminClient();
  const { data: lead } = await admin
    .from("leads")
    .select("id, business_name, status")
    .eq("id", id)
    .single();
  if (!lead) return NextResponse.json({ error: "Lead not found" }, { status: 404 });
  if (!isTicketEligible(lead.status))
    return NextResponse.json(
      { error: "Tickets apply only to Ready or Long Term leads." },
      { status: 422 }
    );

  const parsed = createTicketSchema.safeParse(await req.json());
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid input", issues: parsed.error.flatten() },
      { status: 422 }
    );
  }

  const { data: ticket, error } = await admin
    .from("lead_tickets")
    .insert({
      lead_id: id,
      created_by: user.id,
      category: parsed.data.category,
      signature: parsed.data.signature,
      priority: parsed.data.priority,
      title: parsed.data.title ?? null,
      status: "Open",
    })
    .select("*")
    .single();
  if (error) return NextResponse.json({ error: error.message }, { status: 400 });

  const itemRows = parsed.data.items.map((body, index) => ({
    ticket_id: ticket.id,
    body,
    sort: index,
  }));
  const { error: itemsError } = await admin.from("ticket_items").insert(itemRows);
  if (itemsError) return NextResponse.json({ error: itemsError.message }, { status: 400 });

  await admin.from("activity_log").insert({
    user_id: user.id,
    action: "ticket.created",
    entity_type: "ticket",
    entity_id: ticket.id,
    new_value: { category: parsed.data.category, items: parsed.data.items.length },
  });

  try {
    await notifyTicket({
      eventKey: "ticket_opened",
      ticketId: ticket.id,
      leadId: id,
      recipients: await adminUserIds(),
      title: "Ticket needs assignment",
      body: `${parsed.data.category} — ${lead.business_name}`,
      nonce: ticket.created_at,
    });
  } catch {
    // Notification failures must never fail ticket creation.
  }

  return NextResponse.json({ ticket }, { status: 201 });
}
