"use client";

import { useEffect, useRef, useState } from "react";
import { subscribeLeadsTicks } from "@/lib/realtime/leadsTicks";

/** Wait after a tick before re-reading, so a burst is one read (plus a little spread). */
export const TICK_REFETCH_DELAY_MS = 500;
export const TICK_REFETCH_JITTER_MS = 500;

/**
 * For a SMALL table (tens to a few hundred rows): start from what the page
 * sent, and re-read the whole table straight from Supabase (the viewer's own
 * row-level security) when the database ticks for it. Cheaper and simpler
 * than a change-by-change sync at that size, and it needs no page refresh.
 * Hidden tabs wait until they are looked at.
 */
export function useTickRefetch<T>(table: string, initial: T[], load: () => Promise<T[]>): T[] {
  const [rows, setRows] = useState(initial);
  // New data from the server (a navigation or refresh) replaces ours.
  const [seen, setSeen] = useState(initial);
  if (seen !== initial) {
    setSeen(initial);
    setRows(initial);
  }
  const loadRef = useRef(load);
  useEffect(() => {
    loadRef.current = load;
  }, [load]);

  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | null = null;
    let pending = false;
    let cancelled = false;
    const visible = () => document.visibilityState === "visible";
    const run = async () => {
      timer = null;
      if (!visible()) return; // stays pending
      pending = false;
      try {
        const next = await loadRef.current();
        if (!cancelled) setRows(next);
      } catch {
        /* keep what we have; the next tick tries again */
      }
    };
    const schedule = () => {
      if (!timer) timer = setTimeout(() => void run(), TICK_REFETCH_DELAY_MS + Math.random() * TICK_REFETCH_JITTER_MS);
    };
    const unsubscribe = subscribeLeadsTicks(
      (_kind, t) => {
        if (t !== table) return;
        pending = true;
        if (visible()) schedule();
      },
      () => {
        pending = true;
        schedule();
      },
    );
    const onVisible = () => {
      if (visible() && pending) schedule();
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
      unsubscribe();
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [table]);

  return rows;
}
