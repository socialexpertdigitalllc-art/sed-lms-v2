// Pure sign-in/session analytics: attendance, hours, lateness, and who's online.
// No I/O — callers (API routes, pages) fetch `user_sessions` rows and pass them in.

export type SessionRow = {
  user_id: string;
  signed_in_at: string;
  signed_out_at: string | null;
  last_seen_at: string;
};

export type Opts = { tz: string; workStart: string; now: Date; idleMin?: number };

export type UserDay = {
  userId: string;
  date: string;
  firstIn: string;
  lastOut: string;
  hours: number;
  sessions: number;
  lateMinutes: number;
};

export type Online = { userId: string; since: string };

// Derive the LOCAL calendar date (YYYY-MM-DD) and local HH:MM for an ISO
// timestamp in a given IANA timezone, without an external tz library.
function localParts(iso: string, tz: string) {
  const d = new Date(iso);
  const fmt = new Intl.DateTimeFormat("en-CA", {
    timeZone: tz,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
  const p = Object.fromEntries(fmt.formatToParts(d).map((x) => [x.type, x.value]));
  return {
    date: `${p.year}-${p.month}-${p.day}`,
    hhmm: `${p.hour === "24" ? "00" : p.hour}:${p.minute}`,
  };
}

function minutesFromMidnight(hhmm: string): number {
  const [h, m] = hhmm.split(":").map(Number);
  return h * 60 + m;
}

type Bucket = {
  userId: string;
  date: string;
  firstInMs: number;
  firstInHHMM: string;
  lastOutMs: number;
  lastOutHHMM: string;
  hoursMs: number;
  sessions: number;
};

export function summarize(
  rows: SessionRow[],
  opts: Opts
): { perUserDay: UserDay[]; online: Online[] } {
  const idleMs = (opts.idleMin ?? 15) * 60_000;
  const workStartMin = minutesFromMidnight(opts.workStart);

  const buckets = new Map<string, Bucket>();
  const openByUser = new Map<string, SessionRow[]>();

  for (const row of rows) {
    const end = row.signed_out_at ?? row.last_seen_at;
    const inMs = new Date(row.signed_in_at).getTime();
    const endMs = new Date(end).getTime();
    const inParts = localParts(row.signed_in_at, opts.tz);
    const endParts = localParts(end, opts.tz);

    // Sessions are bucketed under the LOCAL date of sign-in, per user.
    const key = `${row.user_id}|${inParts.date}`;
    let bucket = buckets.get(key);
    if (!bucket) {
      bucket = {
        userId: row.user_id,
        date: inParts.date,
        firstInMs: inMs,
        firstInHHMM: inParts.hhmm,
        lastOutMs: endMs,
        lastOutHHMM: endParts.hhmm,
        hoursMs: 0,
        sessions: 0,
      };
      buckets.set(key, bucket);
    }

    if (inMs < bucket.firstInMs) {
      bucket.firstInMs = inMs;
      bucket.firstInHHMM = inParts.hhmm;
    }
    if (endMs > bucket.lastOutMs) {
      bucket.lastOutMs = endMs;
      bucket.lastOutHHMM = endParts.hhmm;
    }
    bucket.hoursMs += endMs - inMs;
    bucket.sessions += 1;

    if (row.signed_out_at == null) {
      const list = openByUser.get(row.user_id) ?? [];
      list.push(row);
      openByUser.set(row.user_id, list);
    }
  }

  const perUserDay: UserDay[] = Array.from(buckets.values()).map((b) => ({
    userId: b.userId,
    date: b.date,
    firstIn: b.firstInHHMM,
    lastOut: b.lastOutHHMM,
    hours: b.hoursMs / 3_600_000,
    sessions: b.sessions,
    lateMinutes: Math.max(0, minutesFromMidnight(b.firstInHHMM) - workStartMin),
  }));

  // Deterministic order: most recent day first, then user id.
  perUserDay.sort((a, b) => {
    if (a.date !== b.date) return a.date < b.date ? 1 : -1;
    return a.userId.localeCompare(b.userId);
  });

  const online: Online[] = [];
  for (const [userId, sessions] of openByUser) {
    const withinIdle = sessions.filter(
      (r) => opts.now.getTime() - new Date(r.last_seen_at).getTime() <= idleMs
    );
    if (withinIdle.length === 0) continue;
    const since = withinIdle.reduce(
      (earliest, r) => (new Date(r.signed_in_at).getTime() < new Date(earliest).getTime() ? r.signed_in_at : earliest),
      withinIdle[0].signed_in_at
    );
    online.push({ userId, since });
  }

  return { perUserDay, online };
}
