import type { Lead } from "@/lib/leads/types";
import { leadRegion } from "@/lib/geo/regions";

export const FAST_DROP_DAYS = 7;
const DAY_MS = 86_400_000;

export interface ReportWindow {
  fromMs: number;
  toExMs: number; // exclusive
  prev: { fromMs: number; toExMs: number };
}

export interface FollowUpRow { user_id: string | null; fu_status: string; created_at: string }
export interface ContractLite { created_by?: string | null; sent_at: string | null }

export interface WindowMetrics {
  arrived: number;
  closedCount: number;
  droppedCount: number;
  closedFresh: number;
  closedCarryOver: number;
  openAtEnd: number;
  openAging: { d0_7: number; d8_30: number; d30p: number };
  avgCloseDays: number | null;
  medianCloseDays: number | null;
  avgDropDays: number | null;
  medianDropDays: number | null;
  avgFirstTouchHours: number | null;
  medianFirstTouchHours: number | null;
  closeBuckets: { le1: number; le3: number; le7: number; le14: number; le30: number; gt30: number };
  fastDrops: number;
  slowDrops: number;
  closeRatio: number | null; // % of decided that closed
  dropRatio: number | null;  // % of decided that dropped
  followUpsLogged: number;
  pickupRate: number | null;
  contractsSent: number;
  closesPerContract: number | null; // closes per contract sent
  closedRevenue: number;
  recurringRevenue: number;
  avgDealSize: number | null; // over closed-in-window priced leads
  approxCount: number; // exits whose timestamp is backfill-approximated
}

export interface RegionRow {
  region: string;
  closed: number;
  dropped: number;
  medianCloseDays: number | null;
}

const ms = (iso: string) => new Date(iso).getTime();
const avg = (xs: number[]) => (xs.length ? xs.reduce((s, x) => s + x, 0) / xs.length : null);
const median = (xs: number[]) => {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};
const num = (v: unknown): number | null => {
  const n = typeof v === "string" ? parseFloat(v) : typeof v === "number" ? v : NaN;
  return Number.isFinite(n) ? n : null;
};

/** "YYYY-MM-DD" × 2 → half-open UTC window plus equal-length previous window. */
export function windowFor(from: string, to: string): ReportWindow {
  const fromMs = Date.parse(`${from}T00:00:00Z`);
  const toExMs = Date.parse(`${to}T00:00:00Z`) + DAY_MS;
  const len = toExMs - fromMs;
  return { fromMs, toExMs, prev: { fromMs: fromMs - len, toExMs: fromMs } };
}

const inWindow = (iso: string | null | undefined, w: { fromMs: number; toExMs: number }) =>
  !!iso && ms(iso) >= w.fromMs && ms(iso) < w.toExMs;

const closeDaysOf = (ls: Lead[]) =>
  ls.map((l) => (ms(l.closed_at as string) - ms(l.created_at)) / DAY_MS).filter((d) => d >= 0);

export function computeWindowMetrics(
  leads: Lead[],            // ownership-scoped: one agent's leads, or the whole team's
  followUps: FollowUpRow[], // actor-scoped the same way
  contracts: ContractLite[],
  w: { fromMs: number; toExMs: number },
  approxLeadIds: Set<string>
): WindowMetrics {
  const arrived = leads.filter((l) => inWindow(l.created_at, w));
  const closedL = leads.filter((l) => inWindow(l.closed_at, w));
  const droppedL = leads.filter((l) => inWindow(l.dropped_at, w));

  const closeDays = closeDaysOf(closedL);
  const dropDays = droppedL
    .map((l) => (ms(l.dropped_at as string) - ms(l.created_at)) / DAY_MS)
    .filter((d) => d >= 0);
  const touchHours = arrived
    .filter((l) => l.first_touch_at)
    .map((l) => (ms(l.first_touch_at as string) - ms(l.created_at)) / 3_600_000)
    .filter((h) => h >= 0);

  const openLeads = leads.filter(
    (l) =>
      ms(l.created_at) < w.toExMs &&
      !(l.closed_at && ms(l.closed_at) < w.toExMs) &&
      !(l.dropped_at && ms(l.dropped_at) < w.toExMs)
  );
  const openAging = { d0_7: 0, d8_30: 0, d30p: 0 };
  for (const l of openLeads) {
    const age = (w.toExMs - ms(l.created_at)) / DAY_MS;
    if (age <= 7) openAging.d0_7++;
    else if (age <= 30) openAging.d8_30++;
    else openAging.d30p++;
  }

  const closeBuckets = { le1: 0, le3: 0, le7: 0, le14: 0, le30: 0, gt30: 0 };
  for (const d of closeDays) {
    if (d <= 1) closeBuckets.le1++;
    else if (d <= 3) closeBuckets.le3++;
    else if (d <= 7) closeBuckets.le7++;
    else if (d <= 14) closeBuckets.le14++;
    else if (d <= 30) closeBuckets.le30++;
    else closeBuckets.gt30++;
  }

  const decided = closedL.length + droppedL.length;
  const fu = followUps.filter((f) => inWindow(f.created_at, w));
  const pickups = fu.filter((f) => f.fu_status === "Pickup").length;
  const contractsSent = contracts.filter((c) => inWindow(c.sent_at, w)).length;

  const prices = closedL.map((l) => num(l.price_quoted)).filter((n): n is number => n !== null);

  return {
    arrived: arrived.length,
    closedCount: closedL.length,
    droppedCount: droppedL.length,
    closedFresh: closedL.filter((l) => inWindow(l.created_at, w)).length,
    closedCarryOver: closedL.filter((l) => !inWindow(l.created_at, w)).length,
    openAtEnd: openLeads.length,
    openAging,
    avgCloseDays: avg(closeDays),
    medianCloseDays: median(closeDays),
    avgDropDays: avg(dropDays),
    medianDropDays: median(dropDays),
    avgFirstTouchHours: avg(touchHours),
    medianFirstTouchHours: median(touchHours),
    closeBuckets,
    fastDrops: dropDays.filter((d) => d <= FAST_DROP_DAYS).length,
    slowDrops: dropDays.filter((d) => d > FAST_DROP_DAYS).length,
    closeRatio: decided ? (closedL.length / decided) * 100 : null,
    dropRatio: decided ? (droppedL.length / decided) * 100 : null,
    followUpsLogged: fu.length,
    pickupRate: fu.length ? (pickups / fu.length) * 100 : null,
    contractsSent,
    closesPerContract: contractsSent ? closedL.length / contractsSent : null,
    closedRevenue: prices.reduce((s, n) => s + n, 0),
    recurringRevenue: closedL.reduce((s, l) => s + (num(l.yearly_price) ?? 0), 0),
    avgDealSize: avg(prices),
    approxCount: [...closedL, ...droppedL].filter((l) => approxLeadIds.has(l.id)).length,
  };
}

/** Regional exits within the window, sorted by activity desc, Unknown last. */
export function regionRows(leads: Lead[], w: { fromMs: number; toExMs: number }): RegionRow[] {
  const by = new Map<string, Lead[]>();
  for (const l of leads) {
    if (!inWindow(l.closed_at, w) && !inWindow(l.dropped_at, w)) continue;
    const r = leadRegion(l);
    if (!by.has(r)) by.set(r, []);
    by.get(r)!.push(l);
  }
  return [...by.entries()]
    .map(([region, ls]) => {
      const closed = ls.filter((l) => inWindow(l.closed_at, w));
      return {
        region,
        closed: closed.length,
        dropped: ls.filter((l) => inWindow(l.dropped_at, w)).length,
        medianCloseDays: median(closeDaysOf(closed)),
      };
    })
    .sort((a, b) =>
      a.region === "Unknown" ? 1 : b.region === "Unknown" ? -1 : b.closed + b.dropped - (a.closed + a.dropped)
    );
}
