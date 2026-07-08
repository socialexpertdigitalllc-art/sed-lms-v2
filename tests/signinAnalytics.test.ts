import { describe, it, expect } from "vitest";
import { summarize, type SessionRow } from "@/lib/signin/analytics";

const tz = "UTC";
const s = (u: string, inAt: string, outAt: string | null, seen: string): SessionRow =>
  ({ user_id: u, signed_in_at: inAt, signed_out_at: outAt, last_seen_at: seen });

describe("summarize", () => {
  it("computes first-in/last-out + hours per user-day", () => {
    const rows = [
      s("u1", "2026-07-09T09:05:00Z", "2026-07-09T11:05:00Z", "2026-07-09T11:05:00Z"),
      s("u1", "2026-07-09T13:00:00Z", "2026-07-09T14:00:00Z", "2026-07-09T14:00:00Z"),
    ];
    const r = summarize(rows, { tz, workStart: "09:00", now: new Date("2026-07-09T20:00:00Z") });
    const day = r.perUserDay.find(d => d.userId === "u1" && d.date === "2026-07-09")!;
    expect(day.firstIn).toContain("09:05");
    expect(day.lastOut).toContain("14:00");
    expect(day.hours).toBeCloseTo(3, 1);
    expect(day.sessions).toBe(2);
  });
  it("flags lateness vs work start", () => {
    const rows = [s("u1", "2026-07-09T09:40:00Z", "2026-07-09T10:00:00Z", "2026-07-09T10:00:00Z")];
    const r = summarize(rows, { tz, workStart: "09:00", now: new Date("2026-07-09T20:00:00Z") });
    expect(r.perUserDay[0].lateMinutes).toBe(40);
  });
  it("treats open recent session as online, uses last_seen for hours", () => {
    const now = new Date("2026-07-09T10:00:00Z");
    const rows = [s("u1", "2026-07-09T09:00:00Z", null, "2026-07-09T09:58:00Z")];
    const r = summarize(rows, { tz, workStart: "09:00", now, idleMin: 15 });
    expect(r.online.map(o => o.userId)).toContain("u1");
    expect(r.perUserDay[0].hours).toBeCloseTo(0.966, 1);
  });
  it("does not mark a long-idle open session as online", () => {
    const now = new Date("2026-07-09T12:00:00Z");
    const rows = [s("u1", "2026-07-09T09:00:00Z", null, "2026-07-09T09:30:00Z")];
    const r = summarize(rows, { tz, workStart: "09:00", now, idleMin: 15 });
    expect(r.online.map(o => o.userId)).not.toContain("u1");
  });
});
