"use client";
import MultiSelect from "@/components/common/MultiSelect";
import type { RegionFacet } from "@/lib/geo/regions";

export function RegionFilter({ facets, selected, onChange }: {
  facets: RegionFacet[];
  selected: string[];
  onChange: (next: string[]) => void;
}) {
  return (
    <MultiSelect
      label="Region"
      selected={selected}
      onChange={onChange}
      options={facets.map((f) => ({
        value: f.region,
        count: f.leadCount,
        hint: f.mainAreaCode || undefined,
      }))}
    />
  );
}
