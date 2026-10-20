"use client";

import { useCallback, useEffect, useState } from "react";
import { BellRing, Loader2 } from "lucide-react";
import { useToast } from "@/components/common/Toast";
import { btnPrimary, btnSecondarySm } from "@/components/common/buttons";
import { currentSubscription, disablePush, enablePush, pushServerReady, pushStatus, type PushStatus } from "@/lib/push/client";

/**
 * Desktop & phone notifications for THIS browser: turn on, turn off, send a
 * test, and the one fix for each way it can be unavailable.
 */
export function PushSettingsCard() {
  const { toast } = useToast();
  const [status, setStatus] = useState<PushStatus | null>(null);
  const [devices, setDevices] = useState(0);
  const [busy, setBusy] = useState<"on" | "off" | "test" | null>(null);
  const [server, setServer] = useState<{ ready: boolean; reason: string | null }>({ ready: true, reason: null });

  const refresh = useCallback(async () => {
    const [s, srv] = await Promise.all([pushStatus(), pushServerReady()]);
    setServer(srv);
    setStatus(s);
    const sub = await currentSubscription();
    try {
      const q = sub ? `?endpoint=${encodeURIComponent(sub.endpoint)}` : "";
      const res = await fetch(`/api/push/subscriptions${q}`);
      const j = (await res.json().catch(() => ({}))) as { devices?: number; thisDevice?: boolean };
      if (res.ok) {
        setDevices(j.devices ?? 0);
        // Allowed in the browser but unknown to the server → not really on.
        if (s === "on" && j.thisDevice === false) setStatus("off");
      }
    } catch {
      /* the card still works without the device count */
    }
  }, []);

  useEffect(() => {
    // Push state lives in the browser, so it can only be read after mount.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void refresh();
  }, [refresh]);

  async function turnOn() {
    setBusy("on");
    const out = await enablePush();
    setBusy(null);
    if (!out.ok) toast({ kind: "error", title: out.message });
    else toast({ kind: "success", title: "Notifications are on for this browser" });
    await refresh();
  }

  async function turnOff() {
    setBusy("off");
    await disablePush();
    setBusy(null);
    toast({ kind: "info", title: "Notifications are off for this browser" });
    await refresh();
  }

  async function test() {
    setBusy("test");
    try {
      const res = await fetch("/api/push/test", { method: "POST" });
      const j = (await res.json().catch(() => ({}))) as { sent?: number; devices?: number; error?: string };
      if (!res.ok) toast({ kind: "error", title: j.error ?? "Could not send a test" });
      else if (!j.sent) toast({ kind: "error", title: "The test didn't reach any device — turn notifications off and on again." });
      else toast({ kind: "success", title: `Test sent to ${j.sent} device${j.sent === 1 ? "" : "s"}` });
    } finally {
      setBusy(null);
      await refresh();
    }
  }

  if (status === null) return null;
  // Nothing to offer until the server can send (database update 0088).
  if (!server.ready && status !== "on") return null;

  const on = status === "on";
  const others = on ? devices - 1 : devices;
  const help: Record<PushStatus, string> = {
    on: "You'll get a notification on this computer or phone even when the LMS isn't open. Urgent ones stay on screen until you click them.",
    off: "Get a notification on this computer or phone even when the LMS tab is closed — so urgent updates aren't missed.",
    denied:
      "Notifications are blocked for this site. Click the lock (or settings) icon next to the address bar → Notifications → Allow, then reload this page.",
    "ios-install":
      "On iPhone and iPad, notifications work once the LMS is on your Home Screen: in Safari tap Share → Add to Home Screen, open the LMS from there, and turn them on here.",
    unsupported: "This browser can't show notifications. Use Chrome, Edge, Firefox or Safari.",
  };

  return (
    <div data-testid="push-card" className="mb-3 flex flex-wrap items-center gap-3 rounded-lg border border-border bg-surface px-4 py-3">
      <BellRing className={on ? "h-5 w-5 shrink-0 text-accent-ink" : "h-5 w-5 shrink-0 text-text-faint"} />
      <div className="min-w-0 flex-1 basis-64">
        <p className="text-sm font-medium text-text">
          Desktop &amp; phone notifications{" "}
          <span className={on ? "text-xs font-semibold text-ready-fg" : "text-xs font-medium text-text-faint"}>
            · {on ? "On for this browser" : status === "off" ? "Off" : "Unavailable"}
          </span>
        </p>
        <p className="text-xs text-text-muted">
          {help[status]}
          {others > 0 ? ` Also on for ${others} other device${others === 1 ? "" : "s"}.` : ""}
        </p>
      </div>
      <div className="ml-auto flex items-center gap-2">
        {on ? (
          <>
            <button type="button" className={btnSecondarySm} onClick={() => void test()} disabled={busy !== null}>
              {busy === "test" ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : null}
              Send a test
            </button>
            <button type="button" className={btnSecondarySm} onClick={() => void turnOff()} disabled={busy !== null}>
              Turn off
            </button>
          </>
        ) : status === "off" ? (
          <button type="button" data-testid="push-enable" className={btnPrimary} onClick={() => void turnOn()} disabled={busy !== null}>
            {busy === "on" ? <Loader2 className="h-4 w-4 animate-spin" /> : <BellRing className="h-4 w-4" />}
            Turn on
          </button>
        ) : null}
      </div>
    </div>
  );
}
