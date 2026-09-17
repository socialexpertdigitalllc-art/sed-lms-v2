"use client";

import { useEffect, useState } from "react";

/**
 * Resolved values of theme CSS variables, for the few consumers that cannot
 * use `var()`.
 *
 * Recharts is the reason this exists: it writes colours onto SVG
 * PRESENTATION ATTRIBUTES (`<line stroke="…">`, `<text fill="…">`), and those
 * are parsed as SVG types, not as CSS values — `var(--color-border)` there is
 * simply invalid and the mark renders black. So the actual computed colour
 * has to be read out of the document and handed over as a literal.
 *
 * Re-reads whenever the theme changes, from either direction: the toggle
 * flipping `data-theme`, or the OS switching under a "system" preference.
 *
 * Returns `null` until mounted — the server has no computed styles. Callers
 * render with their light-theme literals until then, which is what the very
 * first frame is anyway.
 */
export function useThemeTokens<T extends Record<string, string>>(vars: T): Record<keyof T, string> | null {
  const [tokens, setTokens] = useState<Record<keyof T, string> | null>(null);

  // `vars` is a fresh object literal on every render at most call sites, so
  // its identity cannot be the dependency — the resolved NAMES are stable.
  const key = Object.entries(vars)
    .map(([k, v]) => `${k}:${v}`)
    .join("|");

  useEffect(() => {
    const names = key.split("|").map((pair) => {
      const i = pair.indexOf(":");
      return [pair.slice(0, i), pair.slice(i + 1)] as const;
    });

    const read = () => {
      const style = getComputedStyle(document.documentElement);
      const next = {} as Record<keyof T, string>;
      for (const [prop, cssVar] of names) {
        next[prop as keyof T] = style.getPropertyValue(cssVar).trim();
      }
      setTokens(next);
    };
    read();

    // The toggle flips the attribute…
    const observer = new MutationObserver(read);
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });
    // …and under "system" there is no attribute to watch, only the OS.
    const media = window.matchMedia("(prefers-color-scheme: dark)");
    media.addEventListener("change", read);

    return () => {
      observer.disconnect();
      media.removeEventListener("change", read);
    };
  }, [key]);

  return tokens;
}
