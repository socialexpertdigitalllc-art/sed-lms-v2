"use client";

import { useEffect } from "react";

/**
 * Registers /sw.js — scoped to /verify, and mounted ONLY by the /verify page.
 *
 * The worker itself is a pure network passthrough that caches nothing (see
 * public/sw.js for why that matters for an authenticated app); it exists purely
 * because Chrome requires a registered `fetch` handler before it will offer
 * "Install app".
 */
export function ServiceWorkerRegistrar() {
  useEffect(() => {
    if (typeof navigator === "undefined" || !("serviceWorker" in navigator)) return;
    // Registration failures are never worth surfacing: the page works fine
    // without it, you just don't get the install prompt.
    navigator.serviceWorker.register("/sw.js", { scope: "/verify" }).catch(() => {});
  }, []);

  return null;
}
