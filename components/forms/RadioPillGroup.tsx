"use client";

export function RadioPillGroup({
  options,
  value,
  onChange,
}: {
  options: readonly string[];
  value: string;
  onChange: (v: string) => void;
}) {
  return (
    <div className="flex flex-wrap gap-2">
      {options.map((o) => (
        <button
          key={o}
          type="button"
          aria-pressed={value === o}
          onClick={() => onChange(o)}
          className={
            "px-3.5 py-1.5 text-sm rounded-full border transition-colors focus-visible:ring-2 focus-visible:ring-accent focus-visible:outline-none " +
            (value === o
              ? "border-accent bg-accent-soft text-accent-ink font-medium"
              : "border-border text-text-muted hover:bg-surface-2")
          }
        >
          {o}
        </button>
      ))}
    </div>
  );
}
