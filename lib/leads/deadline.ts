/**
 * The website deadline on a new lead, for Tech and Admin (leads table, under
 * the date). The website must reach the client by the lead's follow-up time.
 *
 *   main    — the first 3 hours after the lead was submitted: the target.
 *   bonus   — main time is over and the lead still isn't Ready: the time left
 *             until the follow-up time. Send the website as soon as it's ready.
 *   overdue — the follow-up time has passed (or, with no follow-up time, the
 *             main time has) and the lead still isn't Ready.
 *
 * A follow-up time sooner than 3 hours after submission ends the main timer
 * there, with no bonus. The lead's CURRENT follow-up time counts (an agent
 * rescheduling it moves the deadline). Only Not Ready leads submitted from the
 * day this launched get a timer, so old leads don't all read "overdue".
 */

export const MAIN_WINDOW_MS = 3 * 60 * 60 * 1000;
/** Leads submitted before this get no timer: midnight Nov 19, 2026, Pacific (PST, UTC−8). */
export const DEADLINE_TIMERS_FROM = Date.parse("2026-11-19T08:00:00Z");

export type DeadlinePhase = "main" | "bonus" | "overdue";

export interface DeadlineState {
  phase: DeadlinePhase;
  /** When the running timer ends (null when overdue). */
  endsAt: number | null;
  /** Time left on the running timer (0 when overdue). */
  msLeft: number;
  /** How long past the deadline (0 unless overdue). */
  overdueMs: number;
}

type DeadlineLead = { status: string; created_at: string | null; follow_up_time?: string | null };

export function deadlineState(lead: DeadlineLead, nowMs: number): DeadlineState | null {
  if (lead.status !== "Not Ready" || !lead.created_at) return null;
  const created = Date.parse(lead.created_at);
  if (!Number.isFinite(created) || created < DEADLINE_TIMERS_FROM) return null;
  const follow = lead.follow_up_time ? Date.parse(lead.follow_up_time) : NaN;
  const hasFollow = Number.isFinite(follow);
  const threeHours = created + MAIN_WINDOW_MS;
  // A follow-up sooner than 3 hours away is the deadline itself: no bonus.
  const mainEnds = hasFollow && follow < threeHours ? Math.max(follow, created) : threeHours;
  if (nowMs < mainEnds) return { phase: "main", endsAt: mainEnds, msLeft: mainEnds - nowMs, overdueMs: 0 };
  if (hasFollow && follow > mainEnds && nowMs < follow) return { phase: "bonus", endsAt: follow, msLeft: follow - nowMs, overdueMs: 0 };
  const deadline = hasFollow ? Math.max(follow, mainEnds) : mainEnds;
  return { phase: "overdue", endsAt: null, msLeft: 0, overdueMs: Math.max(0, nowMs - deadline) };
}

/** "2h 14m 05s", "45m 09s", "12s"; over a day "1d 3h 12m". */
export function formatCountdown(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000));
  const d = Math.floor(total / 86400);
  const h = Math.floor((total % 86400) / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const two = (n: number) => String(n).padStart(2, "0");
  if (d > 0) return `${d}d ${h}h ${two(m)}m`;
  if (h > 0) return `${h}h ${two(m)}m ${two(s)}s`;
  if (m > 0) return `${m}m ${two(s)}s`;
  return `${s}s`;
}
