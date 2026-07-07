"use client";

import { inputCls } from "./Field";

export function DynamicList({
  values,
  onChange,
  placeholder,
  addLabel,
  inputType = "text",
}: {
  values: string[];
  onChange: (v: string[]) => void;
  placeholder: string;
  addLabel: string;
  inputType?: string;
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
            placeholder={placeholder}
            className={"flex-1 " + inputCls}
          />
          <button
            type="button"
            onClick={() => removeAt(i)}
            className="text-xs text-text-muted border border-border rounded-md px-2.5 py-2 hover:bg-dropped-bg hover:text-dropped-fg whitespace-nowrap"
          >
            ✕ Remove
          </button>
        </div>
      ))}
      <button
        type="button"
        onClick={() => onChange([...values, ""])}
        className="text-sm text-accent-ink font-medium border border-dashed border-accent rounded-md px-3 py-1.5 hover:bg-accent-soft"
      >
        + {addLabel}
      </button>
    </div>
  );
}
