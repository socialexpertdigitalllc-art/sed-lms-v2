import { describe, it, expect } from "vitest";
import { toDateTimeLocal, inMinutes } from "@/lib/dates/datetimeLocal";

describe("toDateTimeLocal", () => {
  it("formats a local Date as yyyy-MM-ddTHH:mm with zero padding", () => {
    expect(toDateTimeLocal(new Date(2026, 0, 5, 7, 8))).toBe("2026-01-05T07:08");
  });

  it("handles double-digit month/day/hour/minute", () => {
    expect(toDateTimeLocal(new Date(2026, 11, 25, 23, 59))).toBe("2026-12-25T23:59");
  });
});

describe("inMinutes", () => {
  it("adds minutes to an explicit start", () => {
    expect(inMinutes(30, new Date(2026, 0, 5, 7, 8))).toBe("2026-01-05T07:38");
  });

  it("rolls over hours and days", () => {
    expect(inMinutes(120, new Date(2026, 0, 31, 23, 30))).toBe("2026-02-01T01:30");
  });

  it("defaults to now when no start is given", () => {
    const before = new Date(Date.now() + 15 * 60_000);
    const got = inMinutes(15);
    const after = new Date(Date.now() + 15 * 60_000);
    // The result must be between the two bounds (minute precision).
    expect([toDateTimeLocal(before), toDateTimeLocal(after)]).toContain(got);
  });
});
