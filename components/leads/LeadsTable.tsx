"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import {
  useReactTable,
  getCoreRowModel,
  getFilteredRowModel,
  getSortedRowModel,
  getPaginationRowModel,
  flexRender,
  type ColumnDef,
  type SortingState,
  type ColumnFiltersState,
} from "@tanstack/react-table";
import type { Lead } from "@/lib/leads/types";
import { SITE_TYPES } from "@/lib/leads/types";
import { visibleStatuses } from "@/lib/leads/categories";
import { formatCurrency, formatDate, formatDateTime, initials } from "@/lib/leads/format";
import { StatusPill } from "./StatusPill";
import { StatusChangeModal } from "./StatusChangeModal";
import { usePermissions } from "@/hooks/usePermissions";
import { useRealtimeRefresh } from "@/hooks/useRealtimeRefresh";
import { toCsv } from "@/lib/leads/csv";

export function LeadsTable({
  leads,
  agentNameById,
}: {
  leads: Lead[];
  agentNameById: Record<string, string>;
}) {
  const { has, all } = usePermissions();
  const visible = useMemo(() => visibleStatuses(all), [all]);
  useRealtimeRefresh("leads");
  const canCreate = has("leads.create");
  const canChangeStatus = has("leads.status_change");
  const canExport = has("leads.export");

  function exportCsv() {
    const cols = [
      { key: "created_at", label: "Date" },
      { key: "business_name", label: "Business" },
      { key: "business_email", label: "Email" },
      { key: "business_phone", label: "Phone" },
      { key: "status", label: "Status" },
      { key: "agent", label: "Agent" },
      { key: "site_type", label: "Type" },
      { key: "price_quoted", label: "Price" },
      { key: "rating", label: "Rating" },
      { key: "follow_up_time", label: "Follow-up" },
    ];
    const rows = table.getFilteredRowModel().rows.map((r) => ({
      ...r.original,
      agent: (r.original.agent_id && agentNameById[r.original.agent_id]) || "Unassigned",
    }));
    const blob = new Blob([toCsv(rows, cols)], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    const d = new Date();
    const stamp = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
    a.href = url;
    a.download = `leads_${stamp}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  const [globalFilter, setGlobalFilter] = useState("");
  const [sorting, setSorting] = useState<SortingState>([{ id: "created_at", desc: true }]);
  const [columnFilters, setColumnFilters] = useState<ColumnFiltersState>([]);
  const [statusTab, setStatusTab] = useState<string>("All");
  const [modalLead, setModalLead] = useState<Lead | null>(null);

  const statusCounts = useMemo(() => {
    const c: Record<string, number> = { All: leads.length };
    for (const s of visible) c[s] = 0;
    for (const l of leads) if (l.status in c) c[l.status]++;
    return c;
  }, [leads, visible]);

  const agentOptions = useMemo(() => {
    const set = new Set<string>();
    for (const l of leads) set.add((l.agent_id && agentNameById[l.agent_id]) || "Unassigned");
    return [...set].sort();
  }, [leads, agentNameById]);

  const columns = useMemo<ColumnDef<Lead>[]>(
    () => [
      {
        accessorKey: "created_at",
        header: "Date",
        cell: (c) => <span className="text-text-muted whitespace-nowrap">{formatDate(c.getValue<string>())}</span>,
      },
      {
        accessorKey: "status",
        header: "Status",
        filterFn: "equalsString",
        cell: (c) => <StatusPill status={c.getValue<string>()} />,
      },
      {
        id: "agent",
        accessorFn: (row) => (row.agent_id && agentNameById[row.agent_id]) || "Unassigned",
        header: "Agent",
        filterFn: "equalsString",
        cell: (c) => (
          <span className="inline-flex items-center gap-2 whitespace-nowrap">
            <span className="w-5 h-5 rounded-full bg-accent-soft text-accent-ink grid place-items-center text-[9px] font-semibold">
              {initials(c.getValue<string>())}
            </span>
            <span className="text-text">{c.getValue<string>()}</span>
          </span>
        ),
      },
      {
        accessorKey: "site_type",
        header: "Type",
        filterFn: "equalsString",
        cell: (c) => <span className="text-text-muted">{c.getValue<string>() ?? "—"}</span>,
      },
      {
        accessorKey: "business_name",
        header: "Business",
        cell: (c) => (
          <div className="min-w-0">
            <div className="font-medium text-text truncate">{c.row.original.business_name}</div>
            <div className="text-xs text-text-faint truncate">{c.row.original.business_email ?? ""}</div>
          </div>
        ),
      },
      {
        accessorKey: "business_phone",
        header: "Phone",
        cell: (c) => <span className="text-text-muted font-mono text-xs whitespace-nowrap">{c.getValue<string>() ?? "—"}</span>,
      },
      {
        accessorKey: "price_quoted",
        header: "Price",
        cell: (c) => <span className="text-text font-mono whitespace-nowrap">{formatCurrency(c.getValue<number | null>())}</span>,
      },
      {
        accessorKey: "follow_up_time",
        header: "Follow-up",
        cell: (c) => <span className="text-text-muted whitespace-nowrap">{formatDateTime(c.getValue<string | null>())}</span>,
      },
      {
        accessorKey: "rating",
        header: "Rating",
        cell: (c) => {
          const r = c.getValue<number | null>();
          return <span className="text-text-muted font-mono">{r ? `${r}/10` : "—"}</span>;
        },
      },
      {
        id: "actions",
        header: "",
        enableSorting: false,
        cell: (c) => (
          <div className="flex items-center justify-end gap-1 whitespace-nowrap">
            <Link
              href={`/leads/${c.row.original.id}`}
              className="text-xs font-medium text-accent-ink px-2 py-1 rounded hover:bg-accent-soft"
              data-track="Open lead"
              data-lead-id={c.row.original.id}
            >
              Detail
            </Link>
            {canChangeStatus && (
              <button
                onClick={() => setModalLead(c.row.original)}
                className="text-xs font-medium text-text-muted px-2 py-1 rounded border border-border hover:bg-surface-2"
              >
                Status
              </button>
            )}
          </div>
        ),
      },
    ],
    [agentNameById, canChangeStatus]
  );

  const table = useReactTable({
    data: leads,
    columns,
    state: { globalFilter, sorting, columnFilters },
    onGlobalFilterChange: setGlobalFilter,
    onSortingChange: setSorting,
    onColumnFiltersChange: setColumnFilters,
    globalFilterFn: (row, _col, value) => {
      const q = String(value).toLowerCase();
      const l = row.original;
      const agent = (l.agent_id && agentNameById[l.agent_id]) || "";
      return [l.business_name, l.business_email, agent, l.status, l.business_phone]
        .some((v) => (v ?? "").toString().toLowerCase().includes(q));
    },
    getCoreRowModel: getCoreRowModel(),
    getFilteredRowModel: getFilteredRowModel(),
    getSortedRowModel: getSortedRowModel(),
    getPaginationRowModel: getPaginationRowModel(),
    initialState: { pagination: { pageSize: 15 } },
  });

  function selectStatus(tab: string) {
    setStatusTab(tab);
    table.getColumn("status")?.setFilterValue(tab === "All" ? undefined : tab);
  }

  const rows = table.getRowModel().rows;
  const filteredCount = table.getFilteredRowModel().rows.length;

  return (
    <div>
      {/* header */}
      <div className="flex items-center justify-between mb-4">
        <div>
          <h1 className="text-xl font-semibold text-text">Leads</h1>
          <p className="text-sm text-text-muted mt-0.5">{filteredCount} of {leads.length} shown</p>
        </div>
        {canCreate && (
          <Link href="/leads/new" className="bg-accent text-white rounded-md px-4 py-2 text-sm font-semibold hover:bg-accent-ink transition-colors">
            + New Lead
          </Link>
        )}
      </div>

      {/* status tabs */}
      <div className="flex flex-wrap gap-1 mb-3">
        {["All", ...visible].map((tab) => (
          <button
            key={tab}
            onClick={() => selectStatus(tab)}
            className={
              "text-sm rounded-md px-3 py-1.5 font-medium transition-colors " +
              (statusTab === tab ? "bg-accent-soft text-accent-ink" : "text-text-muted hover:bg-surface-2")
            }
          >
            {tab}
            <span className="ml-1.5 text-xs font-mono text-text-faint">{statusCounts[tab] ?? 0}</span>
          </button>
        ))}
      </div>

      {/* toolbar */}
      <div className="flex flex-wrap items-center gap-2 mb-3">
        <input
          value={globalFilter}
          onChange={(e) => setGlobalFilter(e.target.value)}
          placeholder="Search business, email, agent…"
          className="flex-1 min-w-[220px] px-3 py-2 rounded-md border border-border bg-surface text-sm outline-none focus:ring-2 focus:ring-accent"
        />
        <select
          onChange={(e) => table.getColumn("agent")?.setFilterValue(e.target.value || undefined)}
          className="px-3 py-2 rounded-md border border-border bg-surface text-sm text-text-muted outline-none focus:ring-2 focus:ring-accent"
        >
          <option value="">All agents</option>
          {agentOptions.map((a) => <option key={a} value={a}>{a}</option>)}
        </select>
        <select
          onChange={(e) => table.getColumn("site_type")?.setFilterValue(e.target.value || undefined)}
          className="px-3 py-2 rounded-md border border-border bg-surface text-sm text-text-muted outline-none focus:ring-2 focus:ring-accent"
        >
          <option value="">All types</option>
          {SITE_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
        </select>
        {canExport && (
          <button onClick={exportCsv} className="px-3 py-2 rounded-md border border-border bg-surface text-sm text-text-muted hover:bg-surface-2 whitespace-nowrap">
            ↓ Export CSV
          </button>
        )}
      </div>

      {/* table */}
      <div className="bg-surface border border-border rounded-lg overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-surface-2">
              {table.getHeaderGroups().map((hg) => (
                <tr key={hg.id} className="border-b border-border">
                  {hg.headers.map((h) => (
                    <th
                      key={h.id}
                      onClick={h.column.getCanSort() ? h.column.getToggleSortingHandler() : undefined}
                      className={
                        "text-left text-[10px] uppercase tracking-wide text-text-faint font-semibold px-4 py-3 whitespace-nowrap " +
                        (h.column.getCanSort() ? "cursor-pointer select-none hover:text-text-muted" : "")
                      }
                    >
                      {flexRender(h.column.columnDef.header, h.getContext())}
                      {{ asc: " ↑", desc: " ↓" }[h.column.getIsSorted() as string] ?? ""}
                    </th>
                  ))}
                </tr>
              ))}
            </thead>
            <tbody>
              {rows.length === 0 ? (
                <tr><td colSpan={columns.length} className="px-4 py-12 text-center text-text-faint">No leads match your filters.</td></tr>
              ) : (
                rows.map((row) => (
                  <tr key={row.id} className="border-b border-border-subtle last:border-0 hover:bg-surface-2">
                    {row.getVisibleCells().map((cell) => (
                      <td key={cell.id} className="px-4 py-2.5 align-middle max-w-[260px]">
                        {flexRender(cell.column.columnDef.cell, cell.getContext())}
                      </td>
                    ))}
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* pagination */}
      {table.getPageCount() > 1 && (
        <div className="flex items-center justify-between mt-3 text-sm text-text-muted">
          <span className="font-mono text-xs">
            Page {table.getState().pagination.pageIndex + 1} of {table.getPageCount()}
          </span>
          <div className="flex gap-2">
            <button
              onClick={() => table.previousPage()}
              disabled={!table.getCanPreviousPage()}
              className="px-3 py-1.5 rounded-md border border-border hover:bg-surface-2 disabled:opacity-40"
            >
              Previous
            </button>
            <button
              onClick={() => table.nextPage()}
              disabled={!table.getCanNextPage()}
              className="px-3 py-1.5 rounded-md border border-border hover:bg-surface-2 disabled:opacity-40"
            >
              Next
            </button>
          </div>
        </div>
      )}

      {modalLead && (
        <StatusChangeModal
          leadId={modalLead.id}
          current={modalLead.status}
          businessName={modalLead.business_name}
          open={true}
          onClose={() => setModalLead(null)}
        />
      )}
    </div>
  );
}
