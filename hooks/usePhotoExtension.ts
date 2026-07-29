"use client";

import { useSyncExternalStore } from "react";

/**
 * Client half of the extension bridge (see the design, §4).
 *
 * The extension announces itself with READY, so "installed" is never guessed
 * from a timeout — no handshake simply means not installed yet.
 *
 * MODULE-SCOPE SINGLETON. The `message` listener, the `pending` request map,
 * and the shared state below all live at module scope, not inside the React
 * hook. `capture()` can be started by a component that unmounts moments
 * later — NewLeadForm kicks off a capture, then immediately
 * `router.push`es to the new lead's page. If the listener and pending map
 * lived inside the hook (torn down on unmount, per component instance),
 * the extension's DONE message would arrive with nothing left to route it
 * to, and the promise NewLeadForm created would never resolve — only the
 * watchdog below would ever settle it, with a false "timed out" failure.
 * Living here instead, the singleton listener keeps routing DONE/ERROR to
 * the right pending entry no matter which components are mounted, and every
 * consumer of the hook observes the same `capturing`/`progress`, so two
 * mounted consumers (e.g. NewLeadForm's background capture and the lead
 * page's LeadPhotoPicker mounting right after) never race each other over
 * "is a capture already running".
 */

export type WirePhoto = { key: string; thumbUrl: string; sourceUrl: string };

export type ExtensionState = {
  installed: boolean;
  version: string | null;
  capturing: boolean;
  progress: number;
};

const PAGE = "sed-lms";
const EXT = "sed-photo-ext";

// If the extension never answers (operator closes the popup mid-capture,
// service worker crashes, etc.) the page must not hang forever waiting for a
// DONE/ERROR that will never arrive — that would leave `capturing` stuck
// true and the UI spinning with no way out.
const CAPTURE_TIMEOUT_MS = 60_000;

let state: ExtensionState = { installed: false, version: null, capturing: false, progress: 0 };
// Stable reference for SSR / the initial client snapshot before anything has
// happened — never mutated, so useSyncExternalStore never sees it "change".
const INITIAL_STATE: ExtensionState = state;

const subscribers = new Set<() => void>();

const pending = new Map<
  string,
  { resolve: (p: WirePhoto[]) => void; reject: (e: Error) => void; timer: ReturnType<typeof setTimeout> }
>();

let listenerInstalled = false;

function setState(patch: Partial<ExtensionState>) {
  state = { ...state, ...patch };
  subscribers.forEach((cb) => cb());
}

function onMessage(event: MessageEvent) {
  if (event.source !== window || event.origin !== window.location.origin) return;
  const data = event.data as { source?: string; type?: string; [k: string]: unknown };
  if (data?.source !== EXT) return;

  if (data.type === "READY") {
    setState({ installed: true, version: (data.version as string) ?? null });
  } else if (data.type === "PROGRESS") {
    setState({ progress: (data.loaded as number) ?? 0 });
  } else if (data.type === "DONE") {
    const requestId = data.requestId as string;
    const entry = pending.get(requestId);
    pending.delete(requestId);
    if (entry) clearTimeout(entry.timer);
    setState({ capturing: false });
    entry?.resolve((data.photos as WirePhoto[]) ?? []);
  } else if (data.type === "ERROR") {
    const requestId = data.requestId as string;
    const entry = pending.get(requestId);
    pending.delete(requestId);
    if (entry) clearTimeout(entry.timer);
    setState({ capturing: false });
    entry?.reject(new Error((data.error as string) ?? "Capture failed"));
  }
}

/**
 * Installed lazily on first subscriber, never removed on unmount — see the
 * module-level note above for why this must outlive any single component.
 * SSR-safe: this module is imported by client components that may still be
 * evaluated during server rendering, where `window` does not exist.
 */
function ensureListener() {
  if (listenerInstalled || typeof window === "undefined") return;
  listenerInstalled = true;
  window.addEventListener("message", onMessage);
  // Ask, in case the extension loaded before any consumer subscribed.
  window.postMessage({ source: PAGE, type: "PING" }, window.location.origin);
}

function subscribe(onStoreChange: () => void): () => void {
  ensureListener();
  subscribers.add(onStoreChange);
  return () => {
    subscribers.delete(onStoreChange);
  };
}

function getSnapshot(): ExtensionState {
  return state;
}

function getServerSnapshot(): ExtensionState {
  return INITIAL_STATE;
}

function capture(url: string): Promise<WirePhoto[]> {
  return new Promise((resolve, reject) => {
    if (typeof window === "undefined") {
      reject(new Error("Capture is unavailable outside the browser"));
      return;
    }
    const requestId = `cap_${Date.now()}_${Math.random().toString(16).slice(2)}`;
    const timer = setTimeout(() => {
      pending.delete(requestId);
      setState({ capturing: false });
      reject(new Error("Capture timed out — the extension did not respond"));
    }, CAPTURE_TIMEOUT_MS);
    pending.set(requestId, { resolve, reject, timer });
    setState({ capturing: true, progress: 0 });
    window.postMessage({ source: PAGE, type: "CAPTURE", requestId, url, max: 30 }, window.location.origin);
  });
}

export function usePhotoExtension() {
  const snapshot = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
  return { ...snapshot, capture };
}
