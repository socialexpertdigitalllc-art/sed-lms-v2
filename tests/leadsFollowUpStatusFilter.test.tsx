import { describe, it, expect } from "vitest";
import { render, within } from "@testing-library/react";
import {
  useReactTable,
  getCoreRowModel,
  getFilteredRowModel,
  type ColumnDef,
  type ColumnFiltersState,
} from "@tanstack/react-table";
import { FU_STATUSES } from "@/lib/leads/followups";

/**
 * The Follow-up filter on the leads table selects by the status PILL —
 * Pickup / No Pickup — which is `last_followup_status`. A lead that has never
 * been followed up has no pill, and belongs to neither selection.
 *
 * The exact accessor + filterFn shape LeadsTable's `fu_status` carrier column
 * uses, exercised through react-table's own filtered row model rather than a
 * re-implementation of it.
 */

type Row = { id: string; last_followup_status: string | null };

const columns: ColumnDef<Row>[] = [
  {
    id: "fu_status",
    accessorFn: (row) => row.last_followup_status ?? "",
    filterFn: (row, id, value: string[]) => !value?.length || value.includes(row.getValue<string>(id)),
  },
];

const DATA: Row[] = [
  { id: "picked", last_followup_status: "Pickup" },
  { id: "missed", last_followup_status: "No Pickup" },
  { id: "picked-2", last_followup_status: "Pickup" },
  { id: "untouched", last_followup_status: null },
];

function Harness({ filters }: { filters: ColumnFiltersState }) {
  const table = useReactTable({
    data: DATA,
    columns,
    state: { columnFilters: filters, columnVisibility: { fu_status: false } },
    getCoreRowModel: getCoreRowModel(),
    getFilteredRowModel: getFilteredRowModel(),
  });
  return <div data-testid="ids">{table.getFilteredRowModel().rows.map((r) => r.original.id).join(",")}</div>;
}

// Scoped to this render's own container: one test renders twice, and a
// body-wide query would find both.
const shown = (filters: ColumnFiltersState) =>
  within(render(<Harness filters={filters} />).container).getByTestId("ids").textContent!.split(",").filter(Boolean);

describe("leads table — Follow-up status filter", () => {
  it("Pickup shows only leads whose pill reads Pickup", () => {
    expect(shown([{ id: "fu_status", value: ["Pickup"] }])).toEqual(["picked", "picked-2"]);
  });

  it("No Pickup shows only leads whose pill reads No Pickup", () => {
    expect(shown([{ id: "fu_status", value: ["No Pickup"] }])).toEqual(["missed"]);
  });

  it("both selected shows every lead that HAS a pill, never the untouched ones", () => {
    expect(shown([{ id: "fu_status", value: [...FU_STATUSES] }])).toEqual(["picked", "missed", "picked-2"]);
  });

  it("no selection shows everything, untouched leads included", () => {
    expect(shown([])).toEqual(["picked", "missed", "picked-2", "untouched"]);
    expect(shown([{ id: "fu_status", value: [] }])).toEqual(["picked", "missed", "picked-2", "untouched"]);
  });

  it("still filters while the carrier column is hidden from the table", () => {
    // Visibility is a rendering concern; the harness hides the column exactly
    // as LeadsTable does and the filter must apply regardless.
    expect(shown([{ id: "fu_status", value: ["No Pickup"] }])).toEqual(["missed"]);
  });
});
