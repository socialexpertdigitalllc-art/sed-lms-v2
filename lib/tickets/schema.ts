import { z } from "zod";
import { TICKET_CATEGORIES, TICKET_SIGNATURES, TICKET_PRIORITIES } from "@/lib/tickets/types";

export const createTicketSchema = z.object({
  category: z.enum(TICKET_CATEGORIES),
  signature: z.enum(TICKET_SIGNATURES),
  priority: z.enum(TICKET_PRIORITIES).default("Normal"),
  title: z.string().trim().max(200).nullable().optional(),
  items: z.array(z.string().trim().min(1)).min(1, "Add at least one change item"),
  due_date: z.string().datetime().nullable().optional(),
});
export const ticketActionSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("assign"), assigned_to: z.string().uuid() }),
  z.object({ action: z.literal("start") }),
  z.object({ action: z.literal("resolve"), resolution_note: z.string().trim().min(1) }),
  z.object({ action: z.literal("reopen") }),
]);
export type CreateTicketInput = z.infer<typeof createTicketSchema>;
