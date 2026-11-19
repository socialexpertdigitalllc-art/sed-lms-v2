"use client";

import { LINE_LABEL, LINE_SHORT, type LineType } from "@/lib/hitlist/line";

const TONE: Record<LineType, { on: string; off: string }> = {
  direct: { on: "bg-ready-bg text-ready-fg border-ready-fg/40", off: "hover:bg-ready-bg/60 hover:text-ready-fg" },
  not_direct: { on: "bg-dropped-bg text-dropped-fg border-dropped-fg/40", off: "hover:bg-dropped-bg/60 hover:text-dropped-fg" },
};

/**
 * The HitList's Direct Line tag on a row: two pills, one click each.
 * Clicking the pill that's already on clears it. Without permission (or off
 * the HitList) it's a plain read-out.
 */
export function LineTypeToggle({
  value,
  onChange,
  canEdit,
  businessName,
}: {
  value: LineType | null;
  onChange: (v: LineType | null) => void;
  canEdit: boolean;
  businessName: string;
}) {
  if (!canEdit) {
    return value ? (
      <span data-testid="line-badge" className={`inline-flex whitespace-nowrap rounded-full border px-2 py-0.5 text-[11px] font-medium ${TONE[value].on}`}>
        {LINE_LABEL[value]}
      </span>
    ) : (
      <span className="text-text-faint">—</span>
    );
  }
  return (
    <span
      role="group"
      aria-label={`Line for ${businessName}`}
      className="inline-flex overflow-hidden rounded-full border border-border bg-surface text-[11px] font-medium"
      onClick={(e) => e.stopPropagation()}
    >
      {(["direct", "not_direct"] as const).map((k, i) => {
        const on = value === k;
        return (
          <button
            key={k}
            type="button"
            aria-pressed={on}
            title={on ? `${LINE_LABEL[k]} — click to clear` : `Mark ${LINE_LABEL[k]}`}
            onClick={() => onChange(on ? null : k)}
            className={`whitespace-nowrap px-2 py-0.5 transition-colors ${i ? "border-l border-border" : ""} ${on ? TONE[k].on : `text-text-faint ${TONE[k].off}`}`}
          >
            {LINE_SHORT[k]}
          </button>
        );
      })}
    </span>
  );
}
