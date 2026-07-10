import type { ColumnDef } from "@tanstack/react-table";

/**
 * A leading serial-number column. Numbers reflect the CURRENT view order
 * (sorted/filtered), continuous across pages. `enableSorting: false`.
 */
export function serialColumn<T>(): ColumnDef<T> {
  return {
    id: "sr",
    header: "#",
    enableSorting: false,
    cell: ({ row, table }) => {
      const pag = table.getState().pagination;
      const base = pag ? pag.pageIndex * pag.pageSize : 0;
      const pos = table.getRowModel().rows.findIndex((r) => r.id === row.id);
      return <span className="text-text-faint text-xs tabular-nums">{base + pos + 1}</span>;
    },
  };
}
