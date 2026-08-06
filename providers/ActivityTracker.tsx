"use client";

import { useEffect, useRef } from "react";
import { usePathname } from "next/navigation";
import { resolveClickTarget } from "@/lib/activity/track";

type Ev = { type: "page_view" | "click" | "focus"; path?: string; label?: string; meta?: Record<string, string> };

export function ActivityTracker() {
  const pathname = usePathname();
  const queue = useRef<Ev[]>([]);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  function flush() {
    if (timer.current) {
      clearTimeout(timer.current);
      timer.current = null;
    }
    const events = queue.current;
    if (events.length === 0) return;
    queue.current = [];
    const body = JSON.stringify({ events });
    if (navigator.sendBeacon) {
      navigator.sendBeacon("/api/activity/track", new Blob([body], { type: "application/json" }));
    } else {
      fetch("/api/activity/track", { method: "POST", headers: { "Content-Type": "application/json" }, body, keepalive: true }).catch(() => {});
    }
  }

  function push(ev: Ev) {
    queue.current.push(ev);
    // 30s batching (was 5s). Every flush is a DB commit — an insert plus a
    // session heartbeat — and with the whole team's tabs open, 5s flushes
    // produced a steady stream of tiny writes that ate the database's burstable
    // disk-IO budget. Nothing user-facing reads this data live; the admin logs
    // page tolerates 30s of lag. The cap stays under the schema's max(50).
    if (queue.current.length >= 40) flush();
    else if (!timer.current) timer.current = setTimeout(flush, 30_000);
  }

  useEffect(() => {
    push({ type: "page_view", path: pathname });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pathname]);

  useEffect(() => {
    function onClick(e: MouseEvent) {
      const info = resolveClickTarget(e.target as Element | null);
      if (info) push({ type: "click", path: pathname, label: info.label, meta: info.meta });
    }
    function onVisibility() {
      push({ type: "focus", path: pathname, label: document.hidden ? "left" : "returned" });
      if (document.hidden) flush();
    }
    function onPageHide() {
      flush();
    }
    document.addEventListener("click", onClick, true);
    document.addEventListener("visibilitychange", onVisibility);
    window.addEventListener("pagehide", onPageHide);
    return () => {
      document.removeEventListener("click", onClick, true);
      document.removeEventListener("visibilitychange", onVisibility);
      window.removeEventListener("pagehide", onPageHide);
      flush();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pathname]);

  return null;
}
