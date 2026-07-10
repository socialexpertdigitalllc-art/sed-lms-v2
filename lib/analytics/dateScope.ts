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
