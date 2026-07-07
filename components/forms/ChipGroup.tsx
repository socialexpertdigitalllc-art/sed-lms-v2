"use client";

export function ChipGroup({
  options,
  selected,
  onToggle,
  locked = [],
  disabled = [],
  counter,
}: {
  options: readonly string[];
  selected: string[];
  onToggle: (v: string) => void;
  /** Always-on chips the user cannot toggle (shown "(Required)"). */
  locked?: string[];
  /** Chips that cannot be selected right now. */
  disabled?: string[];
  counter?: string;
}) {
  return (
    <div className="flex flex-wrap items-center gap-2">
      {options.map((o) => {
        const isOn = selected.includes(o);
        const isLocked = locked.includes(o);
        const isDisabled = disabled.includes(o);
        return (
          <button
            key={o}
            type="button"
            disabled={isLocked || isDisabled}
            onClick={() => onToggle(o)}
            className={
              "px-3 py-1.5 text-sm rounded-md border transition-colors " +
              (isOn
                ? "border-accent bg-accent-soft text-accent-ink font-medium"
                : "border-border text-text-muted hover:bg-surface-2") +
              (isDisabled ? " opacity-40 cursor-not-allowed" : "") +
              (isLocked ? " opacity-80 cursor-default" : "")
            }
          >
            {o}
            {isLocked && isOn ? " (Required)" : ""}
          </button>
        );
      })}
      {counter && <span className="text-xs font-mono text-text-faint ml-1">{counter}</span>}
    </div>
  );
}
