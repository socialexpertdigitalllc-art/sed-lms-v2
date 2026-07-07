"use client";

import { useState } from "react";
import { NOTIFICATION_EVENTS } from "@/lib/notifications/events";

type Row = { event_key: string; enabled: boolean; lead_time_minutes: number };
type State = { enabled: boolean; leadTimeMinutes: number };

const inputCls =
  "w-20 px-2 py-1 rounded-md border border-border bg-surface text-sm outline-none focus:ring-2 focus:ring-accent";

export function NotificationSettings({
  userId,
  rows,
}: {
  userId: string;
  rows: Row[];
}) {
  const byKey = new Map(rows.map((r) => [r.event_key, r]));

  const [state, setState] = useState<Record<string, State>>(() => {
    const init: Record<string, State> = {};
    for (const ev of NOTIFICATION_EVENTS) {
      const row = byKey.get(ev.key);
      init[ev.key] = {
        enabled: row ? row.enabled : true,
        leadTimeMinutes: row ? row.lead_time_minutes : ev.defaultLeadTimeMinutes,
      };
    }
    return init;
  });

  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  function update(key: string, patch: Partial<State>) {
    setState((prev) => ({ ...prev, [key]: { ...prev[key], ...patch } }));
  }

  async function save() {
    setSaving(true);
    setMsg(null);
    const settings = NOTIFICATION_EVENTS.map((ev) => ({
      event_key: ev.key,
      enabled: state[ev.key].enabled,
      lead_time_minutes: Math.max(1, Math.round(state[ev.key].leadTimeMinutes) || 1),
    }));
    const res = await fetch(`/api/admin/users/${userId}/notification-settings`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ settings }),
    });
    setSaving(false);
    if (!res.ok) {
      setMsg({ ok: false, text: (await res.json().catch(() => ({}))).error ?? "Failed to save" });
      return;
    }
    setMsg({ ok: true, text: "Notification settings saved" });
  }

  return (
    <section className="bg-surface border border-border rounded-lg p-4">
      <div className="text-sm font-medium text-text mb-1">Notifications</div>
      <p className="text-xs text-text-muted mb-3">
        Choose which events this user is notified about, and how far in advance.
      </p>
      {msg && (
        <div
          className={
            "mb-3 text-xs rounded-md px-3 py-2 " +
            (msg.ok ? "bg-ready-bg text-ready-fg" : "bg-dropped-bg text-dropped-fg")
          }
        >
          {msg.text}
        </div>
      )}
      <div className="space-y-3">
        {NOTIFICATION_EVENTS.map((ev) => {
          const s = state[ev.key];
          return (
            <div
              key={ev.key}
              className="flex items-start justify-between gap-3 border-b border-border pb-3 last:border-0 last:pb-0"
            >
              <div className="min-w-0">
                <div className="text-sm text-text">{ev.label}</div>
                <div className="text-xs text-text-muted">{ev.description}</div>
              </div>
              <div className="flex items-center gap-3 shrink-0">
                {ev.hasTiming && (
                  <label className="flex items-center gap-1.5 text-xs text-text-muted">
                    <input
                      type="number"
                      min={1}
                      value={s.leadTimeMinutes}
                      onChange={(e) =>
                        update(ev.key, { leadTimeMinutes: Number(e.target.value) })
                      }
                      disabled={!s.enabled}
                      className={inputCls + (s.enabled ? "" : " opacity-50")}
                    />
                    min before
                  </label>
                )}
                <label className="flex items-center gap-1.5 text-xs text-text">
                  <input
                    type="checkbox"
                    checked={s.enabled}
                    onChange={(e) => update(ev.key, { enabled: e.target.checked })}
                    className="accent-accent"
                  />
                  Enabled
                </label>
              </div>
            </div>
          );
        })}
      </div>
      <button
        onClick={save}
        disabled={saving}
        className="mt-4 px-3 py-2 text-xs font-semibold rounded-md bg-accent text-white hover:bg-accent-ink disabled:opacity-60"
      >
        {saving ? "Saving…" : "Save notifications"}
      </button>
    </section>
  );
}
