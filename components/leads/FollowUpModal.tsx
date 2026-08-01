"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { validateFollowUp } from "@/lib/leads/followups";
import { settableStatuses } from "@/lib/leads/categories";
import { usePermissions } from "@/hooks/usePermissions";
import { inOffset } from "@/lib/dates/datetimeLocal";
import { RadioPillGroup } from "@/components/forms/RadioPillGroup";
import { inputCls } from "@/components/forms/Field";

const QUICK_MINUTE_PRESETS = [15, 30, 60, 120] as const;

export function FollowUpModal({
  leadId,
  businessName,
  open,
  onClose,
}: {
  leadId: string;
  businessName: string;
  open: boolean;
  onClose: () => void;
}) {
  const router = useRouter();
  const { all } = usePermissions();
  const [fu_status, setFuStatus] = useState<"" | "Pickup" | "No Pickup">("");
  const [comments, setComments] = useState("");
  const [next_follow_up_time, setNextFollowUpTime] = useState("");
  // "In X days/hours/minutes" quick-set; cleared when the datetime is edited by hand (one-way).
  const [quickDays, setQuickDays] = useState("");
  const [quickHours, setQuickHours] = useState("");
  const [quickMins, setQuickMins] = useState("");
  const [status_change, setStatusChange] = useState("");
  const [busy, setBusy] = useState(false);
  const [apiError, setApiError] = useState<string | null>(null);
  const [errors, setErrors] = useState<Record<string, string>>({});

  const settable = settableStatuses(all);

  if (!open) return null;

  function clearError(key: string) {
    setErrors((prev) => {
      if (!prev[key]) return prev;
      const next = { ...prev };
      delete next[key];
      return next;
    });
  }

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
      setNextFollowUpTime(inOffset(total));
      clearError("next_follow_up_time");
    }
  }

  async function save() {
    const errs = validateFollowUp({ fu_status, next_follow_up_time }, new Date());
    setErrors(errs);
    if (Object.keys(errs).length > 0) return;

    setBusy(true);
    setApiError(null);
    const res = await fetch(`/api/leads/${leadId}/follow-ups`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        fu_status,
        comments: fu_status === "Pickup" ? comments.trim() || null : null,
        next_follow_up_time: next_follow_up_time
          ? new Date(next_follow_up_time).toISOString()
          : null,
        status_change: fu_status === "Pickup" && status_change ? status_change : null,
      }),
    });
    setBusy(false);
    if (!res.ok) {
      setApiError((await res.json().catch(() => ({}))).error ?? "Failed to save follow-up");
      return;
    }
    onClose();
    router.refresh();
  }

  const labelCls = "block text-[10px] uppercase tracking-wide text-text-faint mb-1";

  return (
    <div role="dialog" aria-modal="true" className="fixed inset-0 bg-black/30 grid place-items-center z-50 p-4">
      <div
        onClick={(e) => e.stopPropagation()}
        className="bg-surface border border-border rounded-lg p-6 w-full max-w-[420px] max-h-[90vh] overflow-y-auto"
      >
        <h2 className="font-semibold text-text">Log follow-up</h2>
        <p className="text-sm text-text-muted mt-1 mb-4 truncate">{businessName}</p>

        {apiError && (
          <div className="mb-3 text-sm text-dropped-fg bg-dropped-bg rounded-md px-3 py-2">
            {apiError}
          </div>
        )}

        <div className="space-y-4">
          <div>
            <label className={labelCls}>Follow Up status</label>
            <RadioPillGroup
              options={["Pickup", "No Pickup"]}
              value={fu_status}
              onChange={(v) => {
                setFuStatus(v as "Pickup" | "No Pickup");
                clearError("fu_status");
                clearError("next_follow_up_time");
              }}
            />
            {errors.fu_status && (
              <p className="text-[11px] text-dropped-fg mt-1">{errors.fu_status}</p>
            )}
          </div>

          {fu_status === "Pickup" && (
            <div>
              <label className={labelCls}>Follow Up Comments</label>
              <textarea
                className={inputCls}
                rows={3}
                value={comments}
                onChange={(e) => setComments(e.target.value)}
              />
            </div>
          )}

          {fu_status && (
            <div>
              <label className={labelCls}>Next Follow Up time</label>
              <div className="mb-2 flex flex-wrap items-center gap-1.5">
                <span className="text-xs text-text-muted">In</span>
                <input
                  type="number"
                  min={0}
                  value={quickDays}
                  onChange={(e) => applyQuickOffset({ days: e.target.value })}
                  aria-label="Next follow-up in days"
                  className="w-14 rounded-md border border-border bg-surface px-2 py-1 text-sm text-text outline-none focus:ring-2 focus:ring-accent"
                />
                <span className="text-xs text-text-muted">d</span>
                <input
                  type="number"
                  min={0}
                  value={quickHours}
                  onChange={(e) => applyQuickOffset({ hours: e.target.value })}
                  aria-label="Next follow-up in hours"
                  className="w-14 rounded-md border border-border bg-surface px-2 py-1 text-sm text-text outline-none focus:ring-2 focus:ring-accent"
                />
                <span className="text-xs text-text-muted">h</span>
                <input
                  type="number"
                  min={0}
                  value={quickMins}
                  onChange={(e) => applyQuickOffset({ mins: e.target.value })}
                  aria-label="Next follow-up in minutes"
                  className="w-16 rounded-md border border-border bg-surface px-2 py-1 text-sm text-text outline-none focus:ring-2 focus:ring-accent"
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
                className={inputCls}
                value={next_follow_up_time}
                onChange={(e) => {
                  setNextFollowUpTime(e.target.value);
                  setQuickDays("");
                  setQuickHours("");
                  setQuickMins("");
                  clearError("next_follow_up_time");
                }}
              />
              <p className="text-[11px] text-text-faint mt-1">Required</p>
              {errors.next_follow_up_time && (
                <p className="text-[11px] text-dropped-fg mt-1">{errors.next_follow_up_time}</p>
              )}
            </div>
          )}

          {fu_status === "Pickup" && (
            <div>
              <label className={labelCls}>Status update</label>
              <select
                className={inputCls}
                value={status_change}
                onChange={(e) => setStatusChange(e.target.value)}
              >
                <option value="">— keep current —</option>
                {settable.map((s) => (
                  <option key={s} value={s}>
                    {s}
                  </option>
                ))}
              </select>
            </div>
          )}
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
            disabled={busy || !fu_status}
            className="px-4 py-2 text-sm rounded-md bg-accent text-white font-semibold hover:bg-accent-ink disabled:opacity-60"
          >
            {busy ? "Saving…" : "Save"}
          </button>
        </div>
      </div>
    </div>
  );
}
