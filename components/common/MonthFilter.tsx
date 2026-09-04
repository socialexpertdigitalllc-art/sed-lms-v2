"use client";

import { useState } from "react";
import { CalendarDays } from "lucide-react";
import type { MonthOption } from "@/lib/analytics/dateScope";
import { Select } from "@/components/common/Select";
import { DateTimeField } from "@/components/common/DateTimeField";

export interface DateRange {
  /** `YYYY-MM-DDTHH:MM` (local) or "". */
  from: string;
  to: string;
}

const CUSTOM = "__custom__";

/**
 * Scope a list by when its rows were created: a month, or any range.
 *
 * The month presets stay because they are one click and cover most asks. The
 * custom range exists for every other ask — "since Tuesday afternoon", "the
 * first two weeks of the quarter" — and uses the dashboard's own date-time
 * picker, so it looks like every other date control here. A month and a range
 * are exclusive: choosing either clears the other, so the caller never has
 * to reconcile two scopes.
 *
 * `range`/`onRangeChange` are optional so the dashboard, which only scopes by
 * month, keeps the control it had.
 */
export function MonthFilter({ options, value, onChange, range, onRangeChange }: {
  options: MonthOption[];
  value: string;
  onChange: (v: string) => void;
  range?: DateRange;
  onRangeChange?: (r: DateRange) => void;
}) {
  const rangeSupported = !!range && !!onRangeChange;
  const rangeActive = rangeSupported && !!(range.from || range.to);
  // Keeps the pickers open once "Custom range" is chosen and while both ends
  // are still empty — an empty range is not yet a filter, but it is still the
  // mode the user asked for.
  const [custom, setCustom] = useState(rangeActive);
  const showRange = rangeSupported && (custom || rangeActive);
  const selectValue = showRange ? CUSTOM : value;

  function pick(v: string) {
    if (v === CUSTOM) {
      setCustom(true);
      onChange("");
      return;
    }
    setCustom(false);
    if (rangeActive) onRangeChange?.({ from: "", to: "" });
    onChange(v);
  }

  return (
    <div className="flex flex-wrap items-center gap-2">
      <label className="inline-flex items-center gap-1.5 px-3 py-2 rounded-md border border-border bg-surface text-sm text-text-muted focus-within:ring-2 focus-within:ring-accent">
        <CalendarDays className="w-4 h-4 shrink-0" />
        <Select
          value={selectValue}
          onChange={(e) => pick(e.target.value)}
          aria-label="Created"
          className="bg-transparent outline-none text-sm text-text-muted"
        >
          <option value="">All time</option>
          {options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
          {rangeSupported && <option value={CUSTOM}>Custom range…</option>}
        </Select>
      </label>
      {showRange && range && onRangeChange && (
        <div className="flex flex-wrap items-center gap-2 text-xs text-text-muted" data-testid="created-range">
          <span>From</span>
          <DateTimeField
            aria-label="Created from"
            value={range.from}
            onChange={(from) => onRangeChange({ ...range, from })}
            className="w-32"
          />
          <span>to</span>
          <DateTimeField
            aria-label="Created to"
            value={range.to}
            onChange={(to) => onRangeChange({ ...range, to })}
            className="w-32"
          />
        </div>
      )}
    </div>
  );
}
