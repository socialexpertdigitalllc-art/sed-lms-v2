"use client";

import { useMemo } from "react";
import Link from "next/link";
import { ArrowUp, ArrowDown } from "lucide-react";
import {
  useReactTable,
  getCoreRowModel,
  getFilteredRowModel,
  getSortedRowModel,
  getPaginationRowModel,
  flexRender,
  type ColumnDef,
  type SortingState,
} from "@tanstack/react-table";
import { formatDateTime, initials } from "@/lib/leads/format";
import { TOOLS } from "@/lib/ai-tools/config";
import type { AiGeneration } from "@/lib/ai-tools/types";
import { useUrlState } from "@/hooks/useUrlState";
import { serialColumn } from "@/components/common/tableSerial";

const GEN_DEFAULTS = { q: "", sort: "created_at:desc" };

type Row = AiGeneration & { agentName: string };

export function GenerationsTable({
  rows,
  agentNameById,
}: {
  rows: AiGeneration[];
  agentNameById: Record<string, string>;
}) {
  const [gs, setGs] = useUrlState(GEN_DEFAULTS);
  const sorting = useMemo<SortingState>(() => {
    const [id, dir] = gs.sort.split(":");
    return id ? [{ id, desc: dir !== "asc" }] : [];
  }, [gs.sort]);

  const data = useMemo<Row[]>(
    () => rows.map((r) => ({ ...r, agentName: (r.agent_id && agentNameById[r.agent_id]) || "Unknown" })),
    [rows, agentNameById]
  );

  const columns = useMemo<ColumnDef<Row>[]>(
    () => [
      serialColumn<Row>(),
      {
        accessorKey: "created_at",
        header: "Date",
        cell: (c) => <span className="text-text-muted whitespace-nowrap">{formatDateTime(c.getValue<string>())}</span>,
      },
      {
        accessorKey: "tool",
        header: "Tool",
        cell: (c) => {
          const t = c.getValue<keyof typeof TOOLS>();
          return (
            <span className="inline-flex items-center gap-1.5 whitespace-nowrap">
              <span className="w-2 h-2 rounded-full" style={{ background: TOOLS[t]?.accent ?? "#888" }} />
              <span className="text-text">{TOOLS[t]?.label ?? t}</span>
            </span>
          );
        },
      },
      {
        accessorKey: "business_name",
        header: "Business",
        cell: (c) => <span className="font-medium text-text truncate">{c.getValue<string>() ?? "—"}</span>,
      },
      {
        id: "agent",
        accessorFn: (r) => r.agentName,
        header: "Agent",
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
        accessorKey: "model",
        header: "Model",
        cell: (c) => <span className="text-text-muted font-mono text-xs">{c.getValue<string>() ?? "—"}</span>,
      },
      {
        accessorKey: "num_files",
        header: "Files",
        cell: (c) => <span className="text-text font-mono">{c.getValue<number | null>() ?? "—"}</span>,
      },
      {
        accessorKey: "tokens_used",
        header: "Tokens",
        cell: (c) => <span className="text-text-muted font-mono">{(c.getValue<number | null>() ?? 0).toLocaleString()}</span>,
      },
      {
        accessorKey: "cost_usd",
        header: "Cost",
        cell: (c) => <span className="text-text-muted font-mono">${Number(c.getValue<number | null>() ?? 0).toFixed(4)}</span>,
      },
      {
        accessorKey: "status",
        header: "Status",
        cell: (c) => {
          const s = c.getValue<string>();
          const ok = s === "success";
          return (
            <span className={"text-xs px-2 py-0.5 rounded-full font-medium " + (ok ? "bg-ready-bg text-ready-fg" : "bg-dropped-bg text-dropped-fg")}>
              {s}
            </span>
          );
        },
      },
      {
        id: "actions",
        header: "",
        enableSorting: false,
        cell: (c) => (
          <Link href={`/ai-tools/generations/${c.row.original.id}`} className="text-xs font-medium text-accent-ink px-2 py-1 rounded hover:bg-accent-soft whitespace-nowrap">
            View
          </Link>
        ),
      },
    ],
    []
  );

  const table = useReactTable({
    data,
    columns,
    state: { globalFilter: gs.q, sorting },
    onGlobalFilterChange: (updater) => {
      const next = typeof updater === "function" ? (updater as (o: string) => string)(gs.q) : (updater as string);
      setGs({ q: next ?? "" });
    },
    onSortingChange: (updater) => {
      const next = typeof updater === "function" ? (updater as (o: SortingState) => SortingState)(sorting) : updater;
      const t = next[0];
      setGs({ sort: t ? `${t.id}:${t.desc ? "desc" : "asc"}` : "" });
    },
    globalFilterFn: (row, _col, value) => {
      const q = String(value).toLowerCase();
      const r = row.original;
      return [r.business_name, r.agentName, r.model, r.tool].some((v) => (v ?? "").toString().toLowerCase().includes(q));
    },
    getCoreRowModel: getCoreRowModel(),
    getFilteredRowModel: getFilteredRowModel(),
    getSortedRowModel: getSortedRowModel(),
    getPaginationRowModel: getPaginationRowModel(),
    initialState: { pagination: { pageSize: 12 } },
  });

  const tableRows = table.getRowModel().rows;

  return (
    <div>
      <input
        value={gs.q}
        onChange={(e) => setGs({ q: e.target.value })}
        placeholder="Search business, agent, model…"
        className="w-full mb-3 px-3 py-2 rounded-md border border-border bg-surface text-sm outline-none focus:ring-2 focus:ring-accent"
      />
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
                      {h.column.getIsSorted() === "asc" ? <ArrowUp className="inline w-3 h-3 ml-0.5" /> : h.column.getIsSorted() === "desc" ? <ArrowDown className="inline w-3 h-3 ml-0.5" /> : null}
                    </th>
                  ))}
                </tr>
              ))}
            </thead>
            <tbody>
              {tableRows.length === 0 ? (
                <tr><td colSpan={columns.length} className="px-4 py-12 text-center text-text-faint">No generations yet.</td></tr>
              ) : (
                tableRows.map((row) => (
                  <tr key={row.id} className="border-b border-border-subtle last:border-0 hover:bg-surface-2">
                    {row.getVisibleCells().map((cell) => (
                      <td key={cell.id} className="px-4 py-2.5 align-middle max-w-[220px]">
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
      {table.getPageCount() > 1 && (
        <div className="flex items-center justify-between mt-3 text-sm text-text-muted">
          <span className="font-mono text-xs">Page {table.getState().pagination.pageIndex + 1} of {table.getPageCount()}</span>
          <div className="flex gap-2">
            <button onClick={() => table.previousPage()} disabled={!table.getCanPreviousPage()} className="px-3 py-1.5 rounded-md border border-border hover:bg-surface-2 disabled:opacity-40">Previous</button>
            <button onClick={() => table.nextPage()} disabled={!table.getCanNextPage()} className="px-3 py-1.5 rounded-md border border-border hover:bg-surface-2 disabled:opacity-40">Next</button>
          </div>
        </div>
      )}
    </div>
  );
}
