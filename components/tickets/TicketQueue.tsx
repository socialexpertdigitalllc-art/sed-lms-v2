"use client";

import { useEffect, useMemo } from "react";
import Link from "next/link";
import type { Ticket, TicketItem, TicketStatus } from "@/lib/tickets/types";
import { TICKET_STATUSES } from "@/lib/tickets/types";
import { itemProgress, isOverdue } from "@/lib/tickets/logic";
import { formatDateTime, initials } from "@/lib/leads/format";
import { inputCls } from "@/components/forms/Field";
import { useRealtimeRefresh } from "@/hooks/useRealtimeRefresh";
import { useUrlState } from "@/hooks/useUrlState";
import { TicketStatusChip, TicketPriorityBadge, OverdueBadge } from "./TicketStatusChip";

export type QueueTicket = Ticket & {
  business_name: string | null;
  items: TicketItem[];
  assigned_to_name: string | null;
};

const TICKETS_DEFAULTS = { status: "", mine: "", lead: "" };

export function TicketQueue({
  tickets,
  canAssign,
  canResolve,
  currentUserId,
  initialLeadId,
  initialMine,
}: {
  tickets: QueueTicket[];
  canAssign: boolean;
  canResolve: boolean;
  currentUserId: string;
  initialLeadId?: string | null;
  initialMine?: boolean;
}) {
  useRealtimeRefresh("lead_tickets");

  // Only assign/resolve-capable roles (tech, admin, management) are ever
  // assignees, so the "assigned to me" filter is only meaningful for them.
  const canFilterMine = canAssign || canResolve;

  const [ts, setTs] = useUrlState(TICKETS_DEFAULTS);
  const statusFilter = ts.status as TicketStatus | "";
  const mineOnly = ts.mine === "1";
  const leadFilter = ts.lead || null;

  // `initialMine`/`initialLeadId` come from the page's own searchParams read
  // (?mine=1&lead=<id>), which useUrlState's parse already picks up directly
  // since the keys match — this is a defensive seed for callers/cases where
  // the URL doesn't carry them yet but the prop does.
  useEffect(() => {
    const patch: Partial<typeof TICKETS_DEFAULTS> = {};
    if (initialMine && canFilterMine && !ts.mine) patch.mine = "1";
    if (initialLeadId && !ts.lead) patch.lead = initialLeadId;
    if (Object.keys(patch).length) setTs(patch);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const filtered = useMemo(() => {
    return tickets.filter((t) => {
      if (leadFilter && t.lead_id !== leadFilter) return false;
      if (statusFilter && t.status !== statusFilter) return false;
      if (mineOnly && t.assigned_to !== currentUserId) return false;
      return true;
    });
  }, [tickets, leadFilter, statusFilter, mineOnly, currentUserId]);

  const groups = useMemo(() => {
    const g: Record<TicketStatus, QueueTicket[]> = {
      Open: [],
      Assigned: [],
      "In Progress": [],
      Resolved: [],
    };
    for (const t of filtered) g[t.status]?.push(t);
    return g;
  }, [filtered]);

  const leadFilterName = leadFilter
    ? tickets.find((t) => t.lead_id === leadFilter)?.business_name ?? null
    : null;

  const row = (t: QueueTicket) => {
    const { done, total } = itemProgress(t.items ?? []);
    const assigneeLabel = t.assigned_to ? t.assigned_to_name ?? "—" : "Unassigned";
    return (
      <div
        key={t.id}
        className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-border bg-surface px-4 py-3"
      >
        <div className="flex min-w-0 items-center gap-3">
          <Link
            href={`/leads/${t.lead_id}`}
            className="font-medium text-text truncate hover:text-accent-ink"
            data-track="Open lead"
            data-lead-id={t.lead_id}
          >
            {t.business_name ?? "—"}
          </Link>
          <span className="text-xs text-text-muted whitespace-nowrap">{t.category}</span>
          <TicketPriorityBadge priority={t.priority} />
        </div>

        <div className="flex items-center gap-2 whitespace-nowrap">
          <TicketStatusChip status={t.status} />
          {isOverdue(t.due_date, t.status, new Date()) && <OverdueBadge />}
          <span className="inline-flex items-center gap-1.5 text-text-muted text-xs">
            <span className="w-5 h-5 rounded-full bg-accent-soft text-accent-ink grid place-items-center text-[9px] font-semibold">
              {initials(t.assigned_to ? assigneeLabel : "Unassigned")}
            </span>
            {assigneeLabel}
          </span>
        </div>

        <div className="flex items-center gap-3 whitespace-nowrap">
          <span className="text-xs text-text-faint">
            {done}/{total}
          </span>
          <span className="text-xs text-text-muted">{formatDateTime(t.created_at)}</span>
          <Link
            href={`/tickets/${t.id}`}
            className="text-xs font-medium text-accent-ink px-2 py-1 rounded hover:bg-accent-soft"
          >
            View
          </Link>
        </div>
      </div>
    );
  };

  const section = (label: string, items: QueueTicket[]) => {
    if (items.length === 0) return null;
    return (
      <section key={label} className="mb-6">
        <div className="flex items-center gap-2 mb-2">
          <h2 className="text-sm font-semibold text-text">{label}</h2>
          <span className="text-xs font-mono text-text-faint">{items.length}</span>
        </div>
        <div className="flex flex-col gap-2">{items.map(row)}</div>
      </section>
    );
  };

  const isEmpty = filtered.length === 0;

  return (
    <div>
      <div className="mb-5 flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold text-text">Tickets</h1>
          <p className="text-sm text-text-muted mt-0.5">
            {filtered.length} ticket{filtered.length === 1 ? "" : "s"}
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-3">
          {leadFilter && (
            <span className="inline-flex items-center gap-1.5 text-xs text-text-muted bg-surface-2 rounded-md px-2.5 py-1.5">
              Filtered to {leadFilterName ?? "lead"}
              <button
                onClick={() => setTs({ lead: "" })}
                className="font-medium text-accent-ink hover:underline"
              >
                Clear
              </button>
            </span>
          )}
          {canFilterMine && (
            <label className="flex items-center gap-1.5 text-sm text-text-muted whitespace-nowrap">
              <input
                type="checkbox"
                className="accent-accent w-4 h-4"
                checked={mineOnly}
                onChange={(e) => setTs({ mine: e.target.checked ? "1" : "" })}
              />
              Assigned to me
            </label>
          )}
          <select
            className={inputCls + " w-auto"}
            value={statusFilter}
            onChange={(e) => setTs({ status: e.target.value })}
          >
            <option value="">All statuses</option>
            {TICKET_STATUSES.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
        </div>
      </div>

      {isEmpty ? (
        <div className="bg-surface border border-border rounded-lg px-4 py-12 text-center text-text-faint">
          No tickets found.
        </div>
      ) : (
        TICKET_STATUSES.map((s) => section(s, groups[s]))
      )}
    </div>
  );
}
