import type { TicketStatus, TicketItem, TicketPriority } from "@/lib/tickets/types";

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
// Deliberately NOT aliased to follow-up eligibility: closed clients still file
// change requests, while follow-ups make no sense on a closed lead.
export const TICKET_ELIGIBLE_STATUSES = ["Ready", "Long Term", "Closed"] as const;
export function isTicketEligible(leadStatus: string): boolean {
  return (TICKET_ELIGIBLE_STATUSES as readonly string[]).includes(leadStatus);
}
export function dedupKey(event: string, ticketId: string, userId: string, nonce: string): string {
  return `${event}:${ticketId}:${userId}:${nonce}`;
}
export function slaDueDate(priority: TicketPriority, sla: Record<TicketPriority, number>, createdAtISO: string): string {
  return new Date(new Date(createdAtISO).getTime() + (sla[priority] ?? 0) * 3_600_000).toISOString();
}
export function bumpPriority(p: TicketPriority): TicketPriority {
  return p === "Low" ? "Normal" : p === "Normal" ? "High" : "High";
}
export function isOverdue(dueDate: string | null, status: TicketStatus, now: Date): boolean {
  return !!dueDate && status !== "Resolved" && new Date(dueDate).getTime() < now.getTime();
}
export function retentionEligible(status: TicketStatus, resolvedAt: string | null, retentionDays: number, now: Date): boolean {
  if (status !== "Resolved" || retentionDays <= 0 || !resolvedAt) return false;
  return new Date(resolvedAt).getTime() < now.getTime() - retentionDays * 86_400_000;
}
