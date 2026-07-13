"use client";

import { X } from "lucide-react";
import { inputCls } from "./Field";
import { splitCommaRow } from "@/lib/forms/splitCommaRow";

export function DynamicList({
  values,
  onChange,
  placeholder,
  addLabel,
  inputType = "text",
  minRows = 0,
  max,
}: {
  values: string[];
  onChange: (v: string[]) => void;
  placeholder: string;
  addLabel: string;
  inputType?: string;
  /** Minimum number of rows; the Remove button is hidden at or below this count. */
  minRows?: number;
  /** Maximum number of rows; the Add button is hidden once this count is reached. */
  max?: number;
}) {
  const setAt = (i: number, v: string) => onChange(values.map((x, j) => (j === i ? v : x)));
  const removeAt = (i: number) => onChange(values.filter((_, j) => j !== i));
  return (
    <div className="space-y-2">
      {values.map((v, i) => (
        <div key={i} className="flex items-center gap-2">
          <input
            type={inputType}
            value={v}
            onChange={(e) => setAt(i, e.target.value)}
            onBlur={() => {
              // "a, b, c" typed into one row becomes three rows on blur.
              const next = splitCommaRow(values, i);
              if (next) onChange(next);
            }}
            placeholder={placeholder}
            className={"flex-1 " + inputCls}
          />
          {values.length > minRows && (
            <button
              type="button"
              onClick={() => removeAt(i)}
              className="text-xs text-text-muted border border-border rounded-md px-2.5 py-2 hover:bg-dropped-bg hover:text-dropped-fg whitespace-nowrap inline-flex items-center gap-1"
            >
              <X className="w-4 h-4" /> Remove
            </button>
          )}
        </div>
      ))}
      {(max === undefined || values.length < max) && (
        <button
          type="button"
          onClick={() => onChange([...values, ""])}
          className="text-sm text-accent-ink font-medium border border-dashed border-accent rounded-md px-3 py-1.5 hover:bg-accent-soft"
        >
          + {addLabel}
        </button>
      )}
    </div>
  );
}
