export const MONTH_ALL = "";

export interface MonthOption { value: string; label: string }

const MONTHS = ["January","February","March","April","May","June","July","August","September","October","November","December"];

/** ISO datetime → "YYYY-MM"; "" for empty/invalid. */
export function monthKey(iso: string | null | undefined): string {
  if (!iso) return "";
  const m = /^(\d{4})-(\d{2})/.exec(iso);
  return m ? `${m[1]}-${m[2]}` : "";
}

/** "2026-07" → "July 2026". */
export function monthLabel(value: string): string {
  const m = /^(\d{4})-(\d{2})$/.exec(value);
  return m ? `${MONTHS[Number(m[2]) - 1]} ${m[1]}` : value;
}

/** Distinct months present in rows' created_at, newest first. */
export function monthOptions(rows: { created_at: string }[]): MonthOption[] {
  const set = new Set<string>();
  for (const r of rows) { const k = monthKey(r.created_at); if (k) set.add(k); }
  return [...set].sort().reverse().map((value) => ({ value, label: monthLabel(value) }));
}

/** True if `iso` is in `month` ("YYYY-MM"); MONTH_ALL ("") matches all. */
export function inMonth(iso: string | null | undefined, month: string): boolean {
  if (!month) return true;
  return monthKey(iso) === month;
}

/**
 * A range bound from the date-time picker (`YYYY-MM-DDTHH:MM`, local) as
 * epoch ms; NaN when unusable. A bare `YYYY-MM-DD` is read as local midnight
 * — `new Date("2026-09-04")` alone would be UTC midnight, which is the wrong
 * day for half the planet.
 */
export function localBoundMs(v: string): number {
  const s = v.trim();
  if (!s) return NaN;
  return new Date(/^\d{4}-\d{2}-\d{2}$/.test(s) ? `${s}T00:00` : s).getTime();
}

/** The picker stops at the minute; "to 5:00 PM" means through 5:00:59. */
const MINUTE_END_MS = 59_999;

/**
 * True if `iso` falls inside [from, to], both ends inclusive. Either bound
 * may be "" (open-ended); both "" matches everything, the same way MONTH_ALL
 * does. An unparseable bound is treated as open rather than as "match
 * nothing" — a half-typed date must not blank the table.
 */
export function inRange(iso: string | null | undefined, from: string, to: string): boolean {
  if (!from && !to) return true;
  if (!iso) return false;
  const t = new Date(iso).getTime();
  if (Number.isNaN(t)) return false;
  const lo = localBoundMs(from);
  const hi = localBoundMs(to);
  if (!Number.isNaN(lo) && t < lo) return false;
  if (!Number.isNaN(hi) && t > hi + MINUTE_END_MS) return false;
  return true;
}
