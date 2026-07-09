import { describe, it, expect } from "vitest";
import { slaDueDate, bumpPriority, isOverdue, retentionEligible } from "@/lib/tickets/logic";
describe("slaDueDate", () => {
  it("adds SLA hours for the priority", () => {
    expect(slaDueDate("High", { Low:168, Normal:72, High:24 }, "2026-07-09T00:00:00Z")).toBe("2026-07-10T00:00:00.000Z");
  });
});
describe("bumpPriority", () => {
  it("Low→Normal, Normal→High, High→High", () => {
    expect(bumpPriority("Low")).toBe("Normal"); expect(bumpPriority("Normal")).toBe("High"); expect(bumpPriority("High")).toBe("High");
  });
});
describe("isOverdue", () => {
  const now = new Date("2026-07-09T12:00:00Z");
  it("past due + not resolved = overdue", () => expect(isOverdue("2026-07-09T10:00:00Z", "In Progress", now)).toBe(true));
  it("resolved is never overdue", () => expect(isOverdue("2026-07-09T10:00:00Z", "Resolved", now)).toBe(false));
  it("future due is not overdue", () => expect(isOverdue("2026-07-09T20:00:00Z", "Open", now)).toBe(false));
  it("no due date is not overdue", () => expect(isOverdue(null, "Open", now)).toBe(false));
});
describe("retentionEligible", () => {
  const now = new Date("2026-07-09T00:00:00Z");
  it("resolved older than N days is eligible", () => expect(retentionEligible("Resolved", "2026-06-01T00:00:00Z", 30, now)).toBe(true));
  it("recent resolved is not", () => expect(retentionEligible("Resolved", "2026-07-08T00:00:00Z", 30, now)).toBe(false));
  it("non-resolved never eligible", () => expect(retentionEligible("In Progress", "2026-01-01T00:00:00Z", 30, now)).toBe(false));
  it("retention 0 = disabled", () => expect(retentionEligible("Resolved", "2026-01-01T00:00:00Z", 0, now)).toBe(false));
});
