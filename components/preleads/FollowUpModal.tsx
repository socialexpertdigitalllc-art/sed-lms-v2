"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import {
  PreLead,
  PRELEAD_STATUSES,
  FOLLOWUP_REASONS,
  LEAD_CATEGORIES,
} from "@/lib/preleads/types";
import { toDateTimeLocal } from "@/lib/leads/format";
import { inOffset } from "@/lib/dates/datetimeLocal";

const QUICK_MINUTE_PRESETS = [15, 30, 60, 120] as const;

export function FollowUpModal({
  preLead,
  open,
  onClose,
}: {
  preLead: PreLead;
  open: boolean;
  onClose: () => void;
}) {
  const router = useRouter();
  const [status, setStatus] = useState(preLead.status);
  const [reason, setReason] = useState("");
  const [followUpTime, setFollowUpTime] = useState(toDateTimeLocal(preLead.follow_up_time));
  // "In X days/hours/minutes" quick-set; cleared when the datetime is edited by hand (one-way).
  const [quickDays, setQuickDays] = useState("");
  const [quickHours, setQuickHours] = useState("");
  const [quickMins, setQuickMins] = useState("");
  const [category, setCategory] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!open) return null;

  const isFollowUp = status === "Next follow up";

  /** Any quick field (or a preset click) sets the datetime to now + combined offset. */
  function applyQuickOffset(next: { days?: string; hours?: string; mins?: string }) {
    const days = next.days ?? quickDays;
    const hours = next.hours ?? quickHours;
    const mins = next.mins ?? quickMins;
    if (next.days !== undefined) setQuickDays(next.days);
    if (next.hours !== undefined) setQuickHours(next.hours);
    if (next.mins !== undefined) setQuickMins(next.mins);
    const num = (raw: string) => {
      const n = Number(raw);
      return raw !== "" && Number.isFinite(n) && n >= 0 ? Math.floor(n) : 0;
    };
    const total = { days: num(days), hours: num(hours), minutes: num(mins) };
    if (total.days + total.hours + total.minutes >= 1) {
      setFollowUpTime(inOffset(total));
    }
  }

  async function save() {
    setBusy(true);
    setError(null);
    const body: Record<string, unknown> = { status };
    if (category) body.lead_category = category;
    if (isFollowUp && followUpTime) body.follow_up_time = new Date(followUpTime).toISOString();
    if (isFollowUp && reason) body.reason = reason;

    const res = await fetch(`/api/pre-leads/${preLead.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    setBusy(false);
    if (!res.ok) {
      setError((await res.json().catch(() => ({}))).error ?? "Failed to update");
      return;
    }
    onClose();
    router.refresh();
  }

  return (
    <div className="fixed inset-0 bg-black/30 grid place-items-center z-50 p-4">
      <div
        onClick={(e) => e.stopPropagation()}
        className="bg-surface border border-border rounded-lg p-6 w-full max-w-[400px] max-h-[90vh] overflow-y-auto"
      >
        <h2 className="font-semibold text-text">Update follow-up</h2>
        <p className="text-sm text-text-muted mt-1 mb-4 truncate">{preLead.business_name}</p>

        {error && (
          <div className="mb-3 text-sm text-dropped-fg bg-dropped-bg rounded-md px-3 py-2">{error}</div>
        )}

        <div className="space-y-4">
          <div>
            <label className="text-[10px] uppercase tracking-wide text-text-faint">Status</label>
            <div className="grid grid-cols-3 gap-2 mt-1.5">
              {PRELEAD_STATUSES.map((s) => (
                <button
                  key={s}
                  type="button"
                  onClick={() => setStatus(s)}
                  className={
                    "text-sm rounded-md border px-2 py-2 transition-colors " +
                    (status === s
                      ? "border-accent bg-accent-soft text-accent-ink font-medium"
                      : "border-border text-text-muted hover:bg-surface-2")
                  }
                >
                  {s}
                </button>
              ))}
            </div>
          </div>

          {isFollowUp && (
            <div>
              <label className="text-[10px] uppercase tracking-wide text-text-faint">Reason</label>
              <select
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                className="w-full mt-1.5 px-3 py-2 rounded-md border border-border bg-surface text-sm outline-none focus:ring-2 focus:ring-accent"
              >
                <option value="">— none —</option>
                {FOLLOWUP_REASONS.map((r) => (
                  <option key={r} value={r}>
                    {r}
                  </option>
                ))}
              </select>
            </div>
          )}

          {isFollowUp && (
            <div>
              <label className="text-[10px] uppercase tracking-wide text-text-faint">
                Next follow-up
              </label>
              <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
                <span className="text-xs text-text-muted">In</span>
                <input
                  type="number"
                  min={0}
                  value={quickDays}
                  onChange={(e) => applyQuickOffset({ days: e.target.value })}
                  aria-label="Next follow-up in days"
                  className="w-14 rounded-md border border-border bg-surface px-2 py-1 text-sm outline-none focus:ring-2 focus:ring-accent"
                />
                <span className="text-xs text-text-muted">d</span>
                <input
                  type="number"
                  min={0}
                  value={quickHours}
                  onChange={(e) => applyQuickOffset({ hours: e.target.value })}
                  aria-label="Next follow-up in hours"
                  className="w-14 rounded-md border border-border bg-surface px-2 py-1 text-sm outline-none focus:ring-2 focus:ring-accent"
                />
                <span className="text-xs text-text-muted">h</span>
                <input
                  type="number"
                  min={0}
                  value={quickMins}
                  onChange={(e) => applyQuickOffset({ mins: e.target.value })}
                  aria-label="Next follow-up in minutes"
                  className="w-16 rounded-md border border-border bg-surface px-2 py-1 text-sm outline-none focus:ring-2 focus:ring-accent"
                />
                <span className="text-xs text-text-muted">min</span>
                {QUICK_MINUTE_PRESETS.map((m) => (
                  <button
                    key={m}
                    type="button"
                    onClick={() => applyQuickOffset({ days: "", hours: "", mins: String(m) })}
                    className={
                      "rounded-full border px-2.5 py-1 text-xs transition-colors " +
                      (quickMins === String(m) && !quickDays && !quickHours
                        ? "border-accent bg-accent-soft font-medium text-accent-ink"
                        : "border-border text-text-muted hover:bg-surface-2")
                    }
                  >
                    {m}
                  </button>
                ))}
              </div>
              <input
                type="datetime-local"
                value={followUpTime}
                onChange={(e) => {
                  setFollowUpTime(e.target.value);
                  setQuickDays("");
                  setQuickHours("");
                  setQuickMins("");
                }}
                className="w-full mt-1.5 px-3 py-2 rounded-md border border-border bg-surface text-sm outline-none focus:ring-2 focus:ring-accent"
              />
            </div>
          )}

          <div>
            <label className="text-[10px] uppercase tracking-wide text-text-faint">
              Update category
            </label>
            <select
              value={category}
              onChange={(e) => setCategory(e.target.value)}
              className="w-full mt-1.5 px-3 py-2 rounded-md border border-border bg-surface text-sm outline-none focus:ring-2 focus:ring-accent"
            >
              <option value="">— keep current —</option>
              {LEAD_CATEGORIES.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </select>
          </div>
        </div>

        <div className="flex justify-end gap-2 mt-5">
          <button
            onClick={onClose}
            className="px-4 py-2 text-sm rounded-md border border-border text-text-muted hover:bg-surface-2"
          >
            Cancel
          </button>
          <button
            onClick={save}
            disabled={busy}
            className="px-4 py-2 text-sm rounded-md bg-accent text-white font-semibold hover:bg-accent-ink disabled:opacity-60"
          >
            {busy ? "Saving…" : "Save"}
          </button>
        </div>
      </div>
    </div>
  );
}
