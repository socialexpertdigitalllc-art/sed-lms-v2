import { useEffect, useState, type RefObject } from "react";

export function useTableKeyboardNav(opts: {
  count: number;
  searchInputRef: RefObject<HTMLInputElement | null>;
  onOpen: (index: number) => void;
  onEscape: () => void;
}) {
  const { count, searchInputRef, onOpen, onEscape } = opts;
  const [highlightedIndex, setHighlightedIndex] = useState(-1);

  // keep highlight in range as rows change
  useEffect(() => { setHighlightedIndex((i) => (i >= count ? count - 1 : i)); }, [count]);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      const el = document.activeElement as HTMLElement | null;
      const typing = !!el && (el.tagName === "INPUT" || el.tagName === "TEXTAREA" || el.tagName === "SELECT" || el.isContentEditable);
      if (e.key === "Escape") { if (typing) el?.blur(); onEscape(); setHighlightedIndex(-1); return; }
      if (typing) return; // don't hijack typing
      if (e.key === "/") { e.preventDefault(); searchInputRef.current?.focus(); return; }
      if (e.key === "j" || e.key === "ArrowDown") { e.preventDefault(); setHighlightedIndex((i) => Math.min(count - 1, i + 1)); return; }
      if (e.key === "k" || e.key === "ArrowUp") { e.preventDefault(); setHighlightedIndex((i) => Math.max(0, i - 1)); return; }
      if (e.key === "Enter") { setHighlightedIndex((i) => { if (i >= 0 && i < count) onOpen(i); return i; }); return; }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [count, searchInputRef, onOpen, onEscape]);

  return { highlightedIndex, setHighlightedIndex };
}
