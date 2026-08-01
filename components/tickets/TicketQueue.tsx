"use client";

import { useEffect, useMemo } from "react";
import Link from "next/link";
import { Search } from "lucide-react";
import type { Ticket, TicketItem, TicketStatus } from "@/lib/tickets/types";
import { TICKET_STATUSES, TICKET_CATEGORIES, TICKET_PRIORITIES } from "@/lib/tickets/types";
import { itemProgress, isOverdue } from "@/lib/tickets/logic";
import { formatDateTime, initials } from "@/lib/leads/format";
import { inputCls } from "@/components/forms/Field";
import { useRealtimeRefresh } from "@/hooks/useRealtimeRefresh";
import { useViewState } from "@/hooks/useViewState";
import MultiSelect from "@/components/common/MultiSelect";
import { Select } from "@/components/common/Select";
import { TicketStatusChip, TicketPriorityBadge, OverdueBadge } from "./TicketStatusChip";
import { cn } from "@/lib/utils";

export type QueueTicket = Ticket & {
  business_name: string | null;
  items: TicketItem[];
  assigned_to_name: string | null;
};

const TICKETS_DEFAULTS = {
  q: "",
  status: "All",
  category: "",
  priority: "",
  assignee: "",
  mine: "",
  lead: "",
  page: "0",
  size: "15",
};

const PAGE_SIZES = [15, 25, 50] as const;

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

  const [ts, setTs] = useViewState(TICKETS_DEFAULTS);
  const status = ts.status || "All";
  const mineOnly = ts.mine === "1";
  const leadFilter = ts.lead || null;
  const q = ts.q.trim().toLowerCase();
  const categorySel = useMemo(() => (ts.category ? ts.category.split(",") : []), [ts.category]);
  const prioritySel = useMemo(() => (ts.priority ? ts.priority.split(",") : []), [ts.priority]);
  const assigneeSel = useMemo(() => (ts.assignee ? ts.assignee.split(",") : []), [ts.assignee]);

  // `initialMine`/`initialLeadId` come from the page's own searchParams read
  // (?mine=1&lead=<id>), which useViewState's deep-link consume already picks
  // up directly since the keys match — this is a defensive seed for
  // callers/cases where the URL doesn't carry them yet but the prop does.
  useEffect(() => {
    const patch: Partial<typeof TICKETS_DEFAULTS> = {};
    if (initialMine && canFilterMine && !ts.mine) patch.mine = "1";
    if (initialLeadId && !ts.lead) patch.lead = initialLeadId;
    if (Object.keys(patch).length) setTs(patch);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Everything except the status tab — so tab counts reflect the other filters.
  const preFiltered = useMemo(() => {
    return tickets.filter((t) => {
      if (leadFilter && t.lead_id !== leadFilter) return false;
      if (mineOnly && t.assigned_to !== currentUserId) return false;
      if (categorySel.length && !categorySel.includes(t.category)) return false;
      if (prioritySel.length && !prioritySel.includes(t.priority)) return false;
      if (assigneeSel.length && !assigneeSel.includes(t.assigned_to ?? "unassigned")) return false;
      if (q) {
        const hay = `${t.title ?? ""} ${t.business_name ?? ""} ${t.assigned_to_name ?? ""} ${t.category}`.toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
  }, [tickets, leadFilter, mineOnly, categorySel, prioritySel, assigneeSel, q, currentUserId]);

  const statusCounts = useMemo(() => {
    const c: Record<string, number> = { All: preFiltered.length };
    for (const s of TICKET_STATUSES) c[s] = 0;
    for (const t of preFiltered) c[t.status] = (c[t.status] ?? 0) + 1;
    return c;
  }, [preFiltered]);

  const filtered = useMemo(
    () => (status === "All" ? preFiltered : preFiltered.filter((t) => t.status === status)),
    [preFiltered, status],
  );

  const assigneeOptions = useMemo(() => {
    const seen = new Map<string, string>();
    for (const t of tickets) {
      if (t.assigned_to) seen.set(t.assigned_to, t.assigned_to_name ?? "—");
    }
    const opts = Array.from(seen, ([value, label]) => ({ value, label })).sort((a, b) =>
      a.label.localeCompare(b.label),
    );
    return [{ value: "unassigned", label: "Unassigned" }, ...opts];
  }, [tickets]);

  const size = Math.max(1, Number(ts.size) || 15);
  const pageCount = Math.max(1, Math.ceil(filtered.length / size));
  const page = Math.min(Math.max(0, Number(ts.page) || 0), pageCount - 1);
  const pageRows = filtered.slice(page * size, page * size + size);

  const leadFilterName = leadFilter
    ? tickets.find((t) => t.lead_id === leadFilter)?.business_name ?? null
    : null;

  const filtersActive =
    q !== "" || status !== "All" || ts.category !== "" || ts.priority !== "" ||
    ts.assignee !== "" || mineOnly || Boolean(leadFilter);

  return (
    <div>
      <div className="mb-5 flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold text-text">Tickets</h1>
          <p className="text-sm text-text-muted mt-0.5">
            {filtered.length} ticket{filtered.length === 1 ? "" : "s"}
          </p>
        </div>
        {leadFilter && (
          <span className="inline-flex items-center gap-1.5 text-xs text-text-muted bg-surface-2 rounded-md px-2.5 py-1.5">
            Filtered to {leadFilterName ?? "lead"}
            <button
              onClick={() => setTs({ lead: "", page: "0" })}
              className="font-medium text-accent-ink hover:underline"
            >
              Clear
            </button>
          </span>
        )}
      </div>

      {/* Status tabs with live counts — the leads page idiom */}
      <div className="mb-3 flex flex-wrap items-center gap-1">
        {["All", ...TICKET_STATUSES].map((s) => (
          <button
            key={s}
            type="button"
            onClick={() => setTs({ status: s, page: "0" })}
            className={cn(
              "rounded-full px-3 py-1.5 text-xs font-medium transition-colors",
              status === s ? "bg-accent text-white" : "bg-surface-2 text-text-muted hover:text-text",
            )}
          >
            {s}
            <span className={cn("ml-1.5 font-mono", status === s ? "text-white/80" : "text-text-faint")}>
              {statusCounts[s] ?? 0}
            </span>
          </button>
        ))}
      </div>

      {/* Toolbar */}
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <div className="relative">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-text-faint" />
          <input
            className={cn(inputCls, "w-56 pl-8")}
            placeholder="Search title, lead, assignee…"
            aria-label="Search tickets"
            value={ts.q}
            onChange={(e) => setTs({ q: e.target.value, page: "0" })}
          />
        </div>
        <MultiSelect
          label="Category"
          options={TICKET_CATEGORIES.map((c) => ({ value: c }))}
          selected={categorySel}
          onChange={(next) => setTs({ category: next.join(","), page: "0" })}
        />
        <MultiSelect
          label="Priority"
          options={TICKET_PRIORITIES.map((p) => ({ value: p }))}
          selected={prioritySel}
          onChange={(next) => setTs({ priority: next.join(","), page: "0" })}
        />
        <MultiSelect
          label="Assignee"
          options={assigneeOptions}
          selected={assigneeSel}
          onChange={(next) => setTs({ assignee: next.join(","), page: "0" })}
        />
        {canFilterMine && (
          <label className="flex items-center gap-1.5 text-sm text-text-muted whitespace-nowrap">
            <input
              type="checkbox"
              className="accent-accent w-4 h-4"
              checked={mineOnly}
              onChange={(e) => setTs({ mine: e.target.checked ? "1" : "", page: "0" })}
            />
            Assigned to me
          </label>
        )}
        {filtersActive && (
          <button
            type="button"
            onClick={() => setTs({ ...TICKETS_DEFAULTS })}
            className="text-xs text-text-muted underline-offset-2 hover:text-text hover:underline"
          >
            Clear filters
          </button>
        )}
      </div>

      {filtered.length === 0 ? (
        <div className="bg-surface border border-border rounded-lg px-4 py-12 text-center text-text-faint">
          No tickets found.
        </div>
      ) : (
        <>
          <div className="overflow-auto rounded-lg border border-border bg-surface">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border text-left text-xs uppercase tracking-wide text-text-faint">
                  <th className="px-3 py-2">Lead</th>
                  <th className="px-3 py-2">Title</th>
                  <th className="px-3 py-2">Category</th>
                  <th className="px-3 py-2">Priority</th>
                  <th className="px-3 py-2">Status</th>
                  <th className="px-3 py-2">Assignee</th>
                  <th className="px-3 py-2">Items</th>
                  <th className="px-3 py-2">Created</th>
                  <th className="px-3 py-2 text-right">&nbsp;</th>
                </tr>
              </thead>
              <tbody>
                {pageRows.map((t) => {
                  const { done, total } = itemProgress(t.items ?? []);
                  const assigneeLabel = t.assigned_to ? t.assigned_to_name ?? "—" : "Unassigned";
                  return (
                    <tr key={t.id} className="border-b border-border last:border-0 hover:bg-surface-2">
                      <td className="px-3 py-2">
                        <Link
                          href={`/leads/${t.lead_id}`}
                          className="font-medium text-text hover:text-accent-ink"
                          data-track="Open lead"
                          data-lead-id={t.lead_id}
                        >
                          {t.business_name ?? "—"}
                        </Link>
                      </td>
                      <td className="max-w-56 truncate px-3 py-2 text-text-muted">{t.title ?? "—"}</td>
                      <td className="px-3 py-2 text-xs text-text-muted">{t.category}</td>
                      <td className="px-3 py-2">
                        <span className="inline-flex items-center gap-1.5">
                          <TicketPriorityBadge priority={t.priority} />
                          {isOverdue(t.due_date, t.status, new Date()) && <OverdueBadge />}
                        </span>
                      </td>
                      <td className="px-3 py-2"><TicketStatusChip status={t.status} /></td>
                      <td className="px-3 py-2">
                        <span className="inline-flex items-center gap-1.5 text-xs text-text-muted whitespace-nowrap">
                          <span className="grid h-5 w-5 place-items-center rounded-full bg-accent-soft text-[9px] font-semibold text-accent-ink">
                            {initials(t.assigned_to ? assigneeLabel : "Unassigned")}
                          </span>
                          {assigneeLabel}
                        </span>
                      </td>
                      <td className="px-3 py-2 text-xs text-text-faint">{done}/{total}</td>
                      <td className="px-3 py-2 text-xs text-text-muted whitespace-nowrap">{formatDateTime(t.created_at)}</td>
                      <td className="px-3 py-2 text-right">
                        <Link
                          href={`/tickets/${t.id}`}
                          className="rounded px-2 py-1 text-xs font-medium text-accent-ink hover:bg-accent-soft"
                        >
                          View
                        </Link>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          <div className="mt-3 flex flex-wrap items-center justify-between gap-3 text-sm">
            <label className="flex items-center gap-2 text-text-muted">
              Rows per page
              <Select
                className={inputCls + " w-auto"}
                value={String(size)}
                onChange={(e) => setTs({ size: e.target.value, page: "0" })}
              >
                {PAGE_SIZES.map((s) => (
                  <option key={s} value={s}>{s}</option>
                ))}
              </Select>
            </label>
            <div className="flex items-center gap-2">
              <span className="text-text-muted">
                Page {page + 1} of {pageCount}
              </span>
              <button
                type="button"
                disabled={page === 0}
                onClick={() => setTs({ page: String(page - 1) })}
                className="rounded-md border border-border px-2.5 py-1.5 text-xs text-text-muted hover:text-text disabled:opacity-40"
              >
                Prev
              </button>
              <button
                type="button"
                disabled={page >= pageCount - 1}
                onClick={() => setTs({ page: String(page + 1) })}
                className="rounded-md border border-border px-2.5 py-1.5 text-xs text-text-muted hover:text-text disabled:opacity-40"
              >
                Next
              </button>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
