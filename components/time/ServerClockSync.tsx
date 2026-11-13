"use client";

import { useEffect } from "react";
import { setServerNow } from "@/lib/time/pakistanTime";

/** Re-check the server's clock this often, and when a tab comes back after a while. */
const RESYNC_MS = 10 * 60 * 1000;
/** Ignore differences smaller than this (network jitter). */
const MIN_CHANGE_MS = 2000;

/**
 * Keeps the page's clock on the SERVER's time (lib/time/pakistanTime.ts).
 * The page starts stamped with the server time; this refines it over the
 * network (half the round trip added) and corrects it if the device's own
 * clock is changed while the page is open. Renders nothing.
 */
export function ServerClockSync() {
  useEffect(() => {
    let last = 0;
    let stopped = false;
    async function sync() {
      last = performance.now();
      try {
        const started = performance.now();
        const res = await fetch("/api/time", { cache: "no-store" });
        if (!res.ok) return;
        const body = (await res.json()) as { now?: unknown };
        const rtt = performance.now() - started;
        if (!stopped && typeof body.now === "number") setServerNow(body.now + rtt / 2, MIN_CHANGE_MS);
      } catch {
        /* offline: keep the clock we have */
      }
    }
    void sync();
    const timer = window.setInterval(sync, RESYNC_MS);
    const onVisible = () => {
      if (document.visibilityState === "visible" && performance.now() - last > 60_000) void sync();
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      stopped = true;
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, []);
  return null;
}
