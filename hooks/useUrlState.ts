"use client";

import { useCallback, useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import { buildQuery } from "@/lib/url/buildQuery";

/**
 * Table/view state that lives in the URL query, so Back from a detail page (or a
 * refresh, or a shared link) restores the exact filtered view.
 *
 * Local React state is the reactive source of truth (so the UI updates instantly
 * with no RSC refetch). It's seeded from the URL on mount — SSR-consistent via
 * `useSearchParams`, so no hydration mismatch — mirrored back to the URL with the
 * native `window.history.replaceState` (router.replace soft-navigations for
 * query-only changes are unreliable / no-op on dynamic routes here, and
 * useSearchParams does not react to replaceState in Next 16), and re-synced when a
 * real navigation or Back/Forward changes the query. Pass a STABLE `defaults`
 * (module-level const).
 */
export function useUrlState<T extends Record<string, string>>(
  defaults: T
): [T, (patch: Partial<T>) => void] {
  const searchParams = useSearchParams();
  const spString = searchParams.toString();

  const parse = useCallback(
    (qs: string): T => {
      const out = { ...defaults };
      const sp = new URLSearchParams(qs);
      for (const key of Object.keys(defaults)) {
        const v = sp.get(key);
        if (v !== null) (out as Record<string, string>)[key] = v;
      }
      return out;
    },
    [defaults]
  );

  const [state, setLocal] = useState<T>(() => parse(spString));

  // Re-sync only when the query changes via a real navigation or Back/Forward
  // (spString changes then). Our own replaceState writes do NOT change spString,
  // so they never clobber the optimistic local update below.
  useEffect(() => {
    setLocal(parse(spString));
  }, [spString, parse]);

  const setState = useCallback(
    (patch: Partial<T>) => {
      setLocal((prev) => {
        const next = { ...prev, ...patch } as T;
        const qs = buildQuery(
          window.location.search.replace(/^\?/, ""),
          defaults,
          patch as Record<string, string | undefined>
        );
        const url = qs ? `${window.location.pathname}?${qs}` : window.location.pathname;
        // Preserve Next's internal router state (slot 1) so the App Router stays consistent.
        window.history.replaceState(window.history.state, "", url);
        return next;
      });
    },
    [defaults]
  );

  return [state, setState];
}
