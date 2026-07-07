import { describe, it, expect } from "vitest";
import {
  bucketOf,
  groupByBucket,
  validateFollowUp,
  nextStreak,
  isFollowUpEligible,
  FOLLOWUP_STATUSES,
} from "@/lib/leads/followups";

const NOW = new Date("2026-07-07T12:00:00");

describe("bucketOf", () => {
  it("null → none", () => expect(bucketOf(null, NOW)).toBe("none"));
  it("past → overdue", () => expect(bucketOf("2026-07-07T11:59:00", NOW)).toBe("overdue"));
  it("later today → today", () => expect(bucketOf("2026-07-07T20:00:00", NOW)).toBe("today"));
  it("end of today → today", () => expect(bucketOf("2026-07-07T23:59:59", NOW)).toBe("today"));
  it("tomorrow → upcoming", () => expect(bucketOf("2026-07-08T09:00:00", NOW)).toBe("upcoming"));
});

describe("groupByBucket", () => {
  it("buckets and sorts by time asc within each", () => {
    const leads = [
      { id: "a", follow_up_time: "2026-07-08T10:00:00" },
      { id: "b", follow_up_time: "2026-07-07T06:00:00" },
      { id: "c", follow_up_time: null },
      { id: "d", follow_up_time: "2026-07-07T18:00:00" },
      { id: "e", follow_up_time: "2026-07-05T10:00:00" },
    ];
    const g = groupByBucket(leads, NOW);
    expect(g.overdue.map((l) => l.id)).toEqual(["e", "b"]);
    expect(g.today.map((l) => l.id)).toEqual(["d"]);
    expect(g.upcoming.map((l) => l.id)).toEqual(["a"]);
    expect(g.none.map((l) => l.id)).toEqual(["c"]);
  });
});

describe("validateFollowUp", () => {
  it("requires fu_status", () => {
    expect(validateFollowUp({ fu_status: "" }, NOW).fu_status).toBeTruthy();
  });
  it("No Pickup requires a future next time", () => {
    expect(validateFollowUp({ fu_status: "No Pickup", next_follow_up_time: "" }, NOW).next_follow_up_time).toBeTruthy();
    expect(validateFollowUp({ fu_status: "No Pickup", next_follow_up_time: "2026-07-06T10:00" }, NOW).next_follow_up_time).toBeTruthy();
    expect(validateFollowUp({ fu_status: "No Pickup", next_follow_up_time: "2026-07-08T10:00" }, NOW)).toEqual({});
  });
  it("requires a future next time for BOTH statuses", () => {
    expect(validateFollowUp({ fu_status: "Pickup", next_follow_up_time: "" }, NOW).next_follow_up_time).toBeTruthy();
    expect(validateFollowUp({ fu_status: "Pickup", next_follow_up_time: "2026-07-06T10:00" }, NOW).next_follow_up_time).toBeTruthy();
    expect(validateFollowUp({ fu_status: "Pickup", next_follow_up_time: "2026-07-08T10:00" }, NOW)).toEqual({});
    expect(validateFollowUp({ fu_status: "No Pickup", next_follow_up_time: "2026-07-08T10:00" }, NOW)).toEqual({});
  });
});

describe("isFollowUpEligible", () => {
  it("only Ready and Long Term", () => {
    expect(FOLLOWUP_STATUSES).toEqual(["Ready", "Long Term"]);
    expect(isFollowUpEligible("Ready")).toBe(true);
    expect(isFollowUpEligible("Long Term")).toBe(true);
    expect(isFollowUpEligible("Not Ready")).toBe(false);
    expect(isFollowUpEligible("Closed")).toBe(false);
  });
});

describe("nextStreak", () => {
  it("increments on No Pickup, resets on Pickup", () => {
    expect(nextStreak(2, "No Pickup")).toBe(3);
    expect(nextStreak(2, "Pickup")).toBe(0);
  });
});
