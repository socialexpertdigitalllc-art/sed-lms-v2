// lib/tickets/autoResolve.ts
/**
 * v2 F3 — auto-resolve a ticket once every change item is done (or it never
 * had any). MIRRORS the manual PATCH "resolve" action's writes exactly
 * (app/api/tickets/[id]/route.ts: the same lead_tickets update fields, the
 * same `ticket.resolved` activity row, the same notifyTicket call) with
 * `new_value.auto: true` added so history shows nobody clicked Resolve.
 *
 * Entirely best-effort BY CONTRACT: callers sit after a successful deploy or
 * a committed item toggle, and a failure here must never fail THAT response —
 * every error is warned and swallowed, and the return value only says whether
 * the resolve actually landed.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import { notifyTicket } from "@/lib/tickets/notify";

export async function autoResolveTicketIfComplete(
  admin: SupabaseClient,
  opts: { ticketId: string; userId: string; note: string },
): Promise<boolean> {
  try {
    const { data: items } = await admin
      .from("ticket_items")
      .select("id, is_done")
      .eq("ticket_id", opts.ticketId);
    const list = (items ?? []) as { id: string; is_done: boolean }[];
    // Zero items counts as complete (the operator's explicit ask); one undone
    // item keeps the ticket open.
    if (list.length > 0 && !list.every((i) => i.is_done)) return false;

    const { data: ticket } = await admin
      .from("lead_tickets")
      .select("id, status, lead_id, assigned_to, created_by")
      .eq("id", opts.ticketId)
      .maybeSingle();
    if (!ticket || ticket.status !== "In Progress") return false;

    const now = new Date().toISOString();
    // Mirror of the manual resolve's update — same fields, same shape.
    const { error } = await admin
      .from("lead_tickets")
      .update({
        status: "Resolved",
        resolution_note: opts.note,
        resolved_at: now,
        resolved_by: opts.userId,
        updated_at: now,
      })
      .eq("id", opts.ticketId)
      .select("*")
      .single();
    if (error) {
      console.warn(`[tickets] auto-resolve of ${opts.ticketId} failed: ${error.message}`);
      return false;
    }

    await admin.from("activity_log").insert({
      user_id: opts.userId,
      action: "ticket.resolved",
      entity_type: "ticket",
      entity_id: opts.ticketId,
      new_value: { resolution_note: opts.note, auto: true },
    });

    const { data: lead } = await admin
      .from("leads")
      .select("id, business_name, agent_id")
      .eq("id", ticket.lead_id)
      .maybeSingle();
    try {
      await notifyTicket({
        eventKey: "ticket_resolved",
        ticketId: opts.ticketId,
        leadId: ticket.lead_id,
        ticket: { assigned_to: ticket.assigned_to, created_by: ticket.created_by },
        lead: { agent_id: lead?.agent_id ?? null, closed_by: null },
        actorId: opts.userId,
        title: "Ticket resolved",
        body: `${lead?.business_name ?? ""} — ${opts.note.slice(0, 80)}`,
        nonce: now,
      });
    } catch {
      // Notification failures must never fail the resolve (same rule as the
      // manual action).
    }
    return true;
  } catch (e) {
    console.warn(`[tickets] auto-resolve of ${opts.ticketId} failed:`, e);
    return false;
  }
}
