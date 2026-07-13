"use client";

import { useState } from "react";
import { Star } from "lucide-react";

/** 1–10 rating as two rows of five stars, each with its number inside. */
export function RatingGroup({ value, onChange }: { value: number; onChange: (v: number) => void }) {
  const [hover, setHover] = useState<number | null>(null);
  const fillTo = hover ?? value;
  return (
    <div className="grid w-fit grid-cols-5 gap-1.5" onMouseLeave={() => setHover(null)}>
      {Array.from({ length: 10 }, (_, i) => i + 1).map((n) => {
        const filled = n <= fillTo;
        return (
          <button
            key={n}
            type="button"
            aria-pressed={n === value}
            aria-label={`Rate ${n} out of 10`}
            onClick={() => onChange(n)}
            onMouseEnter={() => setHover(n)}
            className="relative grid h-10 w-10 place-items-center rounded-md transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
          >
            <Star
              aria-hidden
              className={
                "h-9 w-9 transition-colors " +
                (filled ? "fill-accent text-accent" : "fill-transparent text-border")
              }
            />
            <span
              className={
                "pointer-events-none absolute inset-0 grid place-items-center text-[11px] font-semibold " +
                (filled ? "text-white" : "text-text-muted")
              }
            >
              {n}
            </span>
          </button>
        );
      })}
    </div>
  );
}
