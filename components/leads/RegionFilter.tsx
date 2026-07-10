"use client";
import { useEffect, useRef, useState } from "react";
import type { RegionFacet } from "@/lib/geo/regions";

export function RegionFilter({ facets, selected, onChange }: {
  facets: RegionFacet[];
  selected: string[];
  onChange: (next: string[]) => void;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    function onDoc(e: MouseEvent) { if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false); }
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, []);
  const toggle = (region: string) =>
    onChange(selected.includes(region) ? selected.filter((r) => r !== region) : [...selected, region]);
  const label = selected.length ? `Region · ${selected.length}` : "Region";
  return (
    <div ref={ref} className="relative">
      <button type="button" onClick={() => setOpen((o) => !o)}
        className={"px-3 py-2 rounded-md border text-sm outline-none focus:ring-2 focus:ring-accent " +
          (selected.length ? "border-accent bg-accent-soft text-accent-ink" : "border-border bg-surface text-text-muted")}>
        {label} ▾
      </button>
      {open && (
        <div className="absolute z-20 mt-1 w-64 max-h-72 overflow-auto bg-surface border border-border rounded-md shadow-lg p-1">
          {facets.length === 0 && <div className="px-3 py-2 text-xs text-text-faint">No regions</div>}
          {facets.map((f) => (
            <label key={f.region} className="flex items-center gap-2 px-2 py-1.5 rounded hover:bg-surface-2 cursor-pointer text-sm">
              <input type="checkbox" className="accent-accent" checked={selected.includes(f.region)} onChange={() => toggle(f.region)} />
              <span className="flex-1 text-text truncate">{f.region}</span>
              {f.mainAreaCode && <span className="text-xs font-mono text-text-faint">{f.mainAreaCode}</span>}
              <span className="text-xs text-text-muted">({f.leadCount})</span>
            </label>
          ))}
          {selected.length > 0 && (
            <button type="button" onClick={() => onChange([])}
              className="w-full text-left px-2 py-1.5 mt-1 text-xs text-dropped-fg hover:bg-surface-2 rounded">Clear</button>
          )}
        </div>
      )}
    </div>
  );
}
