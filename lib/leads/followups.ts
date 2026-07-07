export const FU_STATUSES = ["Pickup", "No Pickup"] as const;
export type FuStatus = (typeof FU_STATUSES)[number];

export interface LeadFollowUp {
  id: string;
  lead_id: string;
  user_id: string | null;
  fu_status: string;
  comments: string | null;
  next_follow_up_time: string | null;
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

export function validateFollowUp(
  input: { fu_status: string; next_follow_up_time?: string },
  now: Date = new Date()
): Record<string, string> {
  const e: Record<string, string> = {};
  if (!input.fu_status) e.fu_status = "Select Pickup or No Pickup.";
  const raw = input.next_follow_up_time ?? "";
  const future = () => {
    const t = new Date(raw).getTime();
    return !Number.isNaN(t) && t > now.getTime();
  };
  if (input.fu_status === "No Pickup") {
    if (!raw || !future()) e.next_follow_up_time = "Set a future next follow-up time.";
  } else if (input.fu_status === "Pickup" && raw && !future()) {
    e.next_follow_up_time = "Next follow-up must be in the future.";
  }
  return e;
}
