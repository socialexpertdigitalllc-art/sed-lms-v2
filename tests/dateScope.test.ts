import { describe, it, expect } from "vitest";
import { monthKey, monthLabel, monthOptions, inMonth, MONTH_ALL } from "@/lib/analytics/dateScope";

describe("monthKey", () => {
  it("extracts YYYY-MM from ISO", () => expect(monthKey("2026-07-10T08:00:00Z")).toBe("2026-07"));
  it("empty on null/invalid", () => { expect(monthKey(null)).toBe(""); expect(monthKey("nope")).toBe(""); });
});
describe("monthLabel", () => {
  it("humanizes", () => expect(monthLabel("2026-07")).toBe("July 2026"));
});
describe("monthOptions", () => {
  it("distinct months, newest first", () => {
    const rows = [{created_at:"2026-07-10"},{created_at:"2026-07-02"},{created_at:"2026-05-01"},{created_at:"2026-06-09"}];
    expect(monthOptions(rows).map(o=>o.value)).toEqual(["2026-07","2026-06","2026-05"]);
    expect(monthOptions(rows)[0].label).toBe("July 2026");
  });
});
describe("inMonth", () => {
  it("MONTH_ALL matches everything", () => { expect(MONTH_ALL).toBe(""); expect(inMonth("2026-07-10", MONTH_ALL)).toBe(true); });
  it("matches same month only", () => {
    expect(inMonth("2026-07-10", "2026-07")).toBe(true);
    expect(inMonth("2026-06-30", "2026-07")).toBe(false);
    expect(inMonth(null, "2026-07")).toBe(false);
  });
});
