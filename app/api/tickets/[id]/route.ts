import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getUserPermissions } from "@/lib/permissions/resolver";
import { canTransition } from "@/lib/tickets/logic";
import { ticketActionSchema } from "@/lib/tickets/schema";
import { notifyTicket } from "@/lib/tickets/notify";
import type { Ticket } from "@/lib/tickets/types";

export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = await req.json();
  const parsed = ticketActionSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid input", issues: parsed.error.flatten() },
      { status: 422 }
    );
  }

  const admin = createAdminClient();
  const { data: ticketRow } = await admin
    .from("lead_tickets")
    .select("*")
    .eq("id", id)
    .single();
  if (!ticketRow) return NextResponse.json({ error: "Ticket not found" }, { status: 404 });
  const ticket = ticketRow as Ticket;

  const { data: leadRow } = await admin
    .from("leads")
    .select("id, business_name, agent_id")
    .eq("id", ticket.lead_id)
    .single();
  if (!leadRow) return NextResponse.json({ error: "Lead not found" }, { status: 404 });
  const lead = leadRow as { id: string; business_name: string; agent_id: string | null };

  const perms = await getUserPermissions(user.id);
  const now = new Date().toISOString();

  switch (parsed.data.action) {
    case "assign": {
      if (!perms.has("tickets.assign")) {
        return NextResponse.json({ error: "Forbidden" }, { status: 403 });
      }
      if (!canTransition(ticket.status, "Assigned")) {
        return NextResponse.json({ error: "Invalid transition" }, { status: 409 });
      }

      const { data: updated, error } = await admin
        .from("lead_tickets")
        .update({ assigned_to: parsed.data.assigned_to, status: "Assigned", updated_at: now })
        .eq("id", id)
        .select("*")
        .single();
      if (error) return NextResponse.json({ error: error.message }, { status: 400 });

      await admin.from("activity_log").insert({
        user_id: user.id,
        action: "ticket.assigned",
        entity_type: "ticket",
        entity_id: id,
        new_value: { assigned_to: parsed.data.assigned_to },
      });

      try {
        await notifyTicket({
          eventKey: "ticket_assigned",
          ticketId: id,
          leadId: ticket.lead_id,
          ticket: { assigned_to: parsed.data.assigned_to, created_by: ticket.created_by },
          actorId: user.id,
          title: "Ticket assigned to you",
          body: `${ticket.category} — ${lead.business_name}`,
          nonce: now,
        });
      } catch {
        // Notification failures must never fail the ticket update.
      }

      return NextResponse.json({ ticket: updated });
    }

    case "start": {
      if (!perms.has("tickets.resolve")) {
        return NextResponse.json({ error: "Forbidden" }, { status: 403 });
      }
      // Only the assignee (or someone who can (re)assign tickets) may start work.
      if (ticket.assigned_to !== user.id && !perms.has("tickets.assign")) {
        return NextResponse.json({ error: "Forbidden" }, { status: 403 });
      }
      if (!canTransition(ticket.status, "In Progress")) {
        return NextResponse.json({ error: "Invalid transition" }, { status: 409 });
      }

      const { data: updated, error } = await admin
        .from("lead_tickets")
        .update({ status: "In Progress", updated_at: now })
        .eq("id", id)
        .select("*")
        .single();
      if (error) return NextResponse.json({ error: error.message }, { status: 400 });

      await admin.from("activity_log").insert({
        user_id: user.id,
        action: "ticket.started",
        entity_type: "ticket",
        entity_id: id,
        new_value: { status: "In Progress" },
      });

      return NextResponse.json({ ticket: updated });
    }

    case "resolve": {
      if (!perms.has("tickets.resolve")) {
        return NextResponse.json({ error: "Forbidden" }, { status: 403 });
      }
      if (!canTransition(ticket.status, "Resolved")) {
        return NextResponse.json({ error: "Invalid transition" }, { status: 409 });
      }

      const { data: updated, error } = await admin
        .from("lead_tickets")
        .update({
          status: "Resolved",
          resolution_note: parsed.data.resolution_note,
          resolved_at: now,
          resolved_by: user.id,
          updated_at: now,
        })
        .eq("id", id)
        .select("*")
        .single();
      if (error) return NextResponse.json({ error: error.message }, { status: 400 });

      await admin.from("activity_log").insert({
        user_id: user.id,
        action: "ticket.resolved",
        entity_type: "ticket",
        entity_id: id,
        new_value: { resolution_note: parsed.data.resolution_note },
      });

      try {
        await notifyTicket({
          eventKey: "ticket_resolved",
          ticketId: id,
          leadId: ticket.lead_id,
          ticket: { assigned_to: ticket.assigned_to, created_by: ticket.created_by },
          lead: { agent_id: lead.agent_id, closed_by: null },
          actorId: user.id,
          title: "Ticket resolved",
          body: `${lead.business_name} — ${parsed.data.resolution_note.slice(0, 80)}`,
          nonce: now,
        });
      } catch {
        // Notification failures must never fail the ticket update.
      }

      return NextResponse.json({ ticket: updated });
    }

    case "reopen": {
      if (ticket.created_by !== user.id && !perms.has("tickets.assign")) {
        return NextResponse.json({ error: "Forbidden" }, { status: 403 });
      }
      if (!canTransition(ticket.status, "In Progress")) {
        return NextResponse.json({ error: "Invalid transition" }, { status: 409 });
      }

      const { data: updated, error } = await admin
        .from("lead_tickets")
        .update({ status: "In Progress", resolved_at: null, resolved_by: null, updated_at: now })
        .eq("id", id)
        .select("*")
        .single();
      if (error) return NextResponse.json({ error: error.message }, { status: 400 });

      await admin.from("activity_log").insert({
        user_id: user.id,
        action: "ticket.reopened",
        entity_type: "ticket",
        entity_id: id,
        new_value: { status: "In Progress" },
      });

      try {
        await notifyTicket({
          eventKey: "ticket_reopened",
          ticketId: id,
          leadId: ticket.lead_id,
          ticket: { assigned_to: ticket.assigned_to, created_by: ticket.created_by },
          actorId: user.id,
          title: "Ticket reopened",
          body: `${lead.business_name} — reopened`,
          nonce: now,
        });
      } catch {
        // Notification failures must never fail the ticket update.
      }

      return NextResponse.json({ ticket: updated });
    }

    default:
      return NextResponse.json({ error: "Unknown action" }, { status: 400 });
  }
}
