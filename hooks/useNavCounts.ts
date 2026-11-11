"use client";

import { useEffect, useState } from "react";
import { subscribeTableTicks } from "@/lib/realtime/tableTicks";

// Every table whose row count feeds a sidebar badge. Some may not be in the
// realtime publication — subscribing is harmless if no events arrive; the
// mount fetch still seeds the counts either way.
const COUNT_TABLES = [
  "lead_tickets",
  "feedback",
  "pre_leads",
  "payment_links",
  "form_submissions",
  "profiles",
  "departments",
  "website_addons",
] as const;

/**
 * Live sidebar badge counts. Fetches `/api/nav-counts` on mount and re-fetches
 * (debounced 400ms) whenever any count-bearing table changes. Mirrors the
 * BellBase realtime pattern: one channel, JWT-authed socket, direct refetch
 * (router.refresh wouldn't re-run this client fetch). Returns `{}` until the
 * first fetch resolves.
 */
export function useNavCounts(): Record<string, number> {
  const [counts, setCounts] = useState<Record<string, number>>({});
  const [refreshTick, setRefreshTick] = useState(0);

  useEffect(() => {
    let active = true;
    (async () => {
      try {
        const res = await fetch("/api/nav-counts", { cache: "no-store" });
        if (res.ok && active) {
          setCounts(((await res.json()).counts ?? {}) as Record<string, number>);
        }
      } catch {
        /* fail-soft — badges just don't update */
      }
    })();
    return () => {
      active = false;
    };
  }, [refreshTick]);

  // Realtime events are RLS-filtered per subscriber, so users without
  // wide-view permissions receive none for tables they can't select — their
  // badges would only refresh on a hard reload. Poll + refetch on focus as a
  // floor (the useUnreadMail pattern) so every badge stays honest.
  //
  // The floor poll only runs while the tab is VISIBLE: an overnight
  // background tab polling badge counts every minute was a leading burner of
  // the shared database's disk-IO budget (incident 2026-08-17). A hidden tab
  // goes fully quiet and catches up through the visibilitychange tick the
  // moment it's looked at; 180s is plenty for a floor whose real-time path
  // is the realtime subscription below.
  useEffect(() => {
    const tick = () => setRefreshTick((n) => n + 1);
    const interval = setInterval(() => {
      if (document.visibilityState === "visible") tick();
    }, 180_000);
    const onVisible = () => {
      if (document.visibilityState === "visible") tick();
    };
    window.addEventListener("focus", tick);
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      clearInterval(interval);
      window.removeEventListener("focus", tick);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, []);

  useEffect(() => {
    let t: ReturnType<typeof setTimeout> | null = null;

    // A hidden tab ignores bumps entirely — the visibilitychange tick above
    // refetches the moment it is looked at, so nothing is lost and a
    // background tab no longer joins the herd every time something changes.
    const bump = () => {
      if (document.visibilityState !== "visible") return;
      if (t) clearTimeout(t);
      t = setTimeout(() => setRefreshTick((n) => n + 1), 1_500);
    };

    // Every count-bearing table announces its changes with a broadcast tick
    // (migrations 0097–0099; lib/realtime/tableTicks.ts) — the same cost for
    // every open tab, where postgres_changes ran a row-level-security check
    // per listening tab for each change.
    const unsubscribe = subscribeTableTicks(["leads", ...COUNT_TABLES], bump);

    return () => {
      if (t) clearTimeout(t);
      unsubscribe();
    };
  }, []);

  return counts;
}
