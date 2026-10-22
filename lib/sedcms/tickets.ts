import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";
import { notifyTicket } from "@/lib/tickets/notify";
import { withSiteLock } from "./apply";
import { isUuid } from "./http";
import type { SedcmsLead } from "./lead";

/**
 * A client's "Request a change" in SED CMS, as a ticket on the lead.
 * SERVER ONLY. Launch plan L6.
 *
 * - Idempotent by requestId: the activity_log row this writes is the record,
 *   so the same requestId answers the same ticket (and a requestId already
 *   used on another lead is refused, never answered with that lead's ticket).
 * - The lead's status is NOT checked, unlike the staff route
 *   (isTicketEligible): that rule stops sales opening tickets on leads that
 *   aren't ready, while a client asking for a change to their own live site
 *   is always eligible.
 * - The text is stored exactly as given and never interpreted; the ticket
 *   page renders it as text.
 */

export const TICKET_ITEMS_MAX = 10;
export const TICKET_ITEM_MAX_CHARS = 2000;

export const ChangeRequestBody = z
  .object({
    requestId: z.string().refine(isUuid),
    title: z.string().min(1).max(200),
    items: z.array(z.string().min(1).max(TICKET_ITEM_MAX_CHARS)).min(1).max(TICKET_ITEMS_MAX),
    requestedBy: z.object({ name: z.string().min(1).max(200), email: z.string().min(3).max(254) }).strict(),
    pageUrl: z.string().max(2048).optional(),
  })
  .strict();

export type ChangeRequest = z.infer<typeof ChangeRequestBody>;

export const changeTicketTitle = (businessName: string) => `Change request from ${businessName} (SED CMS)`;

export type ChangeTicketResult =
  | { ok: true; ticketId: string; created: boolean }
  | { ok: false; status: 409 | 500; code: "REQUEST_ID_USED" | "INTERNAL"; message: string };

/** The ticket an earlier request with this requestId made, if any. */
async function earlierTicket(admin: SupabaseClient, requestId: string): Promise<{ ticketId: string; leadId: string | null } | null | "error"> {
  const { data, error } = await admin
    .from("activity_log")
    .select("entity_id")
    .eq("action", "ticket.created")
    .eq("entity_type", "ticket")
    .eq("new_value->>requestId", requestId)
    .limit(1);
  if (error || !Array.isArray(data)) return "error";
  const ticketId = (data[0] as { entity_id?: string | null } | undefined)?.entity_id;
  if (!ticketId) return null;
  const { data: ticket } = await admin.from("lead_tickets").select("id, lead_id").eq("id", ticketId).maybeSingle();
  return { ticketId, leadId: (ticket as { lead_id?: string } | null)?.lead_id ?? null };
}

export async function createChangeTicket(admin: SupabaseClient, lead: SedcmsLead, req: ChangeRequest): Promise<ChangeTicketResult> {
  // One at a time per requestId, so two deliveries of one request make one ticket.
  return withSiteLock(`ticket:${req.requestId}`, async (): Promise<ChangeTicketResult> => {
    const earlier = await earlierTicket(admin, req.requestId);
    if (earlier === "error") return { ok: false, status: 500, code: "INTERNAL", message: "The ticket could not be checked." };
    if (earlier) {
      if (earlier.leadId !== lead.id) {
        return { ok: false, status: 409, code: "REQUEST_ID_USED", message: "That request id was already used for another lead." };
      }
      return { ok: true, ticketId: earlier.ticketId, created: false };
    }

    const { data: ticket, error } = await admin
      .from("lead_tickets")
      .insert({
        lead_id: lead.id,
        created_by: null,
        category: "Changes",
        signature: "Agent",
        priority: "Normal",
        status: "Open",
        title: changeTicketTitle(lead.business_name),
        due_date: null,
      })
      .select("id, created_at")
      .single();
    if (error || !ticket) {
      console.error(`[sedcms] the change-request ticket for lead ${lead.id} could not be created`);
      return { ok: false, status: 500, code: "INTERNAL", message: "The ticket could not be created." };
    }
    const { id: ticketId, created_at: createdAt } = ticket as { id: string; created_at: string };

    const { error: itemsError } = await admin
      .from("ticket_items")
      .insert(req.items.map((body, sort) => ({ ticket_id: ticketId, body, sort })));
    if (itemsError) {
      // No ticket without its items: a retry makes a whole one.
      await admin.from("lead_tickets").delete().eq("id", ticketId);
      console.error(`[sedcms] the change-request items for lead ${lead.id} could not be stored`);
      return { ok: false, status: 500, code: "INTERNAL", message: "The ticket could not be created." };
    }

    const { error: logError } = await admin.from("activity_log").insert({
      user_id: null,
      action: "ticket.created",
      entity_type: "ticket",
      entity_id: ticketId,
      new_value: { via: "sedcms", requestId: req.requestId, title: req.title, requestedBy: req.requestedBy, pageUrl: req.pageUrl ?? null },
    });
    if (logError) console.error(`[sedcms] the ticket.created row for ticket ${ticketId} was not written`);

    try {
      await notifyTicket({
        eventKey: "ticket_opened",
        ticketId,
        leadId: lead.id,
        actorId: null,
        title: "Ticket needs assignment",
        body: `Changes — ${lead.business_name} (requested in SED CMS)`,
        nonce: createdAt,
      });
    } catch {
      // Notification failures must never fail ticket creation.
    }
    return { ok: true, ticketId, created: true };
  });
}
