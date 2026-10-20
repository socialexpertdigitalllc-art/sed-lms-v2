"use client";

import { useEffect, useState } from "react";
import { BellRing, X } from "lucide-react";
import { btnPrimary, iconBtn } from "@/components/common/buttons";
import { useToast } from "@/components/common/Toast";
import { enablePush, pushServerReady, pushStatus, syncPush } from "@/lib/push/client";

const DISMISS_KEY = "sed.push.prompt.dismissedAt";
const SYNC_KEY = "sed.push.synced";
/** "Not now" quiets the card for a week. */
const SNOOZE_MS = 7 * 24 * 60 * 60_000;

function snoozed(): boolean {
  try {
    const at = Number(localStorage.getItem(DISMISS_KEY) ?? 0);
    return Number.isFinite(at) && Date.now() - at < SNOOZE_MS;
  } catch {
    return false;
  }
}

/**
 * The once-a-week nudge to turn on desktop/phone notifications, for people
 * whose browser has not been asked yet — plus a quiet once-per-session re-sync
 * for browsers that already said yes (keeps the server's copy current). It
 * never opens the browser's permission prompt on its own: only the button can.
 */
export function PushPrompt() {
  const { toast } = useToast();
  const [show, setShow] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const status = await pushStatus();
      if (cancelled) return;
      if (status === "on" || (typeof Notification !== "undefined" && Notification.permission === "granted")) {
        try {
          if (sessionStorage.getItem(SYNC_KEY)) return;
          sessionStorage.setItem(SYNC_KEY, "1");
        } catch {
          /* storage blocked — sync anyway */
        }
        await syncPush();
        return;
      }
      if (status === "off" && !snoozed() && (await pushServerReady()).ready && !cancelled) setShow(true);
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  if (!show) return null;

  function dismiss() {
    try {
      localStorage.setItem(DISMISS_KEY, String(Date.now()));
    } catch {
      /* fine — it just asks again next visit */
    }
    setShow(false);
  }

  async function turnOn() {
    setBusy(true);
    const out = await enablePush();
    setBusy(false);
    if (out.ok) {
      toast({ kind: "success", title: "Notifications are on", body: "You'll be notified even when the LMS isn't open." });
      setShow(false);
    } else {
      toast({ kind: "error", title: out.message });
      dismiss();
    }
  }

  return (
    <div
      role="dialog"
      aria-label="Turn on notifications"
      data-testid="push-prompt"
      className="fixed bottom-4 left-4 z-40 w-[min(22rem,calc(100vw-2rem))] rounded-xl border border-border bg-surface p-4 shadow-xl"
    >
      <div className="flex items-start gap-3">
        <BellRing className="mt-0.5 h-5 w-5 shrink-0 text-accent-ink" />
        <div className="min-w-0 flex-1">
          <p className="text-sm font-semibold text-text">Don&apos;t miss urgent updates</p>
          <p className="mt-0.5 text-xs text-text-muted">
            Turn on notifications to hear about follow-ups, tickets and new leads even when the LMS tab is closed.
          </p>
          <div className="mt-3 flex items-center gap-2">
            <button type="button" className={btnPrimary} onClick={() => void turnOn()} disabled={busy}>
              Turn on
            </button>
            <button type="button" className="px-2 py-2 text-xs text-text-muted hover:text-text" onClick={dismiss}>
              Not now
            </button>
          </div>
        </div>
        <button type="button" className={iconBtn} onClick={dismiss} aria-label="Close" title="Close">
          <X className="h-4 w-4" />
        </button>
      </div>
    </div>
  );
}
