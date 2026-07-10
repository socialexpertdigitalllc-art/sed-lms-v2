"use client";

import { useCallback, useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import { buildQuery } from "@/lib/url/buildQuery";

/**
 * Table/view state that lives in the URL query, so Back from a detail page (or a
 * refresh, or a shared link) restores the exact filtered view.
 *
 * Local React state is the reactive source of truth (instant UI, no RSC-refetch
 * flash), seeded from the URL on mount — SSR-consistent via `useSearchParams`, so
 * no hydration mismatch. The URL is written with the Next-documented
 * `window.history.replaceState(null, "", "?query")` form: passing `null` state and
 * a RELATIVE query is what makes Next update its OWN history entry, so the
 * production Back button returns to `/leads?...` instead of a fresh `/leads`.
 * (`router.replace` no-ops for query-only same-path changes; a
 * `replaceState(window.history.state, ...)` updates the address bar but leaves
 * Next's history stale, so prod Back drops the query.) On a real navigation /
 * Back-Forward the query changes and we re-sync. Pass a STABLE `defaults`
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

  // Re-sync when the query changes via a real navigation.
  useEffect(() => {
    setLocal(parse(spString));
  }, [spString, parse]);
  // ...and on Back/Forward, reading the address bar directly (covers cached segments).
  useEffect(() => {
    const onPop = () => setLocal(parse(window.location.search.replace(/^\?/, "")));
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, [parse]);

  const setState = useCallback(
    (patch: Partial<T>) => {
      setLocal((prev) => ({ ...prev, ...patch })); // instant UI
      const qs = buildQuery(
        window.location.search.replace(/^\?/, ""),
        defaults,
        patch as Record<string, string | undefined>
      );
      window.history.replaceState(null, "", qs ? `?${qs}` : window.location.pathname);
    },
    [defaults]
  );

  return [state, setState];
}
