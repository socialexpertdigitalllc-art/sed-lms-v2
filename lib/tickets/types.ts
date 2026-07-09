export const TICKET_CATEGORIES = ["Changes", "Improvement"] as const;
export const TICKET_SIGNATURES = ["Agent", "Closer"] as const;
export const TICKET_PRIORITIES = ["Low", "Normal", "High"] as const;
export const TICKET_STATUSES = ["Open", "Assigned", "In Progress", "Resolved"] as const;
export type TicketCategory = (typeof TICKET_CATEGORIES)[number];
export type TicketSignature = (typeof TICKET_SIGNATURES)[number];
export type TicketPriority = (typeof TICKET_PRIORITIES)[number];
export type TicketStatus = (typeof TICKET_STATUSES)[number];

export interface TicketItem {
  id: string; ticket_id: string; body: string; is_done: boolean;
  done_at: string | null; done_by: string | null; sort: number; created_at: string;
  attachments?: TicketAttachment[];
}
export interface Ticket {
  id: string; lead_id: string; created_by: string | null;
  category: TicketCategory; signature: TicketSignature; priority: TicketPriority;
  status: TicketStatus; assigned_to: string | null; title: string | null;
  resolution_note: string | null; created_at: string; updated_at: string;
  resolved_at: string | null; resolved_by: string | null;
  due_date: string | null; escalated_at: string | null;
  items?: TicketItem[];
}
export interface TicketAttachment {
  id: string; item_id: string; path: string; mime: string | null; size: number | null; url?: string;
}
