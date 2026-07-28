"use client";

import { useCallback, useEffect, useRef, useState } from "react";

/**
 * Client half of the extension bridge (see the design, §4).
 *
 * The extension announces itself with READY, so "installed" is never guessed
 * from a timeout — no handshake simply means not installed yet.
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

export function usePhotoExtension() {
  const [state, setState] = useState<ExtensionState>({ installed: false, version: null, capturing: false, progress: 0 });
  const pending = useRef<Map<string, { resolve: (p: WirePhoto[]) => void; reject: (e: Error) => void; timer: ReturnType<typeof setTimeout> }>>(
    new Map(),
  );

  useEffect(() => {
    function onMessage(event: MessageEvent) {
      if (event.source !== window || event.origin !== window.location.origin) return;
      const data = event.data as { source?: string; type?: string; [k: string]: unknown };
      if (data?.source !== EXT) return;

      if (data.type === "READY") {
        setState((s) => ({ ...s, installed: true, version: (data.version as string) ?? null }));
      } else if (data.type === "PROGRESS") {
        setState((s) => ({ ...s, progress: (data.loaded as number) ?? 0 }));
      } else if (data.type === "DONE") {
        const requestId = data.requestId as string;
        const entry = pending.current.get(requestId);
        pending.current.delete(requestId);
        if (entry) clearTimeout(entry.timer);
        setState((s) => ({ ...s, capturing: false }));
        entry?.resolve((data.photos as WirePhoto[]) ?? []);
      } else if (data.type === "ERROR") {
        const requestId = data.requestId as string;
        const entry = pending.current.get(requestId);
        pending.current.delete(requestId);
        if (entry) clearTimeout(entry.timer);
        setState((s) => ({ ...s, capturing: false }));
        entry?.reject(new Error((data.error as string) ?? "Capture failed"));
      }
    }

    window.addEventListener("message", onMessage);
    // Ask, in case the extension loaded before this component mounted.
    window.postMessage({ source: PAGE, type: "PING" }, window.location.origin);
    return () => window.removeEventListener("message", onMessage);
  }, []);

  const capture = useCallback((url: string): Promise<WirePhoto[]> => {
    return new Promise((resolve, reject) => {
      const requestId = `cap_${Date.now()}_${Math.random().toString(16).slice(2)}`;
      const timer = setTimeout(() => {
        pending.current.delete(requestId);
        setState((s) => ({ ...s, capturing: false }));
        reject(new Error("Capture timed out — the extension did not respond"));
      }, CAPTURE_TIMEOUT_MS);
      pending.current.set(requestId, { resolve, reject, timer });
      setState((s) => ({ ...s, capturing: true, progress: 0 }));
      window.postMessage({ source: PAGE, type: "CAPTURE", requestId, url, max: 30 }, window.location.origin);
    });
  }, []);

  return { ...state, capture };
}
