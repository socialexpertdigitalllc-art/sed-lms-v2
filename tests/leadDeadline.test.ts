// @vitest-environment node
import { describe, it, expect } from "vitest";
import { DEADLINE_TIMERS_FROM, deadlineState, formatCountdown } from "@/lib/leads/deadline";

/** The website deadline timers (lib/leads/deadline.ts). Times are UTC; 1 PM Pacific = 21:00Z. */
const H = 3_600_000;
const created = "2026-11-20T21:00:00Z"; // 1 PM Pacific
const follow = "2026-11-21T05:00:00Z"; // 9 PM Pacific
const at = (iso: string) => Date.parse(iso);
const lead = (over: Record<string, unknown> = {}) => ({ status: "Not Ready", created_at: created, follow_up_time: follow, ...over });

describe("deadline timers — the 1 PM lead with a 9 PM follow-up", () => {
  it("1 PM to 4 PM: the 3-hour main timer", () => {
    expect(deadlineState(lead(), at(created))).toEqual({ phase: "main", endsAt: at(created) + 3 * H, msLeft: 3 * H, overdueMs: 0 });
    const s = deadlineState(lead(), at("2026-11-20T23:30:00Z"))!; // 3:30 PM
    expect(s.phase).toBe("main");
    expect(s.msLeft).toBe(0.5 * H);
  });

  it("4 PM to 9 PM: the bonus timer to the follow-up (5 hours)", () => {
    const s = deadlineState(lead(), at("2026-11-21T00:00:00Z"))!; // 4 PM
    expect(s).toEqual({ phase: "bonus", endsAt: at(follow), msLeft: 5 * H, overdueMs: 0 });
  });

  it("after 9 PM: overdue, counting up", () => {
    const s = deadlineState(lead(), at("2026-11-21T05:25:00Z"))!;
    expect(s).toEqual({ phase: "overdue", endsAt: null, msLeft: 0, overdueMs: 25 * 60_000 });
  });

  it("gone once the lead is Ready (or any other status)", () => {
    for (const status of ["Ready", "Closed", "Dropped", "Long Term"]) expect(deadlineState(lead({ status }), at(created))).toBeNull();
  });
});

describe("deadline timers — edge cases", () => {
  it("a follow-up sooner than 3 hours ends the main timer there, with no bonus", () => {
    const soon = lead({ follow_up_time: "2026-11-20T23:00:00Z" }); // 3 PM
    expect(deadlineState(soon, at("2026-11-20T22:00:00Z"))).toMatchObject({ phase: "main", msLeft: H });
    expect(deadlineState(soon, at("2026-11-20T23:10:00Z"))).toMatchObject({ phase: "overdue", overdueMs: 10 * 60_000 });
  });

  it("no follow-up time: 3 hours, then overdue", () => {
    const none = lead({ follow_up_time: null });
    expect(deadlineState(none, at("2026-11-20T23:00:00Z"))).toMatchObject({ phase: "main", msLeft: H });
    expect(deadlineState(none, at("2026-11-21T00:30:00Z"))).toMatchObject({ phase: "overdue", overdueMs: 30 * 60_000 });
  });

  it("follows the lead's current follow-up time when it's rescheduled", () => {
    const later = lead({ follow_up_time: "2026-11-21T07:00:00Z" }); // 11 PM
    expect(deadlineState(later, at("2026-11-21T05:30:00Z"))).toMatchObject({ phase: "bonus", msLeft: 1.5 * H });
  });

  it("leads submitted before the launch day get no timer", () => {
    expect(deadlineState(lead({ created_at: new Date(DEADLINE_TIMERS_FROM - 1).toISOString() }), DEADLINE_TIMERS_FROM)).toBeNull();
    expect(deadlineState(lead({ created_at: new Date(DEADLINE_TIMERS_FROM).toISOString() }), DEADLINE_TIMERS_FROM)).toMatchObject({ phase: "main" });
  });
});

describe("formatCountdown", () => {
  it("reads like a timer", () => {
    expect(formatCountdown(3 * H)).toBe("3h 00m 00s");
    expect(formatCountdown(2 * H + 14 * 60_000 + 5_000)).toBe("2h 14m 05s");
    expect(formatCountdown(45 * 60_000 + 9_000)).toBe("45m 09s");
    expect(formatCountdown(12_000)).toBe("12s");
    expect(formatCountdown(27 * H + 12 * 60_000)).toBe("1d 3h 12m");
    expect(formatCountdown(-5)).toBe("0s");
  });
});
