/**
 * Calendar math in an IANA timezone, without a timezone library.
 *
 * The assistant answers "this week", "yesterday", "October" the way the user
 * means them — in the COMPANY's timezone (app_settings.work_timezone), not the
 * server's UTC clock. A follow-up logged at 2am Karachi time on November 1st
 * is still 9pm on October 31st in UTC; counted by the UTC date it would land
 * in the wrong month.
 *
 * PURE. Formatters are cached per zone because constructing an
 * Intl.DateTimeFormat costs far more than using one.
 */

const formatters = new Map<string, Intl.DateTimeFormat>();

function formatter(tz: string): Intl.DateTimeFormat {
  let f = formatters.get(tz);
  if (!f) {
    f = new Intl.DateTimeFormat("en-US", {
      timeZone: tz,
      hourCycle: "h23",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      weekday: "short",
    });
    formatters.set(tz, f);
  }
  return f;
}

export const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"] as const;

export interface ZonedParts {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
  /** 0 = Sunday … 6 = Saturday. */
  weekday: number;
}

export function zonedParts(atMs: number, tz: string): ZonedParts {
  const p: Record<string, string> = {};
  for (const part of formatter(tz).formatToParts(new Date(atMs))) p[part.type] = part.value;
  return {
    year: Number(p.year),
    month: Number(p.month),
    day: Number(p.day),
    // Some engines render midnight as "24" even with h23.
    hour: Number(p.hour) % 24,
    minute: Number(p.minute),
    second: Number(p.second),
    weekday: Math.max(0, WEEKDAYS.indexOf(p.weekday as (typeof WEEKDAYS)[number])),
  };
}

/** Local wall-clock minus UTC, in ms, at that instant. */
export function tzOffsetMs(atMs: number, tz: string): number {
  const p = zonedParts(atMs, tz);
  const asUtc = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second);
  return asUtc - Math.floor(atMs / 1000) * 1000;
}

const pad = (n: number) => String(n).padStart(2, "0");

export function isYmd(s: unknown): s is string {
  if (typeof s !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  const [y, m, d] = s.split("-").map(Number);
  const t = new Date(Date.UTC(y, m - 1, d));
  return t.getUTCFullYear() === y && t.getUTCMonth() === m - 1 && t.getUTCDate() === d;
}

/** "YYYY-MM-DD" ± n calendar days. */
export function addDays(ymd: string, n: number): string {
  const [y, m, d] = ymd.split("-").map(Number);
  const t = new Date(Date.UTC(y, m - 1, d + n));
  return `${t.getUTCFullYear()}-${pad(t.getUTCMonth() + 1)}-${pad(t.getUTCDate())}`;
}

/** The instant local midnight begins on that date, in that zone. */
export function zonedMidnightMs(ymd: string, tz: string): number {
  const [y, m, d] = ymd.split("-").map(Number);
  const guess = Date.UTC(y, m - 1, d);
  const first = guess - tzOffsetMs(guess, tz);
  // Across a DST change the offset at the guess and at the answer differ;
  // re-solving once with the answer's own offset settles it.
  const second = guess - tzOffsetMs(first, tz);
  return second;
}

const toMs = (at: string | number | Date): number =>
  typeof at === "number" ? at : at instanceof Date ? at.getTime() : new Date(at).getTime();

export function localDateKey(at: string | number | Date, tz: string): string {
  const p = zonedParts(toMs(at), tz);
  return `${p.year}-${pad(p.month)}-${pad(p.day)}`;
}

export function localMonthKey(at: string | number | Date, tz: string): string {
  return localDateKey(at, tz).slice(0, 7);
}

/** The Monday that starts this instant's local week. */
export function localWeekKey(at: string | number | Date, tz: string): string {
  const p = zonedParts(toMs(at), tz);
  const back = (p.weekday + 6) % 7;
  return addDays(`${p.year}-${pad(p.month)}-${pad(p.day)}`, -back);
}

export function localHour(at: string | number | Date, tz: string): number {
  return zonedParts(toMs(at), tz).hour;
}

export function localWeekday(at: string | number | Date, tz: string): (typeof WEEKDAYS)[number] {
  return WEEKDAYS[zonedParts(toMs(at), tz).weekday];
}

/* ------------------------------------------------------------- periods */

/** An inclusive local-date range and the half-open UTC window it covers. */
export interface Period {
  from: string;
  to: string;
  fromMs: number;
  toExMs: number;
  days: number;
}

export function periodFor(from: string, to: string, tz: string): Period {
  const fromMs = zonedMidnightMs(from, tz);
  const toExMs = zonedMidnightMs(addDays(to, 1), tz);
  const days = Math.round((Date.UTC(...ymdParts(to)) - Date.UTC(...ymdParts(from))) / 86_400_000) + 1;
  return { from, to, fromMs, toExMs, days };
}

function ymdParts(ymd: string): [number, number, number] {
  const [y, m, d] = ymd.split("-").map(Number);
  return [y, m - 1, d];
}

/** Accept "2026-10-01" and also an ISO timestamp the model wrote instead. */
export function normalizeYmd(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const head = value.trim().slice(0, 10);
  return isYmd(head) ? head : null;
}

export class PeriodError extends Error {}

/**
 * Resolve optional from/to into a Period. Neither given → `fallback`:
 * "all" means no date filter at all (null), a number means the last N days
 * through today. Only `from` → through today. Only `to` → from `minFrom`.
 */
export function resolvePeriod(
  input: { from?: string | null; to?: string | null },
  tz: string,
  now: Date,
  fallback: number | "all" = "all",
): Period | null {
  const today = localDateKey(now, tz);
  const from = input.from ? normalizeYmd(input.from) : null;
  const to = input.to ? normalizeYmd(input.to) : null;
  if (input.from && !from) throw new PeriodError(`"${input.from}" is not a date — use YYYY-MM-DD.`);
  if (input.to && !to) throw new PeriodError(`"${input.to}" is not a date — use YYYY-MM-DD.`);
  if (!from && !to) {
    if (fallback === "all") return null;
    return periodFor(addDays(today, -(fallback - 1)), today, tz);
  }
  const start = from ?? "2000-01-01";
  const end = to ?? (from && from > today ? from : today);
  if (start > end) throw new PeriodError(`The period starts (${start}) after it ends (${end}).`);
  return periodFor(start, end, tz);
}

/** The equal-length window immediately before `p`. */
export function previousPeriod(p: Period, tz: string): Period {
  return periodFor(addDays(p.from, -p.days), addDays(p.from, -1), tz);
}

export function inPeriod(at: string | null | undefined, p: Period | null): boolean {
  if (!p) return true;
  if (!at) return false;
  const t = new Date(at).getTime();
  return Number.isFinite(t) && t >= p.fromMs && t < p.toExMs;
}
