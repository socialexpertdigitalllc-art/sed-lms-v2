"use client";

import { useCallback, useMemo } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { buildQuery } from "@/lib/url/buildQuery";

/**
 * URL query IS the state. Reads typed string values from the query (falling back
 * to `defaults`); `setState(patch)` writes them back via router.replace (no history
 * spam, no scroll jump). Pass a STABLE `defaults` (module-level const).
 */
export function useUrlState<T extends Record<string, string>>(
  defaults: T
): [T, (patch: Partial<T>) => void] {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  const state = useMemo(() => {
    const out = { ...defaults };
    for (const key of Object.keys(defaults)) {
      const v = searchParams.get(key);
      if (v !== null) (out as Record<string, string>)[key] = v;
    }
    return out;
  }, [searchParams, defaults]);

  const setState = useCallback(
    (patch: Partial<T>) => {
      const qs = buildQuery(searchParams.toString(), defaults, patch as Record<string, string | undefined>);
      router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
    },
    [searchParams, router, pathname, defaults]
  );

  return [state, setState];
}
