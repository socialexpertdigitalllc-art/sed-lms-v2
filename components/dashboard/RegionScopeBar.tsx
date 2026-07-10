"use client";
import type { RegionFacet } from "@/lib/geo/regions";

export function RegionScopeBar({ facets, selected, onChange }: {
  facets: RegionFacet[]; selected: string[]; onChange: (next: string[]) => void;
}) {
  if (!facets.length) return null;
  const toggle = (r: string) => onChange(selected.includes(r) ? selected.filter((x) => x !== r) : [...selected, r]);
  const chip = (active: boolean) =>
    "px-3 py-1 rounded-full text-xs border transition-colors " +
    (active ? "border-accent bg-accent-soft text-accent-ink font-medium" : "border-border text-text-muted hover:bg-surface-2");
  return (
    <div className="flex flex-wrap items-center gap-2">
      <button type="button" onClick={() => onChange([])} className={chip(selected.length === 0)}>All regions</button>
      {facets.map((f) => (
        <button key={f.region} type="button" onClick={() => toggle(f.region)} className={chip(selected.includes(f.region))}>
          {f.region}{f.mainAreaCode ? ` · ${f.mainAreaCode}` : ""} · {f.leadCount}
        </button>
      ))}
    </div>
  );
}
