"use client";
import { useEffect, useRef, useState } from "react";
import { ChevronDown } from "lucide-react";
import type { LucideIcon } from "lucide-react";

export type MultiSelectOption = {
  value: string;
  label?: string;
  count?: number;
  hint?: string;
};

/** Popover checkbox multiselect used for every filter dropdown, so they all look the same. */
export default function MultiSelect({ label, options, selected, onChange, icon: Icon, align = "left" }: {
  label: string;
  options: MultiSelectOption[];
  selected: string[];
  onChange: (next: string[]) => void;
  icon?: LucideIcon;
  align?: "left" | "right";
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    function onDoc(e: MouseEvent) { if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false); }
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, []);
  const toggle = (value: string) =>
    onChange(selected.includes(value) ? selected.filter((v) => v !== value) : [...selected, value]);
  const trigger = selected.length ? `${label} · ${selected.length}` : label;
  return (
    <div ref={ref} className="relative">
      <button type="button" onClick={() => setOpen((o) => !o)}
        className={"inline-flex items-center gap-1 px-3 py-2 rounded-md border text-sm outline-none focus:ring-2 focus:ring-accent " +
          (selected.length ? "border-accent bg-accent-soft text-accent-ink" : "border-border bg-surface text-text-muted")}>
        {Icon && <Icon className="w-3.5 h-3.5 shrink-0" />}
        {trigger}
        <ChevronDown className="w-3.5 h-3.5 shrink-0" />
      </button>
      {open && (
        <div className={"absolute z-20 mt-1 w-64 max-h-72 overflow-auto bg-surface border border-border rounded-md shadow-lg p-1 " +
          (align === "right" ? "right-0" : "left-0")}>
          {options.length === 0 && <div className="px-3 py-2 text-xs text-text-faint">No options</div>}
          {options.map((o) => (
            <label key={o.value} className="flex items-center gap-2 px-2 py-1.5 rounded hover:bg-surface-2 cursor-pointer text-sm">
              <input type="checkbox" className="accent-accent" checked={selected.includes(o.value)} onChange={() => toggle(o.value)} />
              <span className="flex-1 text-text truncate">{o.label ?? o.value}</span>
              {o.hint && <span className="text-xs font-mono text-text-faint">{o.hint}</span>}
              {typeof o.count === "number" && <span className="text-xs text-text-muted">({o.count})</span>}
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
