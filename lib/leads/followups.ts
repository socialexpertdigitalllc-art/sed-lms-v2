export const FU_STATUSES = ["Pickup", "No Pickup"] as const;
export type FuStatus = (typeof FU_STATUSES)[number];

export interface LeadFollowUp {
  id: string;
  lead_id: string;
  user_id: string | null;
  fu_status: string;
  comments: string | null;
  next_follow_up_time: string | null;
  /** The client asked for this exact time, not an approximate window. */
  is_specific_time?: boolean;
  status_change: string | null;
  created_at: string;
  logger_name?: string | null;
}

export type FollowUpBucket = "overdue" | "today" | "upcoming" | "none";

function endOfToday(now: Date): number {
  const d = new Date(now);
  d.setHours(23, 59, 59, 999);
  return d.getTime();
}

export function bucketOf(followUpTime: string | null, now: Date = new Date()): FollowUpBucket {
  if (!followUpTime) return "none";
  const t = new Date(followUpTime).getTime();
  if (Number.isNaN(t)) return "none";
  if (t < now.getTime()) return "overdue";
  if (t <= endOfToday(now)) return "today";
  return "upcoming";
}

type HasFollowUp = { follow_up_time: string | null };

export function groupByBucket<T extends HasFollowUp>(leads: T[], now: Date = new Date()) {
  const g: Record<FollowUpBucket, T[]> = { overdue: [], today: [], upcoming: [], none: [] };
  for (const l of leads) g[bucketOf(l.follow_up_time, now)].push(l);
  const byTime = (a: T, b: T) =>
    (a.follow_up_time ? new Date(a.follow_up_time).getTime() : Infinity) -
    (b.follow_up_time ? new Date(b.follow_up_time).getTime() : Infinity);
  g.overdue.sort(byTime);
  g.today.sort(byTime);
  g.upcoming.sort(byTime);
  return g;
}

export function nextStreak(prev: number, fu_status: string): number {
  return fu_status === "No Pickup" ? prev + 1 : 0;
}

/** How long a "specific time" claim stays true after it was recorded. */
export const SPECIFIC_TTL_MS = 24 * 60 * 60 * 1000;

/** The next follow-up a Cross (quick No Pickup) schedules: one day out. */
export const QUICK_NO_PICKUP_MS = 24 * 60 * 60 * 1000;

type SpecificScope = {
  follow_up_is_specific?: boolean | null;
  /** When the current schedule was recorded — leads.follow_up_set_at. */
  follow_up_set_at?: string | null;
};

/**
 * Is this lead STILL a specific-time follow-up?
 *
 * "The client asked for 3:15pm Tuesday" is only true for as long as nobody has
 * had to reschedule around it. Once a day passes with no new follow-up logged,
 * the exact time the client named is stale and the lead rejoins the ordinary
 * queue — otherwise the Specific filter silently fills up with appointments
 * that were never kept, which is the opposite of what an agent works it for.
 *
 * A missing `follow_up_set_at` never expires: rows written before migration
 * 0073 (and any environment where it has not been applied) have no recorded
 * time to measure from, and dropping their badge would read as data loss.
 */
export function isSpecificActive(lead: SpecificScope, now: Date = new Date()): boolean {
  if (!lead.follow_up_is_specific) return false;
  if (!lead.follow_up_set_at) return true;
  const t = new Date(lead.follow_up_set_at).getTime();
  if (Number.isNaN(t)) return true;
  return now.getTime() - t < SPECIFIC_TTL_MS;
}

/** Statuses that END the pipeline — nothing is scheduled after them. */
const TERMINAL_STATUS_CHANGES = ["Dropped"] as const;

/** True when this follow-up closes the lead out, so no next time is needed. */
export function endsFollowUps(statusChange: string | null | undefined): boolean {
  return !!statusChange && (TERMINAL_STATUS_CHANGES as readonly string[]).includes(statusChange);
}

export function validateFollowUp(
  input: { fu_status: string; next_follow_up_time?: string; status_change?: string | null },
  now: Date = new Date()
): Record<string, string> {
  const e: Record<string, string> = {};
  if (!input.fu_status) e.fu_status = "Select Pickup or No Pickup.";
  // Dropping a lead is the end of the conversation: demanding a future
  // follow-up time to record that is busywork, and agents were inventing
  // throwaway times to get past the form.
  if (endsFollowUps(input.status_change)) return e;
  const raw = input.next_follow_up_time ?? "";
  const t = new Date(raw).getTime();
  if (!raw || Number.isNaN(t) || t <= now.getTime())
    e.next_follow_up_time = "Set a future next follow-up time.";
  return e;
}

export const FOLLOWUP_STATUSES = ["Ready", "Long Term"] as const;
export function isFollowUpEligible(status: string): boolean {
  return (FOLLOWUP_STATUSES as readonly string[]).includes(status);
}
