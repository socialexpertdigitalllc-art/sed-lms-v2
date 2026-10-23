"use client";

import { useEffect, useRef, useState } from "react";
import { Loader2, Sparkles, Wand2, X } from "lucide-react";
import { btnPrimary, btnSecondary } from "@/components/common/buttons";
import type { BrandColor } from "@/lib/logos/brief";
import { LOGO_FONTS } from "@/lib/logos/fontList";
import type { LogoCandidateView } from "@/lib/logos/store";
import { CHECKER_STYLE, DesignImage, Swatches } from "./LogoParts";

/**
 * Retry: change the design on screen ("make the house icon simpler"), or start
 * again from the person's own idea ("a shield with a wrench"). Either way the
 * words on the logo and the lead's colours are the rules the AI keeps to.
 */

export type RetryMode = "refine" | "idea";

export interface RetryRequest {
  mode: "refine" | "idea";
  instructions: string;
  logoText: string;
  /** A font picked from the list (every design uses it); absent = the AI chooses. */
  font?: string;
}

const CHANGE_CHIPS = ["Bigger symbol", "Smaller symbol", "A different font", "Bolder lettering", "All capitals", "Name on one line", "Name on two lines", "Simpler symbol", "A different symbol", "No symbol, just the name", "More space between letters"];
const IDEA_CHIPS = ["Symbol beside the name", "Initials in a badge", "Just the name, two colours", "Bold and industrial", "Friendly and rounded", "Elegant and premium", "Modern and minimal", "Script lettering"];

/** Add a chip's words to what's typed. PURE. */
export function withChip(text: string, chip: string): string {
  const t = text.trim();
  if (!t) return chip;
  if (t.toLowerCase().includes(chip.toLowerCase())) return t;
  return `${t.replace(/[.,;\s]+$/, "")}, ${chip.toLowerCase()}`;
}

export function LogoRetryDialog({
  design,
  designLabel,
  logoText,
  colors,
  busy,
  error,
  onClose,
  onSubmit,
}: {
  /** The design on screen, when there is one (it can be changed). */
  design: LogoCandidateView | null;
  designLabel: string;
  logoText: string;
  colors: BrandColor[];
  busy: boolean;
  error: string | null;
  onClose: () => void;
  onSubmit: (r: RetryRequest) => void;
}) {
  const [mode, setMode] = useState<RetryMode>(design ? "refine" : "idea");
  const [change, setChange] = useState("");
  const [idea, setIdea] = useState("");
  const [words, setWords] = useState(logoText);
  const [font, setFont] = useState("");
  const box = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    box.current?.focus();
  }, [mode]);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !busy) onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [busy, onClose]);

  const text = mode === "refine" ? change : idea;
  const setText = mode === "refine" ? setChange : setIdea;
  const chips = mode === "refine" ? [...CHANGE_CHIPS, ...colors.filter((c) => c.role !== "light").map((c) => `Name in ${c.name}`)] : IDEA_CHIPS;
  // A picked font is a change in itself.
  const canSend = !busy && words.trim().length > 0 && (mode === "idea" || change.trim().length > 0 || !!font);

  function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!canSend) return;
    const said = text.trim() || (mode === "refine" && font ? `Use the ${LOGO_FONTS.find((f) => f.key === font)?.label ?? font} font` : "");
    onSubmit({ mode, instructions: said, logoText: words.trim(), ...(font ? { font } : {}) });
  }

  const tab = (m: RetryMode, label: string, disabled = false) => (
    <button
      type="button"
      role="tab"
      aria-selected={mode === m}
      disabled={disabled}
      onClick={() => setMode(m)}
      className={
        "flex-1 rounded-md px-3 py-1.5 text-sm font-medium transition-colors disabled:opacity-40 " +
        (mode === m ? "bg-surface text-text shadow-sm" : "text-text-muted hover:text-text")
      }
    >
      {label}
    </button>
  );

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/45 p-4 sm:p-8"
      role="dialog"
      aria-modal="true"
      aria-labelledby="logo-retry-title"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget && !busy) onClose();
      }}
    >
      <form onSubmit={submit} className="w-full max-w-lg rounded-xl border border-border bg-surface shadow-xl">
        <header className="flex items-center justify-between border-b border-border-subtle px-5 py-3">
          <h2 id="logo-retry-title" className="flex items-center gap-2 text-sm font-semibold text-text">
            <Wand2 className="h-4 w-4 text-accent" aria-hidden /> Try again
          </h2>
          <button type="button" onClick={onClose} disabled={busy} aria-label="Close" className="rounded p-1 text-text-muted hover:bg-surface-2 hover:text-text">
            <X className="h-4 w-4" />
          </button>
        </header>

        <div className="space-y-4 px-5 py-4">
          <div className="flex gap-1 rounded-lg bg-surface-2 p-1" role="tablist" aria-label="What to do">
            {tab("refine", "Change this design", !design)}
            {tab("idea", "Try a new idea")}
          </div>

          {mode === "refine" && design ? (
            <div className="flex items-center gap-3 rounded-lg border border-border-subtle p-2">
              <div className="grid h-14 w-32 shrink-0 place-items-center overflow-hidden rounded-md" style={CHECKER_STYLE}>
                <DesignImage c={design} alt={designLabel} className="max-h-12 max-w-[7.5rem]" />
              </div>
              <p className="min-w-0 text-xs text-text-muted">
                Changes are made to <span className="font-medium text-text">{designLabel}</span>. Everything you don&apos;t mention stays the same.
              </p>
            </div>
          ) : null}

          <div>
            <label htmlFor="logo-retry-text" className="text-xs font-medium text-text">
              {mode === "refine" ? "What should change?" : "Describe the logo you want"}
              {mode === "idea" ? <span className="font-normal text-text-faint"> (optional — empty means fresh designs)</span> : null}
            </label>
            <textarea
              id="logo-retry-text"
              ref={box}
              value={text}
              onChange={(e) => setText(e.target.value)}
              maxLength={1000}
              rows={3}
              placeholder={mode === "refine" ? "e.g. make the roof icon simpler and put the name on one line" : "e.g. a shield with a wrench in it, strong and trustworthy"}
              className="mt-1 w-full resize-y rounded-md border border-border bg-surface px-2.5 py-2 text-sm text-text outline-none focus:border-accent focus:ring-2 focus:ring-accent/30"
            />
            <div className="mt-2 flex flex-wrap gap-1.5" aria-label="Quick suggestions">
              {chips.map((chip) => (
                <button
                  key={chip}
                  type="button"
                  onClick={() => setText(withChip(text, chip))}
                  className="rounded-full border border-border bg-surface-2 px-2.5 py-1 text-[11px] text-text-muted hover:border-accent hover:text-accent-ink"
                >
                  {chip}
                </button>
              ))}
            </div>
          </div>

          <div>
            <label htmlFor="logo-retry-font" className="text-xs font-medium text-text">
              Font
            </label>
            <select
              id="logo-retry-font"
              value={font}
              onChange={(e) => setFont(e.target.value)}
              className="mt-1 w-full rounded-md border border-border bg-surface px-2.5 py-1.5 text-sm text-text outline-none focus:border-accent focus:ring-2 focus:ring-accent/30"
            >
              <option value="">Let the AI choose</option>
              {LOGO_FONTS.map((f) => (
                <option key={f.key} value={f.key}>
                  {f.label} — {f.style.split(" — ")[0]}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label htmlFor="logo-retry-words" className="text-xs font-medium text-text">
              Words on the logo
            </label>
            <input
              id="logo-retry-words"
              value={words}
              onChange={(e) => setWords(e.target.value)}
              maxLength={80}
              className="mt-1 w-full rounded-md border border-border bg-surface px-2.5 py-1.5 text-sm text-text outline-none focus:border-accent focus:ring-2 focus:ring-accent/30"
            />
            <p className="mt-1 text-[11px] text-text-faint">Set in the font exactly as typed — always spelled right. Only these words go on it.</p>
          </div>

          <p className="flex items-center gap-2 text-[11px] text-text-muted">
            {colors.length ? (
              <>
                <Swatches colors={colors} /> Colours from the lead&apos;s colour scheme.
              </>
            ) : (
              "No colour scheme on this lead — the AI picks colours that suit the trade."
            )}
          </p>

          {error ? <p className="rounded-md bg-dropped-bg px-3 py-2 text-xs text-dropped-fg">{error}</p> : null}
        </div>

        <footer className="flex items-center justify-end gap-2 border-t border-border-subtle px-5 py-3">
          <button type="button" onClick={onClose} disabled={busy} className={btnSecondary}>
            Cancel
          </button>
          <button type="submit" disabled={!canSend} className={btnPrimary}>
            {busy ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : <Sparkles className="h-4 w-4" aria-hidden />}
            {mode === "refine" ? "Draw 4 versions" : "Draw 4 designs"}
          </button>
        </footer>
      </form>
    </div>
  );
}
