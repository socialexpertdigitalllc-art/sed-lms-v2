import { Star } from "lucide-react";

/** Compact read-only star strip: filled stars up to `value` plus an "n/10" tag. */
export function RatingStars({ value, outOf = 10 }: { value: number | null; outOf?: number }) {
  if (value == null) return <span className="text-text-faint">—</span>;
  return (
    <span className="inline-flex items-center gap-0.5">
      {Array.from({ length: outOf }, (_, i) => i + 1).map((n) => (
        <Star
          key={n}
          aria-hidden
          className={
            "h-3.5 w-3.5 " + (n <= value ? "fill-accent text-accent" : "fill-transparent text-border")
          }
        />
      ))}
      <span className="ml-1 font-mono text-xs text-text-muted">
        {value}/{outOf}
      </span>
    </span>
  );
}
