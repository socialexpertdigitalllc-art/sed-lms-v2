import type { TicketPriority, TicketStatus } from "@/lib/tickets/types";

/** Tailwind classes for each ticket status chip (soft bg + fg), reusing the app's status tokens. */
const TICKET_STATUS_CLS: Record<TicketStatus, string> = {
  Open: "bg-surface-2 text-text-muted",
  Assigned: "bg-longterm-bg text-longterm-fg",
  "In Progress": "bg-notready-bg text-notready-fg",
  Resolved: "bg-ready-bg text-ready-fg",
};

export function TicketStatusChip({ status }: { status: TicketStatus }) {
  const cls = TICKET_STATUS_CLS[status] ?? "bg-surface-2 text-text-muted";
  return (
    <span className={"rounded-md px-2 py-0.5 text-xs font-medium " + cls}>{status}</span>
  );
}

/** Tailwind classes for each ticket priority badge (soft bg + fg). */
const TICKET_PRIORITY_CLS: Record<TicketPriority, string> = {
  Low: "bg-surface-2 text-text-faint",
  Normal: "bg-surface-2 text-text-muted",
  High: "bg-dropped-bg text-dropped-fg",
};

export function TicketPriorityBadge({ priority }: { priority: TicketPriority }) {
  const cls = TICKET_PRIORITY_CLS[priority] ?? "bg-surface-2 text-text-muted";
  return (
    <span className={"rounded-md px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide " + cls}>
      {priority}
    </span>
  );
}

export function OverdueBadge() {
  return (
    <span className="inline-flex items-center rounded-full bg-dropped-bg text-dropped-fg px-2 py-0.5 text-[11px] font-medium">
      Overdue
    </span>
  );
}
