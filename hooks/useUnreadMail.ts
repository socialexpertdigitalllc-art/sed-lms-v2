"use client";

import { useCallback, useEffect, useState } from "react";

const POLL_MS = 60_000;

/**
 * Unread INBOX count for the sidebar Mailbox badge. Fetches on mount, polls
 * every 60s, and refreshes when the tab regains focus/visibility so the badge
 * is fresh the moment the user comes back. Fail-soft: any error leaves the
 * last known count in place (0 until the first successful fetch).
 */
export function useUnreadMail(enabled = true): number {
  const [unread, setUnread] = useState(0);

  const load = useCallback(async (alive: () => boolean) => {
    try {
      const res = await fetch("/api/mail/unread");
      if (!res.ok) return;
      const data = (await res.json()) as { unread?: number };
      if (alive() && typeof data.unread === "number") setUnread(data.unread);
    } catch {
      /* fail-soft — badge just keeps its previous value */
    }
  }, []);

  useEffect(() => {
    if (!enabled) {
      setUnread(0);
      return;
    }
    let active = true;
    const alive = () => active;

    void load(alive);
    const timer = setInterval(() => void load(alive), POLL_MS);

    const onFocus = () => void load(alive);
    const onVisibility = () => {
      if (document.visibilityState === "visible") void load(alive);
    };
    window.addEventListener("focus", onFocus);
    document.addEventListener("visibilitychange", onVisibility);

    return () => {
      active = false;
      clearInterval(timer);
      window.removeEventListener("focus", onFocus);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [enabled, load]);

  return unread;
}
