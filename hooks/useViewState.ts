"use client";

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { usePathname, useSearchParams } from "next/navigation";
import { parseViewState, pickStoredView } from "@/lib/url/viewState";

// Client-only layout effect: restores the stored view BEFORE paint (no flash
// of the default view); on the server it degrades to a no-op useEffect,
// avoiding React's SSR useLayoutEffect warning.
const useClientLayoutEffect = typeof window === "undefined" ? useEffect : useLayoutEffect;

/**
 * Per-page view state (filters/sort/page/size) that survives navigating away
 * and back, and reloads — WITHOUT writing to the URL. The address bar stays a
 * plain path and never changes as the user clicks around.
 *
 * Local React state is the source of truth, mirrored to sessionStorage under
 * `view:<pathname>` (per tab; cleared when the tab closes). On mount the
 * stored view is restored. An incoming link may still pass an initial view
 * via query params (e.g. /tickets?mine=1&lead=…): the link's params define
 * the whole view (they win over the stored one) and are then consumed —
 * applied, persisted, and cleared from the address bar with a single
 * `history.replaceState(null, "", pathname)` (the Next-documented form that
 * keeps Next's own history entry in sync). Pass a STABLE `defaults`
 * (module-level const).
 *
 * Replaces the old useUrlState, which wrote every state change into the URL;
 * saved views now serialize state via buildQuery instead of reading
 * window.location.search.
 */
export function useViewState<T extends Record<string, string>>(
  defaults: T
): [T, (patch: Partial<T>) => void] {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const spString = searchParams.toString();
  const storageKey = `view:${pathname}`;

  // SSR-consistent seed (deep-link params over defaults) — no hydration mismatch.
  const [state, setLocal] = useState<T>(() => parseViewState(defaults, spString));

  // On mount, on a same-path query navigation, and on a path change while
  // mounted: consume deep-link params or restore that path's stored view.
  const consumed = useRef<string | null>(null);
  useClientLayoutEffect(() => {
    const marker = `${storageKey}?${spString}`;
    if (consumed.current === marker) return;
    consumed.current = marker;
    const sp = new URLSearchParams(spString);
    const hasRelevantParams = Object.keys(defaults).some((k) => sp.get(k) !== null);
    if (hasRelevantParams) {
      const next = parseViewState(defaults, spString);
      setLocal(next);
      try {
        sessionStorage.setItem(storageKey, JSON.stringify(next));
      } catch {
        /* best-effort */
      }
      // Consume the link's query so the address bar stays a plain path.
      window.history.replaceState(null, "", window.location.pathname);
    } else {
      let stored: Partial<T> | null = null;
      try {
        stored = pickStoredView(defaults, sessionStorage.getItem(storageKey));
      } catch {
        /* best-effort */
      }
      // Base on defaults (not prev) so a path change never leaks the old
      // path's view into this one.
      setLocal({ ...defaults, ...(stored ?? {}) });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [storageKey, spString]);

  const setState = useCallback(
    (patch: Partial<T>) => {
      setLocal((prev) => {
        const next = { ...prev, ...patch };
        try {
          sessionStorage.setItem(storageKey, JSON.stringify(next));
        } catch {
          /* best-effort */
        }
        return next;
      });
    },
    [storageKey]
  );

  return [state, setState];
}
