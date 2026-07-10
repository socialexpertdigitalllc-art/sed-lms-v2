"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowUp, ArrowDown, Inbox } from "lucide-react";
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
  type VisibilityState,
} from "@tanstack/react-table";
import type { PreLead } from "@/lib/preleads/types";
import { LEAD_CATEGORIES, PRELEAD_STATUSES } from "@/lib/preleads/types";
import { formatCurrency, formatDateTime } from "@/lib/leads/format";
import { CategoryPill, PreLeadStatusPill } from "./CategoryPill";
import { FollowUpModal } from "./FollowUpModal";
import { usePermissions } from "@/hooks/usePermissions";
import { useRealtimeRefresh } from "@/hooks/useRealtimeRefresh";
import { useUrlState } from "@/hooks/useUrlState";
import { serialColumn } from "@/components/common/tableSerial";
import { CopyButton } from "@/components/common/CopyButton";
import { Select } from "@/components/common/Select";
import { useUiPrefs } from "@/providers/UiPrefsProvider";
import { DensityToggle } from "@/components/common/DensityToggle";
import { ColumnsMenu } from "@/components/common/ColumnsMenu";
import { EmptyState } from "@/components/common/EmptyState";
import "@/lib/tables/columnMeta";

type FollowFilter = "all" | "due" | "past";
type Modal = { mode: "follow" | null; lead: PreLead | null };

// NOTE: the plan's PRELEADS_DEFAULTS only listed q/category/follow/sort, but
// this table also has a `status` filter driven through the same react-table
// columnFilters state as `lead_category` (a plain <select> with no local
// state var, wired straight to `table.getColumn("status").setFilterValue`).
// Deriving columnFilters from category alone would silently stop that select
// from doing anything, so `status` is URL-persisted too.
const PRELEADS_DEFAULTS = { q: "", category: "All", follow: "all", sort: "created_at:desc", status: "", page: "0", size: "15" };

export function PreLeadsTable({
  preLeads,
  agentNameById,
}: {
  preLeads: PreLead[];
  agentNameById: Record<string, string>;
}) {
  const router = useRouter();
  const { has } = usePermissions();
  const { density, columns: columnPrefs, setTableColumns } = useUiPrefs();
  useRealtimeRefresh("pre_leads");
  const canCreate = has("pre_leads.create");
  const canFollowUp = has("pre_leads.followup");
  const canDelete = has("pre_leads.delete");

  const [ps, setPs] = useUrlState(PRELEADS_DEFAULTS);
  const categoryTab = ps.category;
  const followFilter = ps.follow as FollowFilter;
  const sorting = useMemo<SortingState>(() => {
    const [id, dir] = ps.sort.split(":");
    return id ? [{ id, desc: dir !== "asc" }] : [];
  }, [ps.sort]);
  const columnFilters = useMemo<ColumnFiltersState>(() => {
    const f: ColumnFiltersState = [];
    if (ps.category !== "All") f.push({ id: "lead_category", value: ps.category });
    if (ps.status) f.push({ id: "status", value: ps.status });
    return f;
  }, [ps.category, ps.status]);
  const pagination = useMemo(
    () => ({ pageIndex: Math.max(0, Number(ps.page) || 0), pageSize: Math.max(1, Number(ps.size) || 15) }),
    [ps.page, ps.size]
  );
  const columnVisibility = useMemo<VisibilityState>(() => columnPrefs.preleads ?? {}, [columnPrefs]);
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
      { ...serialColumn<PreLead>(), enableHiding: false },
      {
        accessorKey: "business_name",
        header: "Business",
        cell: (c) => (
          <div className="min-w-0">
            <div className="font-semibold text-text truncate">
              <Link
                href={`/pre-leads/${c.row.original.id}`}
                onClick={(e) => e.stopPropagation()}
                className="hover:underline"
              >
                {c.row.original.business_name}
              </Link>
            </div>
            <div className="text-xs text-text-faint truncate">{c.row.original.owner_name ?? ""}</div>
          </div>
        ),
      },
      {
        accessorKey: "phone_number",
        header: "Phone",
        cell: (c) => {
          const phone = c.getValue<string>();
          return phone ? (
            <span className="inline-flex items-center gap-1 whitespace-nowrap">
              <span className="text-text-muted font-mono text-xs">{phone}</span>
              <CopyButton value={phone} title="Copy phone" />
            </span>
          ) : (
            <span className="text-text-muted">—</span>
          );
        },
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
        meta: { responsiveClass: "hidden lg:table-cell" },
        cell: (c) => <span className="text-text-muted">{c.getValue<string | null>() ?? "—"}</span>,
      },
      {
        accessorKey: "pricing",
        header: "Pricing",
        meta: { responsiveClass: "hidden xl:table-cell" },
        cell: (c) => (
          <span className="text-text font-mono whitespace-nowrap">{formatCurrency(c.getValue<number | null>())}</span>
        ),
      },
      {
        accessorKey: "follow_up_time",
        header: "Follow-up",
        meta: { responsiveClass: "hidden md:table-cell" },
        cell: (c) => (
          <span className="text-text-muted whitespace-nowrap">{formatDateTime(c.getValue<string | null>())}</span>
        ),
      },
      {
        id: "actions",
        header: "",
        enableSorting: false,
        enableHiding: false,
        cell: (c) => {
          const lead = c.row.original;
          return (
            <div
              onClick={(e) => e.stopPropagation()}
              className="flex items-center justify-end gap-1 whitespace-nowrap opacity-0 group-hover:opacity-100 focus-within:opacity-100 transition-opacity"
            >
              <Link
                href={`/pre-leads/${lead.id}`}
                className="text-xs font-medium text-accent-ink px-2 py-1 rounded hover:bg-accent-soft"
              >
                View
              </Link>
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
    state: { globalFilter: ps.q, sorting, columnFilters, pagination, columnVisibility },
    onGlobalFilterChange: (updater) => {
      const next = typeof updater === "function" ? (updater as (o: string) => string)(ps.q) : (updater as string);
      setPs({ q: next ?? "", page: "0" });
    },
    onSortingChange: (updater) => {
      const next = typeof updater === "function" ? (updater as (o: SortingState) => SortingState)(sorting) : updater;
      const t = next[0];
      setPs({ sort: t ? `${t.id}:${t.desc ? "desc" : "asc"}` : "", page: "0" });
    },
    onColumnFiltersChange: () => {},
    onColumnVisibilityChange: (updater) => {
      const next = typeof updater === "function" ? updater(columnVisibility) : updater;
      setTableColumns("preleads", next);
    },
    onPaginationChange: (updater) => {
      const next = typeof updater === "function" ? (updater as (o: typeof pagination) => typeof pagination)(pagination) : updater;
      setPs({ page: String(next.pageIndex) });
    },
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
  });

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
      <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
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
            onClick={() => setPs({ category: tab, page: "0" })}
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
          value={ps.q}
          onChange={(e) => setPs({ q: e.target.value, page: "0" })}
          placeholder="Search business, owner, email, phone…"
          className="flex-1 min-w-[220px] px-3 py-2 rounded-md border border-border bg-surface text-sm outline-none focus:ring-2 focus:ring-accent"
        />
        <Select
          value={followFilter}
          onChange={(e) => setPs({ follow: e.target.value, page: "0" })}
          className="px-3 py-2 rounded-md border border-border bg-surface text-sm text-text-muted outline-none focus:ring-2 focus:ring-accent"
        >
          <option value="all">All follow-ups</option>
          <option value="due">Due 24h</option>
          <option value="past">Past due</option>
        </Select>
        <Select
          value={ps.status}
          onChange={(e) => setPs({ status: e.target.value, page: "0" })}
          className="px-3 py-2 rounded-md border border-border bg-surface text-sm text-text-muted outline-none focus:ring-2 focus:ring-accent"
        >
          <option value="">All statuses</option>
          {PRELEAD_STATUSES.map((s) => (
            <option key={s} value={s}>
              {s}
            </option>
          ))}
        </Select>
        <DensityToggle />
        <ColumnsMenu table={table} />
      </div>

      {/* table */}
      <div className="bg-surface border border-border rounded-lg overflow-hidden">
        <div className="overflow-auto max-h-[70vh]">
          <table className="w-full text-sm">
            <thead className="bg-surface-2 sticky top-0 z-10">
              {table.getHeaderGroups().map((hg) => (
                <tr key={hg.id} className="border-b border-border">
                  {hg.headers.map((h) => (
                    <th
                      key={h.id}
                      onClick={h.column.getCanSort() ? h.column.getToggleSortingHandler() : undefined}
                      className={
                        "text-left text-[10px] uppercase tracking-wide text-text-faint font-semibold px-4 py-3 whitespace-nowrap " +
                        (h.column.getCanSort() ? "cursor-pointer select-none hover:text-text-muted" : "") +
                        " " + (h.column.columnDef.meta?.responsiveClass ?? "")
                      }
                    >
                      {flexRender(h.column.columnDef.header, h.getContext())}
                      {h.column.getIsSorted() === "asc" ? <ArrowUp className="inline w-3 h-3 ml-0.5" /> : h.column.getIsSorted() === "desc" ? <ArrowDown className="inline w-3 h-3 ml-0.5" /> : null}
                    </th>
                  ))}
                </tr>
              ))}
            </thead>
            <tbody>
              {rows.length === 0 ? (
                <tr>
                  <td colSpan={columns.length}>
                    <EmptyState icon={Inbox} title="No pre-leads found" hint="Try adjusting filters or search." />
                  </td>
                </tr>
              ) : (
                rows.map((row) => (
                  <tr
                    key={row.id}
                    className="border-b border-border-subtle last:border-0 hover:bg-surface-2 group"
                  >
                    {row.getVisibleCells().map((cell) => (
                      <td key={cell.id} className={"px-4 align-middle max-w-[260px] " + (density === "compact" ? "py-1.5 " : "py-2.5 ") + (cell.column.columnDef.meta?.responsiveClass ?? "")}>
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
      <div className="flex flex-wrap items-center justify-between gap-3 mt-3 text-sm text-text-muted">
        <label className="inline-flex items-center gap-1.5 text-xs text-text-muted">
          Rows per page
          <Select
            value={ps.size}
            onChange={(e) => setPs({ size: e.target.value, page: "0" })}
            className="px-2 py-1 rounded-md border border-border bg-surface text-sm text-text-muted"
          >
            <option value="15">15</option>
            <option value="25">25</option>
            <option value="50">50</option>
            <option value="100">100</option>
          </Select>
        </label>
        {table.getPageCount() > 1 && (
          <div className="flex items-center gap-3">
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
      </div>

      {modal.mode === "follow" && modal.lead && (
        <FollowUpModal preLead={modal.lead} open={true} onClose={() => setModal({ mode: null, lead: null })} />
      )}
    </div>
  );
}
