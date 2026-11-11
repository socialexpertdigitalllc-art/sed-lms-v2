"use client";

import { useEffect, useRef } from "react";
import { createTickPacer, subscribeTableTicks, type TablePayload } from "@/lib/realtime/tableTicks";

/**
 * Run `onChange` (paced: a burst is one run, hidden tabs wait) when any of
 * these tables changes. For screens that load their own data in the browser:
 * pass their reload function. `filter` drops ticks for rows this screen
 * doesn't show (e.g. another domain's).
 */
export function useTableTicks(
  tables: string[],
  onChange: () => void,
  opts: { filter?: (p: TablePayload) => boolean; minGapMs?: number } = {},
) {
  const run = useRef(onChange);
  const filter = useRef(opts.filter);
  useEffect(() => {
    run.current = onChange;
    filter.current = opts.filter;
  });
  const key = tables.join(",");
  const minGapMs = opts.minGapMs;
  useEffect(() => {
    const list = key ? key.split(",") : [];
    const pacer = createTickPacer(() => run.current(), { minGapMs });
    const unsubscribe = subscribeTableTicks(
      list,
      (p) => {
        if (filter.current && !filter.current(p)) return;
        pacer.tick();
      },
      () => pacer.tick(),
    );
    const onVisible = () => {
      if (document.visibilityState === "visible") pacer.visible();
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      unsubscribe();
      pacer.dispose();
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [key, minGapMs]);
}
