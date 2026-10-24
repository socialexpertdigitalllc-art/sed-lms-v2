import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";
import { notifyTicket } from "@/lib/tickets/notify";
import { withSiteLock } from "./apply";
import { isUuid } from "./http";
import type { SedcmsLead } from "./lead";
import { claimRequest, completeRequest, derivedUuid, digestOf } from "./requests";

/**
 * A client's "Request a change" in SED CMS, as a ticket on the lead.
 * SERVER ONLY. Launch plan L6.
 *
 * - Idempotent by requestId, on every LMS process (lib/sedcms/requests.ts):
 *   the id is claimed in sedcms_requests first, and everything the request
 *   makes (the ticket, its items, its activity_log row) has an id derived
 *   from it. A second delivery, at any moment, finds what the first made
 *   instead of making it again; a delivery that failed or crashed part-way
 *   is completed by the next one. The notification's dedup key comes from
 *   the ticket, so it is sent once however many deliveries reach it. A
 *   request id already used for another lead, another kind or other content
 *   is refused, never answered with that ticket.
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
  | { ok: false; status: 409 | 500 | 503; code: "REQUEST_ID_USED" | "INTERNAL" | "NOT_CONFIGURED"; message: string };

const failed = (message: string): ChangeTicketResult => ({ ok: false, status: 500, code: "INTERNAL", message });

/** What the request asked for, in one fixed order. */
function requestDigest(req: ChangeRequest): string {
  return digestOf({
    title: req.title,
    items: req.items,
    requestedBy: { name: req.requestedBy.name, email: req.requestedBy.email },
    pageUrl: req.pageUrl ?? null,
  });
}

/** The ids everything this request makes is stored under. */
export function changeTicketIds(requestId: string, itemCount: number) {
  return {
    ticket: derivedUuid("ticket", requestId),
    items: Array.from({ length: itemCount }, (_, i) => derivedUuid(`ticket-item-${i}`, requestId)),
    log: derivedUuid("ticket-log", requestId),
  };
}

export async function createChangeTicket(admin: SupabaseClient, lead: SedcmsLead, req: ChangeRequest): Promise<ChangeTicketResult> {
  // One at a time per requestId in this process; the database holds it across processes.
  return withSiteLock(`ticket:${req.requestId}`, async (): Promise<ChangeTicketResult> => {
    const digest = requestDigest(req);
    const claim = await claimRequest(admin, { requestId: req.requestId, leadId: lead.id, kind: "ticket", digest });
    if (claim.status === "error") {
      if (claim.missingTable) return { ok: false, status: 503, code: "NOT_CONFIGURED", message: "The LMS is not set up to take CMS requests." };
      console.error(`[sedcms] the change request ${req.requestId} could not be recorded`);
      return failed("The ticket could not be created.");
    }
    const ids = changeTicketIds(req.requestId, req.items.length);
    if (claim.status === "used") {
      const used = claim.request;
      if (used.leadId !== lead.id || used.kind !== "ticket" || used.digest !== digest) {
        return { ok: false, status: 409, code: "REQUEST_ID_USED", message: "That request id was already used for another request." };
      }
      if (used.completedAt) return { ok: true, ticketId: used.ticketId ?? ids.ticket, created: false };
      // An earlier delivery stopped part-way (a failed write, a crash, or it
      // is still running on the other process): finish it, step by step.
    }
    return completeTicket(admin, lead, req, ids);
  });
}

/** Every step finds what an earlier delivery made, so running it twice makes nothing twice. */
async function completeTicket(admin: SupabaseClient, lead: SedcmsLead, req: ChangeRequest, ids: ReturnType<typeof changeTicketIds>): Promise<ChangeTicketResult> {
  const ticketId = ids.ticket;

  // 1. the ticket, under its derived id
  const { error: ticketError } = await admin.from("lead_tickets").insert({
    id: ticketId,
    lead_id: lead.id,
    created_by: null,
    category: "Changes",
    signature: "Agent",
    priority: "Normal",
    status: "Open",
    title: changeTicketTitle(lead.business_name),
    due_date: null,
  });
  let created = !ticketError;
  if (ticketError) {
    if ((ticketError as { code?: unknown }).code !== "23505") {
      console.error(`[sedcms] the change-request ticket for lead ${lead.id} could not be created`);
      return failed("The ticket could not be created.");
    }
    // made by an earlier delivery: it must be this lead's
    const { data: there } = await admin.from("lead_tickets").select("id, lead_id").eq("id", ticketId).maybeSingle();
    if ((there as { lead_id?: unknown } | null)?.lead_id !== lead.id) {
      console.error(`[sedcms] the change-request ticket ${ticketId} is not lead ${lead.id}'s`);
      return failed("The ticket could not be created.");
    }
    created = false;
  }

  // 2. its items, each under its derived id
  const { error: itemsError } = await admin
    .from("ticket_items")
    .upsert(
      req.items.map((body, sort) => ({ id: ids.items[sort], ticket_id: ticketId, body, sort })),
      { onConflict: "id", ignoreDuplicates: true },
    );
  if (itemsError) {
    console.error(`[sedcms] the change-request items for lead ${lead.id} could not be stored`);
    return failed("The ticket could not be created.");
  }

  // 3. the ticket.created row: the only record of who asked and from which
  // page, so a failed write fails the request, and the retry writes it
  const { error: logError } = await admin.from("activity_log").upsert(
    {
      id: ids.log,
      user_id: null,
      action: "ticket.created",
      entity_type: "ticket",
      entity_id: ticketId,
      new_value: { via: "sedcms", requestId: req.requestId, title: req.title, requestedBy: req.requestedBy, pageUrl: req.pageUrl ?? null },
    },
    { onConflict: "id", ignoreDuplicates: true },
  );
  if (logError) {
    console.error(`[sedcms] the ticket.created row for ticket ${ticketId} was not written`);
    return failed("The ticket could not be created.");
  }

  // 4. the notification, keyed by the ticket: a second delivery adds none
  try {
    await notifyTicket({
      eventKey: "ticket_opened",
      ticketId,
      leadId: lead.id,
      actorId: null,
      title: "Ticket needs assignment",
      body: `Changes — ${lead.business_name} (requested in SED CMS)`,
      nonce: "sedcms",
    });
  } catch {
    // Notification failures must never fail ticket creation.
  }

  // 5. done: a later delivery answers at once
  if (!(await completeRequest(admin, req.requestId, ticketId))) {
    console.warn(`[sedcms] the change request ${req.requestId} was not marked complete (a retry finds every step done)`);
  }
  return { ok: true, ticketId, created };
}
