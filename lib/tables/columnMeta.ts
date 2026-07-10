import { type RowData } from "@tanstack/react-table";

// Adds a `responsiveClass` to react-table's per-column `meta`, so tables can
// tag lower-priority columns with a Tailwind responsive-visibility class (e.g.
// "hidden lg:table-cell") that hides them on narrow viewports instead of
// forcing horizontal scroll. Mirrors react-table's own `ColumnMeta` signature
// (constraint `RowData`) so the declaration merges cleanly.
declare module "@tanstack/react-table" {
  // TData/TValue are required to match react-table's own ColumnMeta signature so
  // the declaration merges; TValue is unused in this augmentation's body.
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  interface ColumnMeta<TData extends RowData, TValue> {
    responsiveClass?: string;
  }
}
