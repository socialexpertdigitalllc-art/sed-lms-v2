"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";

/**
 * Pacing for the refresh a realtime event triggers. One lead update reaches
 * EVERY open tab of every user within a few hundred ms, and each refresh
 * re-renders the whole server tree (layout + page: a dozen queries and the
 * full leads payload). With a 400 ms debounce that was a thundering herd on
 * the single Node process and the database — the pattern behind the
 * dashboard "getting stuck" as the team grew.
 *
 *  - DEBOUNCE: a burst of changes (a bulk action, a sync) is one refresh.
 *  - JITTER:   tabs spread out over a second instead of landing together.
 *  - MIN_GAP:  a tab refreshes at most once per gap however busy the table.
 *  - Hidden tabs do nothing; they refresh once when looked at again.
 */
export const REALTIME_REFRESH = {
  DEBOUNCE_MS: 1_500,
  JITTER_MS: 1_000,
  MIN_GAP_MS: 5_000,
} as const;

/**
 * Decides WHEN a refresh runs; the hook below owns the realtime channel.
 * Pure timing logic, injectable clock + random for tests.
 */
export function createRefreshPacer(
  refresh: () => void,
  isVisible: () => boolean,
  opts: { now?: () => number; random?: () => number; setTimer?: typeof setTimeout; clearTimer?: typeof clearTimeout } = {},
) {
  const now = opts.now ?? Date.now;
  const random = opts.random ?? Math.random;
  const setTimer = opts.setTimer ?? setTimeout;
  const clearTimer = opts.clearTimer ?? clearTimeout;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let pending = false;
  let lastRefresh = -Infinity;

  const schedule = () => {
    if (timer) return;
    const notBefore = lastRefresh + REALTIME_REFRESH.MIN_GAP_MS - now();
    const delay = Math.max(REALTIME_REFRESH.DEBOUNCE_MS + random() * REALTIME_REFRESH.JITTER_MS, notBefore);
    timer = setTimer(() => {
      timer = null;
      if (!isVisible()) return; // stays pending; resumed by onVisible()
      pending = false;
      lastRefresh = now();
      refresh();
    }, delay);
  };

  return {
    /** A change arrived. */
    onEvent() {
      pending = true;
      if (isVisible()) schedule();
    },
    /** The tab became visible: catch up on anything missed while hidden. */
    onVisible() {
      if (pending) schedule();
    },
    dispose() {
      if (timer) clearTimer(timer);
      timer = null;
    },
  };
}

// Subscribe to Postgres changes on a table and refresh the route — paced.
export function useRealtimeRefresh(table: string) {
  const router = useRouter();
  useEffect(() => {
    const supabase = createClient();
    let cancelled = false;
    const channel = supabase.channel(`rt-${table}`);
    const pacer = createRefreshPacer(
      () => router.refresh(),
      () => document.visibilityState === "visible",
    );
    const onVisibility = () => {
      if (document.visibilityState === "visible") pacer.onVisible();
    };
    document.addEventListener("visibilitychange", onVisibility);

    // RLS-gated postgres_changes require the realtime socket to carry the
    // user's JWT; otherwise the (authenticated-only) policy filters every event.
    (async () => {
      const { data } = await supabase.auth.getSession();
      if (cancelled) return;
      if (data.session) supabase.realtime.setAuth(data.session.access_token);
      channel
        .on("postgres_changes", { event: "*", schema: "public", table }, () => pacer.onEvent())
        .subscribe();
    })();

    return () => {
      cancelled = true;
      pacer.dispose();
      document.removeEventListener("visibilitychange", onVisibility);
      supabase.removeChannel(channel);
    };
  }, [table, router]);
}
