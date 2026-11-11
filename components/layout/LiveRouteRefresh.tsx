"use client";

import { useEffect, useRef } from "react";
import { usePathname, useRouter } from "next/navigation";
import { liveRouteFor } from "@/lib/realtime/liveRoutes";
import { createTickPacer, subscribeTableTicks } from "@/lib/realtime/tableTicks";

/** A revisit within this long after the last fresh copy needs no refresh. */
export const REVISIT_FRESH_MS = 5_000;
/** The browser keeps a visited page this long (next.config.ts staleTimes.dynamic). */
export const CLIENT_CACHE_MS = 300_000;

/**
 * Keeps EVERY screen live (mounted once, in the app layout):
 *
 * 1. Changes: for the screen on show, listen to the tables it shows
 *    (lib/realtime/liveRoutes.ts) and re-render it from the server when one
 *    changes — paced, so a burst is one refresh, and never in a hidden tab
 *    (it catches up when looked at). A refresh keeps scroll, filters and
 *    typing; only the data changes.
 * 2. Revisits: a screen opened again within the browser's cache window shows
 *    instantly from that copy, and is refreshed in the background here — so
 *    "instant" never means "stale".
 */
export function LiveRouteRefresh() {
  const pathname = usePathname();
  const router = useRouter();
  const lastFresh = useRef(new Map<string, number>());

  // 2. Revisits.
  useEffect(() => {
    if (!pathname) return;
    const now = Date.now();
    const seen = lastFresh.current.get(pathname);
    lastFresh.current.set(pathname, now);
    if (seen === undefined) return; // first visit: just rendered fresh
    const age = now - seen;
    if (age < REVISIT_FRESH_MS || age > CLIENT_CACHE_MS) return; // fresh enough, or fetched anew anyway
    const t = setTimeout(() => router.refresh(), 150);
    return () => clearTimeout(t);
  }, [pathname, router]);

  // 1. Changes.
  useEffect(() => {
    if (!pathname) return;
    const found = liveRouteFor(pathname);
    if (!found || found.route.self || !found.route.tables?.length) return;
    const { route, params } = found;
    const pacer = createTickPacer(
      () => {
        lastFresh.current.set(pathname, Date.now());
        router.refresh();
      },
      { minGapMs: route.minGapMs },
    );
    const unsubscribe = subscribeTableTicks(
      route.tables!,
      (p) => {
        if (route.match && !route.match(p, params)) return;
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
  }, [pathname, router]);

  return null;
}
