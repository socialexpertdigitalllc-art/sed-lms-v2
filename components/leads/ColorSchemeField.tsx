"use client";

import { AlertTriangle, Check, Loader2, Plus, Sparkles, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { inputCls } from "@/components/forms/Field";
import {
  MAX_COLORS,
  colorToHex,
  formatColorScheme,
  parseColorScheme,
} from "@/lib/leads/colorScheme";
import {
  useColorSchemeCheck,
  type ColorSchemeContext,
  type ColorSchemeCheckState,
} from "@/hooks/useColorSchemeCheck";

/** Starting swatch when "Add colour" is pressed — mid-grey, obviously a placeholder. */
const NEW_SWATCH = "#808080";

/**
 * Up to MAX_COLORS swatches over a single string.
 *
 * The string IS the state: every edit re-parses `value`, mutates that list and
 * writes back the canonical form. There is no separate array to drift out of
 * sync with the text input next to it.
 */
export function ColorSwatchRow({
  value,
  onChange,
  disabled,
}: {
  value: string;
  onChange: (next: string) => void;
  disabled?: boolean;
}) {
  const entries = parseColorScheme(value);

  function replaceAt(i: number, next: string) {
    const list = [...entries];
    list[i] = next;
    onChange(formatColorScheme(list));
  }

  function removeAt(i: number) {
    onChange(formatColorScheme(entries.filter((_, j) => j !== i)));
  }

  return (
    <div className="mb-2 flex flex-wrap items-center gap-2">
      {entries.map((entry, i) => {
        const hex = colorToHex(entry);
        return (
          <span
            key={`${entry}-${i}`}
            className="group/swatch relative inline-flex items-center gap-1.5 rounded-full border border-border bg-surface py-1 pl-1 pr-2"
          >
            {hex ? (
              <label className="relative h-6 w-6 shrink-0 cursor-pointer overflow-hidden rounded-full border border-border">
                <span className="block h-full w-full" style={{ backgroundColor: hex }} />
                <input
                  type="color"
                  value={hex}
                  disabled={disabled}
                  aria-label={`Colour ${i + 1}`}
                  onChange={(e) => replaceAt(i, e.target.value)}
                  className="absolute inset-0 h-full w-full cursor-pointer opacity-0"
                />
              </label>
            ) : (
              <span
                aria-hidden
                className="grid h-6 w-6 shrink-0 place-items-center rounded-full border border-dashed border-dropped-fg/50 text-dropped-fg"
              >
                <AlertTriangle size={12} />
              </span>
            )}
            <span className="font-mono text-[11px] text-text-muted">{hex ?? entry}</span>
            <button
              type="button"
              onClick={() => removeAt(i)}
              disabled={disabled}
              aria-label={`Remove colour ${entry}`}
              className="grid h-4 w-4 place-items-center rounded-full text-text-faint hover:bg-surface-2 hover:text-text"
            >
              <X size={11} />
            </button>
          </span>
        );
      })}

      <button
        type="button"
        onClick={() => onChange(formatColorScheme([...entries, NEW_SWATCH]))}
        disabled={disabled || entries.length >= MAX_COLORS}
        title={entries.length >= MAX_COLORS ? `At most ${MAX_COLORS} colours` : undefined}
        className="inline-flex items-center gap-1 rounded-full border border-dashed border-border px-2.5 py-1.5 text-[11px] text-text-muted transition-colors hover:bg-surface-2 hover:text-text disabled:pointer-events-none disabled:opacity-45"
      >
        <Plus size={12} /> Add colour
      </button>
    </div>
  );
}

/**
 * Inline advisory output: the spinner, the issues, and the click-to-apply
 * suggestion. Purely presentational — the gate lives with the caller.
 */
export function ColorCheckFeedback({
  check,
  onApply,
  className,
}: {
  check: ColorSchemeCheckState;
  onApply: (next: string) => void;
  className?: string;
}) {
  const { checking, issues, suggestion, note, rejected } = check;
  if (!checking && issues.length === 0 && suggestion.length === 0) return null;

  return (
    <div className={cn("mt-1.5 space-y-1.5", className)} aria-live="polite">
      {checking && (
        <p className="flex items-center gap-1.5 text-[11px] text-text-faint">
          <Loader2 className="h-3.5 w-3.5 shrink-0 animate-spin" aria-hidden />
          Checking colours…
        </p>
      )}

      {issues.map((issue) => (
        <p
          key={issue}
          className={cn(
            "flex items-start gap-1.5 text-[11px] leading-relaxed",
            rejected ? "text-dropped-fg" : "text-notready-fg"
          )}
        >
          <AlertTriangle className="mt-px h-3.5 w-3.5 shrink-0" aria-hidden />
          <span>{issue}</span>
        </p>
      ))}

      {suggestion.length > 0 && (
        <div className="rounded-md border border-border bg-surface-2 p-2">
          <div className="flex flex-wrap items-center gap-2">
            <span className="inline-flex items-center gap-1 text-[11px] text-text-muted">
              <Sparkles className="h-3.5 w-3.5 shrink-0" aria-hidden /> Suggested
            </span>
            {suggestion.map((hex) => (
              <span key={hex} className="inline-flex items-center gap-1">
                <span
                  className="h-4 w-4 rounded-full border border-border"
                  style={{ backgroundColor: hex }}
                />
                <span className="font-mono text-[10px] text-text-faint">{hex}</span>
              </span>
            ))}
            <button
              type="button"
              onClick={() => onApply(formatColorScheme(suggestion))}
              className="ml-auto inline-flex items-center gap-1 rounded-md border border-accent px-2 py-1 text-[11px] font-medium text-accent-ink transition-colors hover:bg-accent-soft"
            >
              <Check size={11} /> Use these {suggestion.length}
            </button>
          </div>
          {note && <p className="mt-1.5 text-[11px] leading-relaxed text-text-faint">{note}</p>}
        </div>
      )}
    </div>
  );
}

/**
 * The whole field for the new-lead form: swatches, free-text input, AI feedback.
 * The caller owns `value` and the submit gate; this only edits and advises.
 */
export function ColorSchemeField({
  value,
  onChange,
  check,
}: {
  value: string;
  onChange: (next: string) => void;
  check: ColorSchemeCheckState;
}) {
  return (
    <div>
      <ColorSwatchRow value={value} onChange={onChange} />
      <input
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onBlur={check.checkNow}
        placeholder="e.g., #1A73E8, #FFFFFF, navy"
        className={inputCls}
      />
      <ColorCheckFeedback check={check} onApply={onChange} />
    </div>
  );
}

/**
 * The same advice for an inline edit on the lead detail page, where the caller
 * has no hook of its own (FieldRow only hands us a draft + setter).
 */
export function ColorSchemeAdvice({
  draft,
  onApply,
  context,
}: {
  draft: string;
  onApply: (next: string) => void;
  context?: ColorSchemeContext;
}) {
  const check = useColorSchemeCheck(draft, { context });
  return (
    <>
      <ColorSwatchRow value={draft} onChange={onApply} />
      <ColorCheckFeedback check={check} onApply={onApply} />
    </>
  );
}
