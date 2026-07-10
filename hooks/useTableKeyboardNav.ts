import { useEffect, useState, type RefObject } from "react";

export function useTableKeyboardNav(opts: {
  count: number;
  searchInputRef: RefObject<HTMLInputElement | null>;
  onOpen: (index: number) => void;
  onEscape: () => void;
  /** Disable while a modal owns the keyboard (defaults to true). */
  enabled?: boolean;
}) {
  const { count, searchInputRef, onOpen, onEscape, enabled = true } = opts;
  const [highlightedIndex, setHighlightedIndex] = useState(-1);

  // keep highlight in range as rows change
  useEffect(() => { setHighlightedIndex((i) => (i >= count ? count - 1 : i)); }, [count]);

  useEffect(() => {
    if (!enabled) return;
    function onKey(e: KeyboardEvent) {
      // A dialog owns the keyboard: never navigate/clear underneath it.
      if (document.querySelector('[aria-modal="true"]')) return;
      const el = document.activeElement as HTMLElement | null;
      const typing = !!el && (el.tagName === "INPUT" || el.tagName === "TEXTAREA" || el.tagName === "SELECT" || el.isContentEditable);
      if (e.key === "Escape") { if (typing) el?.blur(); onEscape(); setHighlightedIndex(-1); return; }
      if (typing) return; // don't hijack typing
      if (e.key === "/") { e.preventDefault(); searchInputRef.current?.focus(); return; }
      if (e.key === "j" || e.key === "ArrowDown") { e.preventDefault(); setHighlightedIndex((i) => Math.min(count - 1, i + 1)); return; }
      if (e.key === "k" || e.key === "ArrowUp") { e.preventDefault(); setHighlightedIndex((i) => Math.max(0, i - 1)); return; }
      if (e.key === "Enter") {
        // A focused button/link is being activated — don't also open a row.
        if (el && el.closest("button, a, [role='button']")) return;
        setHighlightedIndex((i) => { if (i >= 0 && i < count) onOpen(i); return i; });
        return;
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [count, searchInputRef, onOpen, onEscape, enabled]);

  return { highlightedIndex, setHighlightedIndex };
}
