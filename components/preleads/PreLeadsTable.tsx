"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
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
import type { PreLead } from "@/lib/preleads/types";
import { LEAD_CATEGORIES, PRELEAD_STATUSES } from "@/lib/preleads/types";
import { formatCurrency, formatDateTime } from "@/lib/leads/format";
import { CategoryPill, PreLeadStatusPill } from "./CategoryPill";
import { QuickViewModal } from "./QuickViewModal";
import { FollowUpModal } from "./FollowUpModal";
import { usePermissions } from "@/hooks/usePermissions";
import { useRealtimeRefresh } from "@/hooks/useRealtimeRefresh";

type FollowFilter = "all" | "due" | "past";
type Modal = { mode: "view" | "follow" | null; lead: PreLead | null };

export function PreLeadsTable({
  preLeads,
  agentNameById,
}: {
  preLeads: PreLead[];
  agentNameById: Record<string, string>;
}) {
  const router = useRouter();
  const { has } = usePermissions();
  useRealtimeRefresh("pre_leads");
  const canCreate = has("pre_leads.create");
  const canFollowUp = has("pre_leads.followup");
  const canDelete = has("pre_leads.delete");

  const [globalFilter, setGlobalFilter] = useState("");
  const [sorting, setSorting] = useState<SortingState>([{ id: "created_at", desc: true }]);
  const [columnFilters, setColumnFilters] = useState<ColumnFiltersState>([]);
  const [categoryTab, setCategoryTab] = useState<string>("All");
  const [followFilter, setFollowFilter] = useState<FollowFilter>("all");
  const [modal, setModal] = useState<Modal>({ mode: null, lead: null });

  // Follow-up quick filter applied BEFORE building the table.
  const data = useMemo(() => {
    if (followFilter === "all") return preLeads;
    const now = Date.now();
    const in24h = now + 24 * 60 * 60 * 1000;
    return preLeads.filter((l) => {
      const active = l.status !== "Closed" && l.status !== "Dropped";
      if (!active || !l.follow_up_time) return false;
      const t = new Date(l.follow_up_time).getTime();
      if (Number.isNaN(t)) return false;
      if (followFilter === "due") return t >= now && t <= in24h;
      return t < now; // past
    });
  }, [preLeads, followFilter]);

  const categoryCounts = useMemo(() => {
    const c: Record<string, number> = { All: preLeads.length };
    for (const cat of LEAD_CATEGORIES) c[cat] = 0;
    for (const l of preLeads) if (l.lead_category in c) c[l.lead_category]++;
    return c;
  }, [preLeads]);

  const columns = useMemo<ColumnDef<PreLead>[]>(
    () => [
      {
        accessorKey: "business_name",
        header: "Business",
        cell: (c) => (
          <div className="min-w-0">
            <div className="font-semibold text-text truncate">{c.row.original.business_name}</div>
            <div className="text-xs text-text-faint truncate">{c.row.original.owner_name ?? ""}</div>
          </div>
        ),
      },
      {
        accessorKey: "lead_category",
        header: "Category",
        filterFn: "equalsString",
        cell: (c) => <CategoryPill category={c.getValue<string>()} />,
      },
      {
        accessorKey: "status",
        header: "Status",
        filterFn: "equalsString",
        cell: (c) => <PreLeadStatusPill status={c.getValue<string>()} />,
      },
      {
        accessorKey: "service_type",
        header: "Service type",
        cell: (c) => <span className="text-text-muted">{c.getValue<string | null>() ?? "—"}</span>,
      },
      {
        accessorKey: "pricing",
        header: "Pricing",
        cell: (c) => (
          <span className="text-text font-mono whitespace-nowrap">{formatCurrency(c.getValue<number | null>())}</span>
        ),
      },
      {
        accessorKey: "follow_up_time",
        header: "Follow-up",
        cell: (c) => (
          <span className="text-text-muted whitespace-nowrap">{formatDateTime(c.getValue<string | null>())}</span>
        ),
      },
      {
        id: "actions",
        header: "",
        enableSorting: false,
        cell: (c) => {
          const lead = c.row.original;
          return (
            <div className="flex items-center justify-end gap-1 whitespace-nowrap">
              <button
                onClick={() => setModal({ mode: "view", lead })}
                className="text-xs font-medium text-accent-ink px-2 py-1 rounded hover:bg-accent-soft"
              >
                View
              </button>
              {canFollowUp && (
                <button
                  onClick={() => setModal({ mode: "follow", lead })}
                  className="text-xs font-medium text-text-muted px-2 py-1 rounded border border-border hover:bg-surface-2"
                >
                  Follow-up
                </button>
              )}
              {canDelete && (
                <button
                  onClick={() => remove(lead)}
                  className="text-xs font-medium text-dropped-fg px-2 py-1 rounded border border-border hover:bg-dropped-bg"
                >
                  Delete
                </button>
              )}
            </div>
          );
        },
      },
    ],
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [canFollowUp, canDelete]
  );

  const table = useReactTable({
    data,
    columns,
    state: { globalFilter, sorting, columnFilters },
    onGlobalFilterChange: setGlobalFilter,
    onSortingChange: setSorting,
    onColumnFiltersChange: setColumnFilters,
    globalFilterFn: (row, _col, value) => {
      const q = String(value).toLowerCase();
      const l = row.original;
      return [l.business_name, l.owner_name, l.email, l.phone_number].some((v) =>
        (v ?? "").toString().toLowerCase().includes(q)
      );
    },
    getCoreRowModel: getCoreRowModel(),
    getFilteredRowModel: getFilteredRowModel(),
    getSortedRowModel: getSortedRowModel(),
    getPaginationRowModel: getPaginationRowModel(),
    initialState: { pagination: { pageSize: 15 } },
  });

  function selectCategory(tab: string) {
    setCategoryTab(tab);
    table.getColumn("lead_category")?.setFilterValue(tab === "All" ? undefined : tab);
  }

  async function remove(lead: PreLead) {
    if (!window.confirm(`Delete pre-lead “${lead.business_name}”? This cannot be undone.`)) return;
    const res = await fetch(`/api/pre-leads/${lead.id}`, { method: "DELETE" });
    if (res.ok) router.refresh();
  }

  const rows = table.getRowModel().rows;
  const filteredCount = table.getFilteredRowModel().rows.length;

  return (
    <div>
      {/* header */}
      <div className="flex items-center justify-between mb-4">
        <div>
          <h1 className="text-xl font-semibold text-text">All Pre-Leads</h1>
          <p className="text-sm text-text-muted mt-0.5">{filteredCount} shown</p>
        </div>
        {canCreate && (
          <Link
            href="/pre-leads/new"
            className="bg-accent text-white rounded-md px-4 py-2 text-sm font-semibold hover:bg-accent-ink transition-colors"
          >
            + New Pre-Lead
          </Link>
        )}
      </div>

      {/* category tabs */}
      <div className="flex flex-wrap gap-1 mb-3">
        {["All", ...LEAD_CATEGORIES].map((tab) => (
          <button
            key={tab}
            onClick={() => selectCategory(tab)}
            className={
              "text-sm rounded-md px-3 py-1.5 font-medium transition-colors " +
              (categoryTab === tab ? "bg-accent-soft text-accent-ink" : "text-text-muted hover:bg-surface-2")
            }
          >
            {tab}
            <span className="ml-1.5 text-xs font-mono text-text-faint">{categoryCounts[tab] ?? 0}</span>
          </button>
        ))}
      </div>

      {/* toolbar */}
      <div className="flex flex-wrap items-center gap-2 mb-3">
        <input
          value={globalFilter}
          onChange={(e) => setGlobalFilter(e.target.value)}
          placeholder="Search business, owner, email, phone…"
          className="flex-1 min-w-[220px] px-3 py-2 rounded-md border border-border bg-surface text-sm outline-none focus:ring-2 focus:ring-accent"
        />
        <select
          value={followFilter}
          onChange={(e) => setFollowFilter(e.target.value as FollowFilter)}
          className="px-3 py-2 rounded-md border border-border bg-surface text-sm text-text-muted outline-none focus:ring-2 focus:ring-accent"
        >
          <option value="all">All follow-ups</option>
          <option value="due">Due 24h</option>
          <option value="past">Past due</option>
        </select>
        <select
          onChange={(e) => table.getColumn("status")?.setFilterValue(e.target.value || undefined)}
          className="px-3 py-2 rounded-md border border-border bg-surface text-sm text-text-muted outline-none focus:ring-2 focus:ring-accent"
        >
          <option value="">All statuses</option>
          {PRELEAD_STATUSES.map((s) => (
            <option key={s} value={s}>
              {s}
            </option>
          ))}
        </select>
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
                <tr>
                  <td colSpan={columns.length} className="px-4 py-12 text-center text-text-faint">
                    No pre-leads match your filters.
                  </td>
                </tr>
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

      {modal.mode === "view" && modal.lead && (
        <QuickViewModal preLead={modal.lead} open={true} onClose={() => setModal({ mode: null, lead: null })} />
      )}
      {modal.mode === "follow" && modal.lead && (
        <FollowUpModal preLead={modal.lead} open={true} onClose={() => setModal({ mode: null, lead: null })} />
      )}
    </div>
  );
}
