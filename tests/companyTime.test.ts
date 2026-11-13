// @vitest-environment node
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import vm from "node:vm";
import { readFileSync } from "node:fs";
import { companyTimeScript, DEFAULT_TIMEZONE } from "@/lib/time/companyTime";

/**
 * The page script that puts the browser on the company timezone (Pacific
 * time) and the server's clock (lib/time/companyTime.ts), run exactly as the
 * page runs it — the string, in a fresh JavaScript realm with its own Date and
 * Intl — on a "device" set to Pakistan time whose clock is 3 hours wrong.
 */

const savedTz = process.env.TZ;
beforeAll(() => {
  process.env.TZ = "Asia/Karachi"; // the device's timezone: not Pacific
});
afterAll(() => {
  if (savedTz === undefined) delete process.env.TZ;
  else process.env.TZ = savedTz;
});

const HOUR = 3_600_000;
const PACIFIC = "America/Los_Angeles";

/** A fresh browser-like realm with the page script installed. */
function page(serverNowOffsetMs = 0, tz = PACIFIC) {
  const ctx = vm.createContext({ console });
  vm.runInContext("var window = globalThis;", ctx);
  const deviceNow = vm.runInContext("Date.now()", ctx) as number;
  vm.runInContext(companyTimeScript(deviceNow + serverNowOffsetMs, tz), ctx);
  return <T = unknown>(code: string) => vm.runInContext(code, ctx) as T;
}
const iso = (expr: string) => `${expr}.toISOString()`;

describe("the company timezone is Pacific time", () => {
  it("by default", () => expect(DEFAULT_TIMEZONE).toBe(PACIFIC));

  it("the device really is in Pakistan (sanity)", () => {
    expect(new Date("2026-11-13T10:00:00Z").getHours()).toBe(15);
  });
});

describe("the device's timezone no longer matters", () => {
  it("reads the wall clock in Pacific time — standard time in winter, daylight time in summer", () => {
    const run = page();
    expect(run(`new Date("2026-11-13T10:00:00Z").getHours()`)).toBe(2); // PST, UTC−8
    expect(run(`new Date("2026-07-01T19:00:00Z").getHours()`)).toBe(12); // PDT, UTC−7
    expect(run(`new Date("2026-11-14T05:00:00Z").getDate()`)).toBe(13); // still the 13th in California
    expect(run(`new Date("2026-11-13T10:00:00Z").getTimezoneOffset()`)).toBe(480);
    expect(run(`new Date("2026-07-01T19:00:00Z").getTimezoneOffset()`)).toBe(420);
  });

  it("a time typed in means that time in California", () => {
    const run = page();
    expect(run(iso(`new Date("2026-11-13T15:00")`))).toBe("2026-11-13T23:00:00.000Z");
    expect(run(iso(`new Date("2026-07-01T12:00")`))).toBe("2026-07-01T19:00:00.000Z");
    expect(run(iso(`new Date("2026-11-13 15:00")`))).toBe("2026-11-13T23:00:00.000Z");
    expect(run(iso(`new Date(2026, 10, 13, 15, 0)`))).toBe("2026-11-13T23:00:00.000Z");
    expect(run(iso(`new Date(Date.parse("2026-11-13T15:00:30"))`))).toBe("2026-11-13T23:00:30.000Z");
    expect(run(iso(`new Date("Nov 13, 2026 3:00 PM")`))).toBe("2026-11-13T23:00:00.000Z");
  });

  it("daylight-saving edges behave like a device in California", () => {
    const run = page();
    // March 8, 2026: 2:00 → 3:00. 2:30 doesn't exist; it moves forward to 3:30 PDT.
    expect(run(iso(`new Date("2026-03-08T02:30")`))).toBe("2026-03-08T10:30:00.000Z");
    // November 1, 2026: 1:30 happens twice; the first one (PDT) is taken.
    expect(run(iso(`new Date("2026-11-01T01:30")`))).toBe("2026-11-01T08:30:00.000Z");
    // Noon the day before / after the March change.
    expect(run(iso(`new Date("2026-03-07T12:00")`))).toBe("2026-03-07T20:00:00.000Z");
    expect(run(iso(`new Date("2026-03-09T12:00")`))).toBe("2026-03-09T19:00:00.000Z");
  });

  it("times that name their zone, and bare dates, keep the standard meaning", () => {
    const run = page();
    expect(run(iso(`new Date("2026-11-13T15:00:00Z")`))).toBe("2026-11-13T15:00:00.000Z");
    expect(run(iso(`new Date("2026-11-13T15:00:00+05:00")`))).toBe("2026-11-13T10:00:00.000Z");
    expect(run(iso(`new Date("2026-11-13")`))).toBe("2026-11-13T00:00:00.000Z");
    expect(run(`new Date(1763028000000).getTime()`)).toBe(1763028000000);
  });

  it("shows Pacific time unless another zone is asked for", () => {
    const run = page();
    const winter = `new Date("2026-11-13T10:00:00Z")`;
    const summer = `new Date("2026-07-01T19:00:00Z")`;
    expect(run(`${winter}.toLocaleString("en-US")`)).toBe("11/13/2026, 2:00:00 AM");
    expect(run(`${winter}.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" })`)).toBe("2:00 AM");
    expect(run(`${summer}.toLocaleDateString("en-US", { month: "short", day: "numeric" })`)).toBe("Jul 1");
    expect(run(`new Intl.DateTimeFormat("en-US", { hour: "numeric" }).format(${winter})`)).toBe("2 AM");
    expect(run(`Intl.DateTimeFormat("en-US", { hour: "numeric" }).format(${summer})`)).toBe("12 PM");
    expect(run(`Intl.DateTimeFormat().resolvedOptions().timeZone`)).toBe(PACIFIC);
    // An explicit zone (a lead's local time) is respected.
    expect(run(`${winter}.toLocaleTimeString("en-US", { hour: "numeric", timeZone: "America/New_York" })`)).toBe("5 AM");
    expect(run(`${winter}.toString()`)).toBe("Fri Nov 13 2026 02:00:00 GMT-0800 (Pacific Standard Time)");
    expect(run(`${summer}.toString()`)).toBe("Wed Jul 01 2026 12:00:00 GMT-0700 (Pacific Daylight Time)");
    expect(run(`${winter}.toDateString()`)).toBe("Fri Nov 13 2026");
    expect(run(`String(new Date(NaN))`)).toBe("Invalid Date");
  });

  it("'end of today' and day arithmetic are California days, across daylight saving", () => {
    const run = page();
    expect(run(`(function () { var d = new Date("2026-11-13T10:00:00Z"); d.setHours(23, 59, 59, 999); return d.toISOString(); })()`)).toBe("2026-11-14T07:59:59.999Z");
    expect(run(`(function () { var d = new Date("2026-11-13T10:00:00Z"); d.setHours(0, 0, 0, 0); return d.toISOString(); })()`)).toBe("2026-11-13T08:00:00.000Z");
    // Noon March 7 (PST) + 1 day = noon March 8 (PDT): one hour less in between.
    expect(run(`(function () { var d = new Date("2026-03-07T20:00:00Z"); d.setDate(d.getDate() + 1); return d.toISOString(); })()`)).toBe("2026-03-08T19:00:00.000Z");
    expect(run(`(function () { var d = new Date("2026-11-30T20:00:00Z"); d.setDate(d.getDate() + 1); return d.toISOString(); })()`)).toBe("2026-12-01T20:00:00.000Z");
    expect(run(`(function () { var d = new Date(NaN); return d.setHours(1); })()`)).toBeNaN();
  });

  it("follows whatever the company timezone setting says", () => {
    const run = page(0, "Asia/Karachi");
    expect(run(`new Date("2026-11-13T10:00:00Z").getHours()`)).toBe(15);
    expect(run(iso(`new Date("2026-11-13T15:00")`))).toBe("2026-11-13T10:00:00.000Z");
  });

  it("an unknown timezone leaves the page alone instead of breaking it", () => {
    const run = page(0, "Mars/Olympus");
    expect(run(`Boolean(Date.__ctInstalled)`)).toBe(false);
  });
});

describe("the device's clock no longer matters", () => {
  it("new Date() and Date.now() follow the server, not a clock 3 hours slow", () => {
    const run = page(3 * HOUR);
    const device = vm.runInNewContext("Date.now()") as number;
    expect(Math.abs(run<number>(`Date.now()`) - device - 3 * HOUR)).toBeLessThan(2000);
    expect(Math.abs(run<number>(`new Date().getTime()`) - device - 3 * HOUR)).toBeLessThan(2000);
  });

  it("the clock can be corrected later; small jitter is ignored", () => {
    const run = page(0);
    run(`Date.__ctSetServerNow(Date.now() + 500, 2000)`);
    expect(Math.abs(run<number>(`Date.__ctSkew()`))).toBeLessThan(200);
    run(`Date.__ctSetServerNow(Date.now() + 3600000, 2000)`);
    expect(Math.abs(run<number>(`Date.__ctSkew()`) - HOUR)).toBeLessThan(200);
  });
});

describe("nothing else breaks", () => {
  it("dates stay Dates, subclasses and Date() still work", () => {
    const run = page();
    expect(run(`new Date() instanceof Date`)).toBe(true);
    expect(run(`Object.prototype.toString.call(new Date())`)).toBe("[object Date]");
    expect(run(`(function () { class Stamp extends Date {} var s = new Stamp("2026-11-13T15:00"); return [s instanceof Stamp, s instanceof Date, s.toISOString()]; })()`)).toEqual([
      true,
      true,
      "2026-11-13T23:00:00.000Z",
    ]);
    expect(run(`typeof Date()`)).toBe("string");
    expect(run(iso(`new Date(new Date("2026-11-13T10:00:00Z"))`))).toBe("2026-11-13T10:00:00.000Z");
    expect(run(`new Date("2026-11-13T10:00:00Z").constructor === Date`)).toBe(true);
    expect(run(`JSON.stringify({ at: new Date("2026-11-13T10:00:00Z") })`)).toBe('{"at":"2026-11-13T10:00:00.000Z"}');
    expect(run(`Date.UTC(2026, 10, 13)`)).toBe(Date.UTC(2026, 10, 13));
  });

  it("running the page script twice doesn't shift anything twice", () => {
    const ctx = vm.createContext({ console });
    vm.runInContext("var window = globalThis;", ctx);
    const now = vm.runInContext("Date.now()", ctx) as number;
    vm.runInContext(companyTimeScript(now, PACIFIC), ctx);
    vm.runInContext(companyTimeScript(now, PACIFIC), ctx);
    expect(vm.runInContext(`new Date("2026-11-13T10:00:00Z").getHours()`, ctx)).toBe(2);
    expect(vm.runInContext(`new Date("2026-11-13T15:00").toISOString()`, ctx)).toBe("2026-11-13T23:00:00.000Z");
  });
});

describe("wired into every page and the server", () => {
  it("the root layout runs the script before any app code, with the company timezone and the server time", () => {
    const layout = readFileSync("app/layout.tsx", "utf8");
    expect(layout).toMatch(/<Script id="company-time" strategy="beforeInteractive">\s*(\{\/\*[^]*?\*\/\}\s*)?\{companyTimeScript\(Date\.now\(\), timeZone\)\}/);
    expect(layout).toMatch(/companyTimezone\(await getAppSettings\(\)/);
    expect(layout).toMatch(/applyServerTimezone\(timeZone\)/);
    expect(layout).toMatch(/<ServerClockSync \/>/);
  });

  it("the server process runs on Pacific time", () => {
    expect(readFileSync("instrumentation.ts", "utf8")).toMatch(/process\.env\.TZ = "America\/Los_Angeles"/);
    expect(readFileSync("next.config.ts", "utf8")).toMatch(/process\.env\.TZ = "America\/Los_Angeles"/);
    expect(readFileSync("ecosystem.config.cjs", "utf8")).toMatch(/TZ: "America\/Los_Angeles"/);
  });

  it("/api/time answers the server's clock, and is reachable signed out", async () => {
    const { GET } = await import("@/app/api/time/route");
    const before = Date.now();
    const body = (await GET().json()) as { now: number };
    expect(body.now).toBeGreaterThanOrEqual(before);
    expect(readFileSync("lib/supabase/middleware.ts", "utf8")).toMatch(/path === "\/api\/time"/);
  });
});
