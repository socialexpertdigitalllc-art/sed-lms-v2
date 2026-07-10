"use client";

import { useState } from "react";
import Link from "next/link";
import type { Ticket, TicketPriority } from "@/lib/tickets/types";
import { itemProgress, isTicketEligible, isOverdue } from "@/lib/tickets/logic";
import { usePermissions } from "@/hooks/usePermissions";
import { TicketStatusChip, TicketPriorityBadge, OverdueBadge } from "./TicketStatusChip";
import { TicketModal } from "./TicketModal";

export function TicketsCard({
  leadId,
  leadStatus,
  tickets,
  sla,
}: {
  leadId: string;
  leadStatus: string;
  tickets: Ticket[];
  sla: Record<TicketPriority, number>;
}) {
  const { has } = usePermissions();
  const [open, setOpen] = useState(false);

  return (
    <div className="rounded-2xl border border-border bg-surface shadow-sm p-5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-sm font-semibold text-text">Tickets</h2>
        {has("tickets.create") && isTicketEligible(leadStatus) && (
          <button
            onClick={() => setOpen(true)}
            className="bg-accent text-white text-xs font-semibold rounded-md px-3 py-1.5 hover:bg-accent-ink"
          >
            New Ticket
          </button>
        )}
      </div>

      <div className="mt-4">
        {tickets.length === 0 ? (
          <p className="text-sm text-text-muted">No tickets yet.</p>
        ) : (
          <div className="space-y-2">
            {tickets.slice(0, 3).map((t) => (
              <TicketRow key={t.id} ticket={t} />
            ))}
          </div>
        )}
      </div>

      {tickets.length > 0 && (
        <Link
          href={`/leads/${leadId}/tickets`}
          className="mt-4 block w-full text-center text-xs text-text-muted hover:text-text rounded-md border border-border px-3 py-2 hover:bg-surface-2 transition-colors"
        >
          View all tickets ({tickets.length})
        </Link>
      )}

      {open && <TicketModal leadId={leadId} sla={sla} onClose={() => setOpen(false)} />}
    </div>
  );
}

function TicketRow({ ticket }: { ticket: Ticket }) {
  const { done, total } = itemProgress(ticket.items ?? []);
  const snippet = ticket.title || ticket.items?.[0]?.body || "—";
  return (
    <Link
      href={`/tickets/${ticket.id}`}
      className="block rounded-xl border border-border bg-surface hover:bg-surface-2 transition-colors px-3 py-2.5"
    >
      <div className="flex items-center gap-2 flex-wrap">
        <TicketStatusChip status={ticket.status} />
        <span className="text-xs text-text-muted">{ticket.category}</span>
        <TicketPriorityBadge priority={ticket.priority} />
        {isOverdue(ticket.due_date, ticket.status, new Date()) && <OverdueBadge />}
        <span className="text-[11px] text-text-faint ml-auto">
          {done}/{total} done
        </span>
      </div>
      <p className="text-xs text-text-muted mt-1 truncate">{snippet}</p>
    </Link>
  );
}
