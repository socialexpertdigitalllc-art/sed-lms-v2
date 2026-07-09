"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import type { AppSettings } from "@/lib/settings/appSettings";

const inputCls =
  "w-full px-3 py-2 rounded-md border border-border bg-surface text-sm text-text outline-none focus:ring-2 focus:ring-accent";

// Postgres `time` columns serialize as "HH:MM:SS"; <input type="time"> and
// our PUT validator both want plain "HH:MM".
const hhmm = (t: string) => t.slice(0, 5);

// Common IANA zones for the picker. The stored value is always ensured present
// (prepended if custom), so an admin can still hold a zone outside this list.
const COMMON_TIMEZONES = [
  "Asia/Karachi",
  "Asia/Kolkata",
  "Asia/Dubai",
  "Asia/Dhaka",
  "Asia/Manila",
  "Asia/Singapore",
  "Europe/London",
  "Europe/Berlin",
  "America/New_York",
  "America/Chicago",
  "America/Denver",
  "America/Los_Angeles",
  "Australia/Sydney",
  "UTC",
];

export function AppSettingsCard({ initial }: { initial: AppSettings }) {
  const router = useRouter();
  const [workStartTime, setWorkStartTime] = useState(hhmm(initial.work_start_time));
  const [workTimezone, setWorkTimezone] = useState(initial.work_timezone);
  const [idleTimeoutMinutes, setIdleTimeoutMinutes] = useState(initial.idle_timeout_minutes);
  const [slaLow, setSlaLow] = useState(initial.ticket_sla.Low);
  const [slaNormal, setSlaNormal] = useState(initial.ticket_sla.Normal);
  const [slaHigh, setSlaHigh] = useState(initial.ticket_sla.High);
  const [ticketRetentionDays, setTicketRetentionDays] = useState(initial.ticket_retention_days);
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  async function save() {
    setSaving(true);
    setMsg(null);
    const res = await fetch("/api/admin/settings", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        work_start_time: hhmm(workStartTime),
        work_timezone: workTimezone.trim(),
        idle_timeout_minutes: Math.max(1, Math.round(Number(idleTimeoutMinutes)) || 1),
        ticket_sla: {
          Low: Math.max(1, Math.round(Number(slaLow)) || 1),
          Normal: Math.max(1, Math.round(Number(slaNormal)) || 1),
          High: Math.max(1, Math.round(Number(slaHigh)) || 1),
        },
        ticket_retention_days: Math.max(0, Math.round(Number(ticketRetentionDays)) || 0),
      }),
    });
    setSaving(false);
    if (!res.ok) {
      setMsg({ ok: false, text: (await res.json().catch(() => ({}))).error ?? "Failed to save" });
      return;
    }
    setMsg({ ok: true, text: "Settings saved" });
    router.refresh();
  }

  return (
    <section className="bg-surface border border-border rounded-lg p-5">
      <div className="text-sm font-semibold text-text mb-1">Work Hours & Sessions</div>
      <p className="text-xs text-text-muted mb-4">
        Sets the expected start of day (used for punctuality) and how long an idle session
        is still counted as online.
      </p>
      {msg && (
        <div
          className={
            "mb-4 text-sm rounded-md px-3 py-2 " +
            (msg.ok ? "bg-ready-bg text-ready-fg" : "bg-dropped-bg text-dropped-fg")
          }
        >
          {msg.text}
        </div>
      )}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <div>
          <label className="block text-xs font-medium text-text-muted mb-1">Work start time</label>
          <input
            type="time"
            value={workStartTime}
            onChange={(e) => setWorkStartTime(e.target.value)}
            className={inputCls}
          />
        </div>
        <div>
          <label className="block text-xs font-medium text-text-muted mb-1">Work timezone</label>
          <select
            value={workTimezone}
            onChange={(e) => setWorkTimezone(e.target.value)}
            className={inputCls}
          >
            {(COMMON_TIMEZONES.includes(workTimezone)
              ? COMMON_TIMEZONES
              : [workTimezone, ...COMMON_TIMEZONES]
            ).map((tz) => (
              <option key={tz} value={tz}>
                {tz}
              </option>
            ))}
          </select>
          <p className="text-xs text-text-faint mt-1">Used for day boundaries & lateness</p>
        </div>
        <div>
          <label className="block text-xs font-medium text-text-muted mb-1">
            Idle timeout (minutes)
          </label>
          <input
            type="number"
            min={1}
            value={idleTimeoutMinutes}
            onChange={(e) => setIdleTimeoutMinutes(Number(e.target.value))}
            className={inputCls}
          />
        </div>
      </div>

      <div className="mt-6 pt-5 border-t border-border">
        <div className="text-sm font-semibold text-text mb-1">Tickets</div>
        <p className="text-xs text-text-muted mb-4">
          SLA hours before a ticket by priority is considered overdue, and how long resolved
          tickets are kept before they&apos;re automatically deleted.
        </p>
        <div className="grid grid-cols-1 sm:grid-cols-4 gap-4">
          <div>
            <label className="block text-xs font-medium text-text-muted mb-1">SLA — Low (hrs)</label>
            <input
              type="number"
              min={1}
              value={slaLow}
              onChange={(e) => setSlaLow(Number(e.target.value))}
              className={inputCls}
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-text-muted mb-1">SLA — Normal (hrs)</label>
            <input
              type="number"
              min={1}
              value={slaNormal}
              onChange={(e) => setSlaNormal(Number(e.target.value))}
              className={inputCls}
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-text-muted mb-1">SLA — High (hrs)</label>
            <input
              type="number"
              min={1}
              value={slaHigh}
              onChange={(e) => setSlaHigh(Number(e.target.value))}
              className={inputCls}
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-text-muted mb-1">Retention (days)</label>
            <input
              type="number"
              min={0}
              value={ticketRetentionDays}
              onChange={(e) => setTicketRetentionDays(Number(e.target.value))}
              className={inputCls}
            />
            <p className="text-xs text-text-faint mt-1">0 = never auto-delete</p>
          </div>
        </div>
      </div>

      <div className="mt-4">
        <button
          onClick={save}
          disabled={saving}
          className="px-4 py-2 text-sm font-semibold rounded-md bg-accent text-white hover:bg-accent-ink disabled:opacity-60"
        >
          {saving ? "Saving…" : "Save settings"}
        </button>
      </div>
    </section>
  );
}
