"use client";

import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { Star } from "lucide-react";
import { cn } from "@/lib/utils";

const GOLD = "text-amber-400 fill-amber-400";
export const STAR_LEVELS = [5, 4, 3, 2, 1] as const;

/** "★★★☆☆"-style label for filters and titles. */
export function starsLabel(p: number): string {
  return "★".repeat(p) + "☆".repeat(5 - p);
}

/**
 * The star beside a business name.
 * - Admins (canManage): an empty star adds (opens the priority popup); the
 *   golden star removes the lead from the hit list in one click.
 * - Viewers (closers): the golden star only, read-only.
 */
export function HitStarButton({
  priority,
  canManage,
  businessName,
  onAdd,
  onRemove,
}: {
  priority: number | undefined;
  canManage: boolean;
  businessName: string;
  onAdd: (anchor: HTMLElement) => void;
  onRemove: () => void;
}) {
  const on = priority != null && priority > 0;
  if (!canManage) {
    if (!on) return null;
    return (
      <span
        className="inline-flex items-center shrink-0"
        title={`On the hit list · ${priority} star${priority === 1 ? "" : "s"}`}
        aria-label={`On the hit list, ${priority} star${priority === 1 ? "" : "s"}`}
        data-testid="hit-star"
      >
        <Star className={cn("w-4 h-4", GOLD)} />
        <span className="text-[10px] font-semibold text-amber-500 -ml-0.5 leading-none">{priority}</span>
      </span>
    );
  }
  return (
    <button
      type="button"
      onClick={(e) => {
        e.stopPropagation();
        if (on) onRemove();
        else onAdd(e.currentTarget);
      }}
      aria-pressed={on}
      aria-label={on ? `Remove ${businessName} from the hit list` : `Add ${businessName} to the hit list`}
      title={on ? `On the hit list · ${priority} star${priority === 1 ? "" : "s"} — click to remove` : "Add to the hit list"}
      data-testid="hit-star"
      className={cn(
        "inline-flex items-center shrink-0 rounded p-0.5 -m-0.5 transition-colors",
        on ? "hover:bg-amber-100/60 dark:hover:bg-amber-900/30" : "text-text-faint/60 hover:text-amber-400 hover:bg-surface-2",
      )}
    >
      <Star className={cn("w-4 h-4", on && GOLD)} />
      {on && <span className="text-[10px] font-semibold text-amber-500 -ml-0.5 leading-none">{priority}</span>}
    </button>
  );
}

/** Five stars: a read-out, or — for admins — one click sets the priority. */
export function HitStars({
  value,
  onPick,
  size = "w-4 h-4",
  label = "Priority",
}: {
  value: number;
  onPick?: (p: number) => void;
  size?: string;
  label?: string;
}) {
  const [hover, setHover] = useState(0);
  const shown = hover || value;
  if (!onPick) {
    return (
      <span className="inline-flex items-center gap-0.5" aria-label={`${label}: ${value} of 5 stars`} title={`${value} of 5 stars`}>
        {[1, 2, 3, 4, 5].map((k) => (
          <Star key={k} className={cn(size, k <= value ? GOLD : "text-border")} />
        ))}
      </span>
    );
  }
  return (
    <span className="inline-flex items-center" role="radiogroup" aria-label={label} onMouseLeave={() => setHover(0)}>
      {[1, 2, 3, 4, 5].map((k) => (
        <button
          key={k}
          type="button"
          role="radio"
          aria-checked={k === value}
          aria-label={`${k} star${k === 1 ? "" : "s"}`}
          onMouseEnter={() => setHover(k)}
          onFocus={() => setHover(k)}
          onBlur={() => setHover(0)}
          onClick={(e) => {
            e.stopPropagation();
            onPick(k);
          }}
          className="p-0.5 rounded hover:scale-110 transition-transform focus:outline-none focus-visible:ring-2 focus-visible:ring-accent"
        >
          <Star className={cn(size, k <= shown ? GOLD : "text-border")} />
        </button>
      ))}
    </span>
  );
}

/**
 * The priority popup that opens on an admin's empty-star click. Purely local,
 * so it shows instantly: one click on a star adds the lead with that priority.
 * Keys 1–5 pick, Esc closes, a click outside closes.
 */
export function HitPriorityPopover({
  anchor,
  businessName,
  onPick,
  onClose,
}: {
  anchor: HTMLElement;
  businessName: string;
  onPick: (p: number) => void;
  onClose: () => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null);

  useLayoutEffect(() => {
    const r = anchor.getBoundingClientRect();
    const w = ref.current?.offsetWidth ?? 240;
    const h = ref.current?.offsetHeight ?? 110;
    const left = Math.max(8, Math.min(r.left - 8, window.innerWidth - w - 8));
    const below = r.bottom + 6;
    const top = below + h > window.innerHeight - 8 ? Math.max(8, r.top - h - 6) : below;
    setPos({ top, left });
  }, [anchor]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        onClose();
      } else if (/^[1-5]$/.test(e.key)) {
        e.preventDefault();
        onPick(Number(e.key));
      }
    };
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node) && !anchor.contains(e.target as Node)) onClose();
    };
    window.addEventListener("keydown", onKey, true);
    document.addEventListener("mousedown", onDown);
    window.addEventListener("resize", onClose);
    return () => {
      window.removeEventListener("keydown", onKey, true);
      document.removeEventListener("mousedown", onDown);
      window.removeEventListener("resize", onClose);
    };
  }, [anchor, onClose, onPick]);

  return (
    <div
      ref={ref}
      role="dialog"
      aria-label={`Hit list priority for ${businessName}`}
      data-testid="hit-popover"
      style={{ position: "fixed", top: pos?.top ?? -9999, left: pos?.left ?? -9999, zIndex: 60 }}
      className="w-60 rounded-lg border border-border bg-surface shadow-lg p-3"
      onClick={(e) => e.stopPropagation()}
    >
      <div className="text-xs font-semibold text-text">Add to the hit list</div>
      <div className="text-[11px] text-text-muted truncate mb-2">{businessName}</div>
      <HitStars value={0} onPick={onPick} size="w-7 h-7" label="Priority" />
      <div className="mt-1.5 text-[10px] text-text-faint">Pick a priority · keys 1–5 · Esc to close</div>
    </div>
  );
}
