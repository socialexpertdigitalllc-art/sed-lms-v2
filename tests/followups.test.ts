import { describe, it, expect } from "vitest";
import { bucketOf, groupByBucket, validateFollowUp, nextStreak, isFollowUpEligible, FOLLOWUP_STATUSES, endsFollowUps } from "@/lib/leads/followups";

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

describe("validateFollowUp — dropping a lead", () => {
  const now = new Date("2026-08-22T10:00:00.000Z");

  it("does not require a next time when the lead is being Dropped", () => {
    const errs = validateFollowUp(
      { fu_status: "Pickup", next_follow_up_time: "", status_change: "Dropped" },
      now,
    );
    expect(errs).toEqual({});
  });

  it("still requires a future time for every non-terminal status change", () => {
    for (const status of ["", "Ready", "Long Term", "Closed"]) {
      const errs = validateFollowUp(
        { fu_status: "Pickup", next_follow_up_time: "", status_change: status },
        now,
      );
      expect(errs.next_follow_up_time, `status "${status}" must still require a time`).toBeTruthy();
    }
  });

  it("still reports a missing fu_status when dropping", () => {
    const errs = validateFollowUp({ fu_status: "", status_change: "Dropped" }, now);
    expect(errs.fu_status).toBeTruthy();
    expect(errs.next_follow_up_time).toBeUndefined();
  });
});

describe("endsFollowUps", () => {
  it("is true only for Dropped", () => {
    expect(endsFollowUps("Dropped")).toBe(true);
    expect(endsFollowUps("Ready")).toBe(false);
    expect(endsFollowUps(null)).toBe(false);
    expect(endsFollowUps(undefined)).toBe(false);
  });
});
