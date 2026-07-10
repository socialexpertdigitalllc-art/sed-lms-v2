"use client";

import { CalendarDays } from "lucide-react";
import type { MonthOption } from "@/lib/analytics/dateScope";

export function MonthFilter({ options, value, onChange }: {
  options: MonthOption[];
  value: string;
  onChange: (v: string) => void;
}) {
  return (
    <label className="inline-flex items-center gap-1.5 px-3 py-2 rounded-md border border-border bg-surface text-sm text-text-muted focus-within:ring-2 focus-within:ring-accent">
      <CalendarDays className="w-4 h-4 shrink-0" />
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="bg-transparent outline-none text-sm text-text-muted"
      >
        <option value="">All time</option>
        {options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
      </select>
    </label>
  );
}
