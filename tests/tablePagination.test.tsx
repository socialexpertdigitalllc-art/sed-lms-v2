import { describe, it, expect } from "vitest";
import { useState } from "react";
import { render, act, waitFor } from "@testing-library/react";
import {
  useReactTable,
  getCoreRowModel,
  getPaginationRowModel,
  type ColumnDef,
  type PaginationState,
} from "@tanstack/react-table";
import { noAutoPageReset, clampPageIndex } from "@/lib/tables/pagination";

type Row = { id: string; name: string };

const columns: ColumnDef<Row>[] = [{ accessorKey: "name", header: "Name" }];
const makeRows = (n = 30): Row[] => Array.from({ length: n }, (_, i) => ({ id: String(i), name: `row-${i}` }));

/**
 * Mirrors how LeadsTable/PreLeadsTable/GenerationsTable wire react-table:
 * fully controlled pagination + onPaginationChange writing back (in the app,
 * into useUrlState). `stable` toggles our noAutoPageReset options on/off.
 */
function Harness({ data, stable }: { data: Row[]; stable: boolean }) {
  const [pagination, setPagination] = useState<PaginationState>({ pageIndex: 0, pageSize: 10 });
  const table = useReactTable({
    data,
    columns,
    state: { pagination },
    onPaginationChange: setPagination,
    ...(stable ? noAutoPageReset : {}),
    getCoreRowModel: getCoreRowModel(),
    getPaginationRowModel: getPaginationRowModel(),
  });
  // Consuming getRowModel() matters: react-table's row-model memos are lazy,
  // and their onChange is what queues the pageIndex auto-reset. Real tables
  // always render rows, so the harness must too.
  return (
    <div>
      <span data-testid="page">{table.getState().pagination.pageIndex}</span>
      <span data-testid="rows">{table.getRowModel().rows.length}</span>
      <button data-testid="go2" onClick={() => table.setPageIndex(1)}>
        go2
      </button>
    </div>
  );
}

describe("table pagination stability (noAutoPageReset)", () => {
  it("keeps the current page when the data array identity changes (refresh)", async () => {
    const r = render(<Harness data={makeRows()} stable={true} />);
    // Flush react-table's arming microtask (its auto-reset skips the very first
    // row-model compute). In the app the table is long-mounted, so it's armed.
    await act(async () => {});
    act(() => {
      r.getByTestId("go2").click();
    });
    expect(r.getByTestId("page").textContent).toBe("1");

    // Simulate router.refresh()/realtime refresh: same rows, NEW array identity.
    r.rerender(<Harness data={makeRows()} stable={true} />);
    await act(async () => {}); // flush react-table's queued auto-reset (if any)

    expect(r.getByTestId("page").textContent).toBe("1");
  });

  it("control: react-table's default DOES reset the page on data change (the bug)", async () => {
    // Documents why noAutoPageReset must stay: without it, any data refresh
    // writes pageIndex 0 through onPaginationChange. If a react-table upgrade
    // makes this control fail, the default changed and noAutoPageReset can go.
    const r = render(<Harness data={makeRows()} stable={false} />);
    await act(async () => {}); // arm the auto-reset (see above)
    act(() => {
      r.getByTestId("go2").click();
    });
    expect(r.getByTestId("page").textContent).toBe("1");

    r.rerender(<Harness data={makeRows()} stable={false} />);
    await waitFor(() => expect(r.getByTestId("page").textContent).toBe("0"));
  });
});

describe("clampPageIndex", () => {
  it("clamps past-the-end page to the last page", () => {
    expect(clampPageIndex(5, 3)).toBe(2);
    expect(clampPageIndex(3, 3)).toBe(2);
  });
  it("returns null when in range", () => {
    expect(clampPageIndex(0, 3)).toBeNull();
    expect(clampPageIndex(2, 3)).toBeNull();
    expect(clampPageIndex(0, 1)).toBeNull();
  });
  it("returns null for an empty table (EmptyState is the right UI, nothing to clamp to)", () => {
    expect(clampPageIndex(4, 0)).toBeNull();
    expect(clampPageIndex(0, 0)).toBeNull();
  });
});
