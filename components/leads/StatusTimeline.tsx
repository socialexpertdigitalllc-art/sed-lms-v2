"use client";

import { useState } from "react";
import { Check, Pencil, X, AlertTriangle, Info } from "lucide-react";
import { DateTimeField } from "@/components/common/DateTimeField";
import { formatDateTimeLong, toDateTimeLocal } from "@/lib/leads/format";
import { monthKey, monthLabel } from "@/lib/analytics/dateScope";
import {
  checkCorrection,
  currentStatusEvent,
  initialStatus,
  isCountedStatus,
  type StatusHistory,
  type StatusHistoryEvent,
} from "@/lib/leads/statusHistory";
import { StatusPill } from "./StatusPill";
import { useCompanyTimezone } from "@/providers/CompanyTimezoneProvider";

const DOT: Record<string, string> = {
  Ready: "bg-ready-fg",
  "Not Ready": "bg-notready-fg",
  Closed: "bg-closed-fg",
  Dropped: "bg-dropped-fg",
  "Long Term": "bg-longterm-fg",
};
const dot = (status: string | null) => (status && DOT[status]) || "bg-text-faint";

/** What changed, then when: stacked in the hover card and on phones, one line otherwise. */
const lineLayout = (compact: boolean) =>
  compact
    ? "flex flex-col items-start gap-0.5"
    : "flex flex-col items-start gap-0.5 sm:flex-row sm:items-center sm:justify-between sm:gap-x-3";

/** The month a report counts this date in — the dashboard's own rule, in the company's timezone. */
const countsIn = (iso: string, tz: string) => monthLabel(monthKey(iso, tz));

/**
 * When the lead was submitted and every status change since, oldest first.
 * `compact` is the leads-table hover: no editing, the latest few changes only.
 * With `canCorrect` (Admin department) each change's date can be moved — the
 * fix for a lead closed in one month but marked Closed in the next.
 */
export function StatusTimeline({
  history,
  compact = false,
  canCorrect = false,
  onCorrected,
}: {
  history: StatusHistory;
  compact?: boolean;
  canCorrect?: boolean;
  /** The history as the server has it after a correction. */
  onCorrected?: (next: StatusHistory, event: StatusHistoryEvent) => void;
}) {
  const [editing, setEditing] = useState<string | null>(null);
  const current = currentStatusEvent(history.events, history.status);
  const first = initialStatus(history);
  const limit = compact ? 5 : Infinity;
  const hidden = Math.max(0, history.events.length - limit);
  const shown = hidden ? history.events.slice(-limit) : history.events;

  return (
    <ol className={"relative " + (compact ? "space-y-2" : "space-y-3")}>
      {/* the rail */}
      <span aria-hidden className="absolute bottom-2 left-[5px] top-2 w-px bg-border" />

      <Row compact={compact} dotClass="bg-surface border-2 border-text-faint">
        <div className={lineLayout(compact)}>
          <span className="text-sm font-medium text-text">
            Submitted
            {first && <span className="font-normal text-text-muted"> as {first}</span>}
          </span>
          <time dateTime={history.submittedAt} className="font-mono text-[11px] text-text-muted">
            {formatDateTimeLong(history.submittedAt)}
          </time>
        </div>
      </Row>

      {hidden > 0 && (
        <li className="pl-6 text-[11px] text-text-faint">
          {hidden} earlier change{hidden === 1 ? "" : "s"} — see the lead
        </li>
      )}

      {shown.map((e) => (
        <Row key={e.id} compact={compact} dotClass={dot(e.to_status)}>
          {editing === e.id ? (
            <CorrectionEditor
              history={history}
              event={e}
              counted={e.id === current?.id && isCountedStatus(e.to_status)}
              onCancel={() => setEditing(null)}
              onSaved={(next) => {
                setEditing(null);
                onCorrected?.(next, e);
              }}
            />
          ) : (
            <EventLine
              event={e}
              compact={compact}
              counted={e.id === current?.id && isCountedStatus(e.to_status)}
              onEdit={canCorrect && !compact ? () => setEditing(e.id) : undefined}
            />
          )}
        </Row>
      ))}

      {history.events.length === 0 && !compact && (
        <li className="pl-6 text-xs text-text-faint">No status changes yet.</li>
      )}
    </ol>
  );
}

function Row({ compact, dotClass, children }: { compact: boolean; dotClass: string; children: React.ReactNode }) {
  return (
    <li className="relative pl-6">
      <span aria-hidden className={"absolute left-0 h-[11px] w-[11px] rounded-full " + (compact ? "top-[3px] " : "top-[5px] ") + dotClass} />
      {children}
    </li>
  );
}

function EventLine({
  event: e,
  compact,
  counted,
  onEdit,
}: {
  event: StatusHistoryEvent;
  compact: boolean;
  counted: boolean;
  onEdit?: () => void;
}) {
  const tz = useCompanyTimezone();
  return (
    <div>
      <div className={lineLayout(compact)}>
        <span className="inline-flex flex-wrap items-center gap-1.5 text-sm text-text">
          <StatusPill status={e.to_status} />
          {e.from_status && <span className="text-xs text-text-faint">from {e.from_status}</span>}
        </span>
        <span className="inline-flex items-center gap-1">
          <time dateTime={e.changed_at} className="font-mono text-[11px] text-text-muted">
            {formatDateTimeLong(e.changed_at)}
          </time>
          {onEdit && (
            <button
              type="button"
              onClick={onEdit}
              aria-label={`Change the date of ${e.to_status}`}
              title="Change the date"
              className="grid h-6 w-6 place-items-center rounded text-text-faint hover:bg-surface-2 hover:text-accent-ink focus-visible:outline-2 focus-visible:outline-accent"
            >
              <Pencil size={12} />
            </button>
          )}
        </span>
      </div>
      {!compact && (
        <div className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[11px] text-text-faint">
          {e.by && <span>by {e.by}</span>}
          {counted && <span className="text-text-muted">Counts in {countsIn(e.changed_at, tz)}</span>}
          {e.source === "backfill_approx" && !e.correction && (
            <span
              title="This lead predates status tracking, so this date was estimated from its last update."
              className="inline-flex items-center gap-1"
            >
              <Info size={11} /> estimated date
            </span>
          )}
        </div>
      )}
      {e.correction && (
        <p className="mt-0.5 text-[11px] text-text-faint">
          Corrected{e.correction.by ? ` by ${e.correction.by}` : ""}
          {compact ? "" : ` on ${formatDateTimeLong(e.correction.at)}`} · first recorded {formatDateTimeLong(e.correction.originalAt)}
        </p>
      )}
    </div>
  );
}

function CorrectionEditor({
  history,
  event,
  counted,
  onCancel,
  onSaved,
}: {
  history: StatusHistory;
  event: StatusHistoryEvent;
  counted: boolean;
  onCancel: () => void;
  onSaved: (next: StatusHistory) => void;
}) {
  const tz = useCompanyTimezone();
  const [draft, setDraft] = useState(() => toDateTimeLocal(event.changed_at));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const picked = draft ? new Date(draft) : null;
  const iso = picked && !Number.isNaN(picked.getTime()) ? picked.toISOString() : "";
  const check = iso
    ? checkCorrection(history, event.id, iso, new Date(), formatDateTimeLong)
    : { ok: false, message: "Pick a date and a time." };
  const unchanged = draft === toDateTimeLocal(event.changed_at);

  async function save() {
    if (!check.ok || unchanged) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/leads/${history.leadId}/status-history/${event.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ changed_at: iso }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json.error ?? "Could not change the date");
      onSaved(json.history as StatusHistory);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not change the date");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="rounded-lg border border-accent/40 bg-surface-2 p-3">
      <div className="mb-2 flex flex-wrap items-center gap-1.5 text-sm text-text">
        When did it become <StatusPill status={event.to_status} />?
      </div>
      <div className="flex flex-wrap items-start gap-2">
        <DateTimeField
          aria-label={`${event.to_status} on`}
          value={draft}
          onChange={setDraft}
          className="px-2.5 py-1.5 rounded-md border border-border bg-surface text-sm outline-none focus:ring-2 focus:ring-accent"
        />
        <div className="flex items-center gap-1.5">
          <button
            type="button"
            onClick={save}
            disabled={busy || !check.ok || unchanged}
            className="inline-flex h-8 items-center gap-1 rounded-md bg-accent px-3 text-xs font-medium text-white hover:bg-accent-ink disabled:opacity-55"
          >
            <Check size={13} /> {busy ? "Saving…" : "Save"}
          </button>
          <button
            type="button"
            onClick={onCancel}
            disabled={busy}
            className="inline-flex h-8 items-center gap-1 rounded-md border border-border bg-surface px-3 text-xs text-text-muted hover:bg-surface-2"
          >
            <X size={13} /> Cancel
          </button>
        </div>
      </div>
      <div className="mt-2 space-y-1 text-[11px]">
        {counted && check.ok && iso && (
          <p className="text-text-muted">
            Reports will count this lead in <span className="font-semibold text-text">{countsIn(iso, tz)}</span>
            {countsIn(iso, tz) !== countsIn(event.changed_at, tz) ? ` (now ${countsIn(event.changed_at, tz)})` : ""}.
          </p>
        )}
        {!check.ok && !unchanged && check.message && (
          <p className="flex items-start gap-1 text-dropped-fg">
            <AlertTriangle size={12} className="mt-px shrink-0" /> {check.message}
          </p>
        )}
        {check.ok && check.warning && (
          <p className="flex items-start gap-1 text-notready-fg">
            <AlertTriangle size={12} className="mt-px shrink-0" /> {check.warning}
          </p>
        )}
        {error && (
          <p className="flex items-start gap-1 text-dropped-fg">
            <AlertTriangle size={12} className="mt-px shrink-0" /> {error}
          </p>
        )}
      </div>
    </div>
  );
}
