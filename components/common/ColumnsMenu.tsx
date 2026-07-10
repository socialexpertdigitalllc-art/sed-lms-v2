"use client";

import { useState, useRef, useEffect } from "react";
import { Columns3, Check } from "lucide-react";
import type { Table } from "@tanstack/react-table";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function ColumnsMenu({ table }: { table: Table<any> }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function onDoc(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, []);

  const cols = table
    .getAllLeafColumns()
    .filter((c) => c.getCanHide() && typeof c.columnDef.header === "string" && c.columnDef.header !== "");

  return (
    <div className="relative" ref={ref}>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-md border border-border text-sm text-text-muted hover:bg-surface-2"
      >
        <Columns3 className="w-4 h-4" /> Columns
      </button>
      {open && (
        <div className="absolute right-0 z-20 mt-1 w-48 rounded-md border border-border bg-surface shadow-lg p-1">
          {cols.map((c) => (
            <button
              key={c.id}
              type="button"
              onClick={() => c.toggleVisibility()}
              className="flex w-full items-center justify-between gap-2 px-2 py-1.5 rounded text-sm text-text hover:bg-surface-2 text-left"
            >
              <span>{c.columnDef.header as string}</span>
              {c.getIsVisible() ? <Check className="w-3.5 h-3.5 text-accent-ink" /> : <span className="w-3.5 h-3.5" />}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
