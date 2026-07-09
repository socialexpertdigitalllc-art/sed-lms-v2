import { isFollowUpEligible } from "@/lib/leads/followups";
import type { TicketStatus, TicketItem } from "@/lib/tickets/types";

const ALLOWED: Record<TicketStatus, TicketStatus[]> = {
  "Open": ["Assigned"],
  "Assigned": ["Assigned", "In Progress"],
  "In Progress": ["Resolved"],
  "Resolved": ["In Progress"],
};
export function canTransition(from: TicketStatus, to: TicketStatus): boolean {
  return ALLOWED[from]?.includes(to) ?? false;
}
export function itemProgress(items: Pick<TicketItem, "is_done">[]): { done: number; total: number } {
  return { done: items.filter((i) => i.is_done).length, total: items.length };
}
export function isTicketEligible(leadStatus: string): boolean {
  return isFollowUpEligible(leadStatus);
}
export function dedupKey(event: string, ticketId: string, userId: string, nonce: string): string {
  return `${event}:${ticketId}:${userId}:${nonce}`;
}
