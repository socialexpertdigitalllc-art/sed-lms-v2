/**
 * A lead's status history, as the detail page and the leads-table hover show
 * it, plus the rules for an admin correcting WHEN a change happened.
 *
 * The ledger is `lead_status_events` (migration 0065). Reports count a lead in
 * the month of its `closed_at` / `dropped_at`, which mirror the event that put
 * the lead into its current status. A lead marked Closed on Nov 3 that really
 * closed on Oct 30 therefore counts in November until that event is moved —
 * which is what a correction does, keeping the two in step.
 *
 * Pure: no I/O. The loader and the routes live in statusHistoryLoad.ts and
 * app/api/leads/[id]/status-history.
 */

export interface StatusCorrection {
  /** When the change was first recorded, before any correction. */
  originalAt: string;
  /** The admin who made the latest correction, and when. */
  by: string | null;
  at: string;
}

export interface StatusHistoryEvent {
  id: string;
  from_status: string | null;
  to_status: string;
  changed_at: string;
  /** Display name of whoever changed the status; null for system/backfill. */
  by: string | null;
  /** app = recorded live; backfill = rebuilt from the activity log;
   *  backfill_approx = a legacy lead whose date was estimated. */
  source: string;
  correction: StatusCorrection | null;
}

export interface StatusHistory {
  leadId: string;
  status: string;
  submittedAt: string;
  /** Oldest first. */
  events: StatusHistoryEvent[];
}

/** The activity-log action a correction is recorded under. */
export const STATUS_DATE_CORRECTED = "lead.status_date_corrected";

/** Statuses whose date reports count by (leads.closed_at / dropped_at). */
const COUNTED_STATUSES = new Set(["Closed", "Dropped"]);

/** Oldest first; a tie keeps the given order. */
export function sortEvents<T extends { changed_at: string }>(events: T[]): T[] {
  return events
    .map((e, i) => ({ e, i, t: new Date(e.changed_at).getTime() }))
    .sort((a, b) => a.t - b.t || a.i - b.i)
    .map((x) => x.e);
}

/**
 * The event that put the lead into its current status, or null when the
 * ledger has none (a lead still in the status it was submitted with).
 */
export function currentStatusEvent<T extends { to_status: string; changed_at: string }>(
  events: T[],
  status: string,
): T | null {
  const sorted = sortEvents(events);
  const last = sorted[sorted.length - 1];
  return last && last.to_status === status ? last : null;
}

/** When the lead entered its current status: the event, else submission. */
export function currentStatusSince(history: Pick<StatusHistory, "events" | "status" | "submittedAt">): string {
  return currentStatusEvent(history.events, history.status)?.changed_at ?? history.submittedAt;
}

/** The status the lead was submitted with, as far as the ledger can tell. */
export function initialStatus(history: Pick<StatusHistory, "events" | "status">): string | null {
  const first = sortEvents(history.events)[0];
  if (!first) return history.status;
  return first.from_status;
}

/** Whole days between two instants, never negative; null when either is missing. */
export function daysBetween(fromIso: string | null | undefined, toIso: string | null | undefined): number | null {
  if (!fromIso || !toIso) return null;
  const d = (new Date(toIso).getTime() - new Date(fromIso).getTime()) / 86_400_000;
  if (Number.isNaN(d)) return null;
  return Math.max(0, Math.floor(d));
}

/** Server clocks and browser clocks disagree by a little; "now" is not "the future". */
const FUTURE_SLACK_MS = 2 * 60_000;

export interface CorrectionCheck {
  ok: boolean;
  /** Why not, in words an admin can act on. */
  message?: string;
  /** Advisory only — the change is still allowed. */
  warning?: string;
}

/**
 * May this event be moved to `nextIso`? A correction keeps the history in
 * order — after the change before it and before the change after it — and
 * never moves into the future. It MAY land before the lead was submitted:
 * imported and late-entered leads were often closed before anyone typed them
 * in, and refusing that would leave exactly the miscount this exists to fix.
 */
export function checkCorrection(
  history: Pick<StatusHistory, "events" | "submittedAt">,
  eventId: string,
  nextIso: string,
  now: Date,
  fmt: (iso: string) => string,
): CorrectionCheck {
  const t = new Date(nextIso).getTime();
  if (!nextIso || Number.isNaN(t)) return { ok: false, message: "Pick a valid date and time." };
  if (t > now.getTime() + FUTURE_SLACK_MS) return { ok: false, message: "A status change can't be dated in the future." };

  const sorted = sortEvents(history.events);
  const i = sorted.findIndex((e) => e.id === eventId);
  if (i === -1) return { ok: false, message: "That status change no longer exists — refresh the page." };
  const prev = sorted[i - 1];
  const next = sorted[i + 1];
  if (prev && t <= new Date(prev.changed_at).getTime()) {
    return {
      ok: false,
      message: `It has to be after the change before it (${prev.to_status}, ${fmt(prev.changed_at)}). Move that one first.`,
    };
  }
  if (next && t >= new Date(next.changed_at).getTime()) {
    return {
      ok: false,
      message: `It has to be before the change after it (${next.to_status}, ${fmt(next.changed_at)}). Move that one first.`,
    };
  }
  const submitted = new Date(history.submittedAt).getTime();
  if (t < submitted) {
    return { ok: true, warning: `That is before the lead was submitted (${fmt(history.submittedAt)}).` };
  }
  return { ok: true };
}

/**
 * The `leads` columns to rewrite after moving `eventId` to `at`, or null when
 * none change. Only the event that put the lead into its CURRENT status is
 * mirrored, and only for the statuses reports count by date.
 */
export function lifecycleColumnPatch(
  history: Pick<StatusHistory, "events" | "status">,
  eventId: string,
  at: string,
): { closed_at: string } | { dropped_at: string } | null {
  const current = currentStatusEvent(history.events, history.status);
  if (!current || current.id !== eventId || !COUNTED_STATUSES.has(current.to_status)) return null;
  return current.to_status === "Closed" ? { closed_at: at } : { dropped_at: at };
}

/** Earliest original date + latest correction per event, from activity-log rows. */
export function correctionsByEvent(
  rows: {
    user_id: string | null;
    created_at: string;
    old_value: { event_id?: unknown; changed_at?: unknown } | null;
  }[],
  nameOf: (id: string | null) => string | null,
): Map<string, StatusCorrection> {
  const out = new Map<string, StatusCorrection>();
  for (const r of sortEvents(rows.map((row) => ({ ...row, changed_at: row.created_at })))) {
    const eventId = typeof r.old_value?.event_id === "string" ? r.old_value.event_id : null;
    const was = typeof r.old_value?.changed_at === "string" ? r.old_value.changed_at : null;
    if (!eventId || !was) continue;
    const seen = out.get(eventId);
    out.set(eventId, { originalAt: seen?.originalAt ?? was, by: nameOf(r.user_id), at: r.created_at });
  }
  return out;
}

const dayWord = (n: number) => (n === 0 ? "the same day" : n === 1 ? "1 day" : `${n} days`);

/**
 * One line on how long the lead has taken: "Closed 28 days after it was
 * submitted", "Ready for 3 days · submitted 12 days ago".
 */
export function statusSummary(history: Pick<StatusHistory, "events" | "status" | "submittedAt">, now: Date): string {
  const since = currentStatusSince(history);
  const age = daysBetween(history.submittedAt, now.toISOString()) ?? 0;
  if (COUNTED_STATUSES.has(history.status)) {
    const took = daysBetween(history.submittedAt, since) ?? 0;
    return took === 0
      ? `${history.status} the same day it was submitted`
      : `${history.status} ${dayWord(took)} after it was submitted`;
  }
  const inStatus = daysBetween(since, now.toISOString()) ?? 0;
  if (since === history.submittedAt) return age === 0 ? "Submitted today" : `Submitted ${dayWord(age)} ago`;
  return `${history.status} for ${inStatus === 0 ? "less than a day" : dayWord(inStatus)} · submitted ${age === 0 ? "today" : `${dayWord(age)} ago`}`;
}

/** Statuses reports count in the month of their date. */
export function isCountedStatus(status: string): boolean {
  return COUNTED_STATUSES.has(status);
}
