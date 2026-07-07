"use client";

export function RatingGroup({ value, onChange }: { value: number; onChange: (v: number) => void }) {
  return (
    <div className="flex flex-wrap gap-1.5">
      {Array.from({ length: 10 }, (_, i) => i + 1).map((n) => (
        <button
          key={n}
          type="button"
          onClick={() => onChange(n)}
          className={
            "w-9 h-9 rounded-md border text-sm font-mono transition-colors " +
            (n === value
              ? "border-accent bg-accent text-white font-semibold"
              : n < value
                ? "border-accent bg-accent-soft text-accent-ink"
                : "border-border text-text-muted hover:bg-surface-2")
          }
        >
          {n}
        </button>
      ))}
    </div>
  );
}
