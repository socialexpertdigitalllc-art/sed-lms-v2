"use client";

import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";

// Every table whose row count feeds a sidebar badge. Some may not be in the
// realtime publication — subscribing is harmless if no events arrive; the
// mount fetch still seeds the counts either way.
const COUNT_TABLES = [
  "leads",
  "lead_tickets",
  "feedback",
  "pre_leads",
  "payment_links",
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
  useEffect(() => {
    const tick = () => setRefreshTick((n) => n + 1);
    const interval = setInterval(tick, 60_000);
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
    const supabase = createClient();
    let t: ReturnType<typeof setTimeout> | null = null;
    let cancelled = false;
    const channel = supabase.channel("rt-nav-counts");

    const bump = () => {
      if (t) clearTimeout(t);
      t = setTimeout(() => setRefreshTick((n) => n + 1), 400);
    };

    (async () => {
      const { data } = await supabase.auth.getSession();
      if (cancelled) return;
      if (data.session) supabase.realtime.setAuth(data.session.access_token);
      for (const table of COUNT_TABLES) {
        channel.on("postgres_changes", { event: "*", schema: "public", table }, bump);
      }
      channel.subscribe();
    })();

    return () => {
      cancelled = true;
      if (t) clearTimeout(t);
      supabase.removeChannel(channel);
    };
  }, []);

  return counts;
}
