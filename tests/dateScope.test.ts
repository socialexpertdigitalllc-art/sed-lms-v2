import { describe, it, expect } from "vitest";
import { monthKey, monthLabel, monthOptions, inMonth, MONTH_ALL, companyTimezone, DEFAULT_COMPANY_TZ } from "@/lib/analytics/dateScope";

const PK = "Asia/Karachi";

describe("monthKey", () => {
  it("extracts YYYY-MM from ISO", () => expect(monthKey("2026-07-10T08:00:00Z", PK)).toBe("2026-07"));
  it("empty on null/invalid", () => { expect(monthKey(null, PK)).toBe(""); expect(monthKey("nope", PK)).toBe(""); });
});
describe("monthLabel", () => {
  it("humanizes", () => expect(monthLabel("2026-07")).toBe("July 2026"));
});
describe("monthOptions", () => {
  it("distinct months, newest first", () => {
    const rows = [{created_at:"2026-07-10"},{created_at:"2026-07-02"},{created_at:"2026-05-01"},{created_at:"2026-06-09"}];
    expect(monthOptions(rows, PK).map(o=>o.value)).toEqual(["2026-07","2026-06","2026-05"]);
    expect(monthOptions(rows, PK)[0].label).toBe("July 2026");
  });
});
describe("inMonth", () => {
  it("MONTH_ALL matches everything", () => { expect(MONTH_ALL).toBe(""); expect(inMonth("2026-07-10", MONTH_ALL, PK)).toBe(true); });
  it("matches same month only", () => {
    expect(inMonth("2026-07-10", "2026-07", PK)).toBe(true);
    expect(inMonth("2026-06-30", "2026-07", PK)).toBe(false);
    expect(inMonth(null, "2026-07", PK)).toBe(false);
  });
});

describe("months follow the company's calendar, not UTC", () => {
  // 2am on Nov 1st in Pakistan is still Oct 31st, 9pm, in UTC.
  const lateNight = "2026-10-31T21:00:00Z";
  it("counts a 2am Pakistan close on the 1st in the new month", () => {
    expect(monthKey(lateNight, PK)).toBe("2026-11");
    expect(inMonth(lateNight, "2026-11", PK)).toBe(true);
    expect(inMonth(lateNight, "2026-10", PK)).toBe(false);
  });
  it("would have been October by the UTC clock", () => {
    expect(monthKey(lateNight, "UTC")).toBe("2026-10");
  });
  it("the month's last evening in Pakistan is still that month", () => {
    expect(monthKey("2026-10-31T18:59:00Z", PK)).toBe("2026-10"); // 11:59pm Oct 31 PKT
    expect(monthKey("2026-10-31T19:00:00Z", PK)).toBe("2026-11"); // midnight Nov 1 PKT
  });
  it("falls back to Pakistan time for a missing or mistyped zone", () => {
    expect(DEFAULT_COMPANY_TZ).toBe("Asia/Karachi");
    expect(companyTimezone("America/New_York")).toBe("America/New_York");
    expect(companyTimezone("Mars/Olympus")).toBe("Asia/Karachi");
    expect(companyTimezone("")).toBe("Asia/Karachi");
    expect(companyTimezone(null)).toBe("Asia/Karachi");
  });
});
