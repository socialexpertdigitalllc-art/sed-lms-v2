"use client";

import { useEffect } from "react";
import { clampPageIndex } from "@/lib/tables/pagination";

/**
 * Snap an out-of-range page back to the last page when the dataset shrinks
 * (delete, realtime refresh, a filter change elsewhere). Pairs with
 * `noAutoPageReset`, which stops react-table from resetting the page on every
 * data refresh — see lib/tables/pagination.ts.
 */
export function usePageClamp(pageIndex: number, pageCount: number, onClamp: (page: string) => void) {
  useEffect(() => {
    const next = clampPageIndex(pageIndex, pageCount);
    if (next !== null) onClamp(String(next));
  }, [pageIndex, pageCount, onClamp]);
}
