// @vitest-environment node
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import vm from "node:vm";
import { pakistanTimeScript } from "@/lib/time/pakistanTime";

/**
 * The page script that puts the browser on Pakistan time and the server's
 * clock (lib/time/pakistanTime.ts), run exactly as the page runs it — the
 * string, in a fresh JavaScript realm (its own Date and Intl) — on a "device"
 * set to US Central time whose clock is 3 hours wrong.
 */

const savedTz = process.env.TZ;
beforeAll(() => {
  process.env.TZ = "America/Chicago"; // the device's timezone: not Pakistan
});
afterAll(() => {
  if (savedTz === undefined) delete process.env.TZ;
  else process.env.TZ = savedTz;
});

const HOUR = 3_600_000;

/** A fresh browser-like realm with the page script installed. */
function page(serverNowOffsetMs = 0) {
  const ctx = vm.createContext({ console });
  vm.runInContext("var window = globalThis;", ctx);
  // The realm's own clock is the "device" clock; the server is offset from it.
  const deviceNow = vm.runInContext("Date.now()", ctx) as number;
  vm.runInContext(pakistanTimeScript(deviceNow + serverNowOffsetMs), ctx);
  return <T = unknown>(code: string) => vm.runInContext(code, ctx) as T;
}

describe("the device's timezone no longer matters", () => {
  it("the device really is in Chicago (sanity)", () => {
    expect(new Date("2026-11-13T10:00:00Z").getHours()).toBe(4);
  });

  it("reads the wall clock in Pakistan time", () => {
    const run = page();
    expect(run(`new Date("2026-11-13T10:00:00Z").getHours()`)).toBe(15);
    expect(run(`new Date("2026-11-13T21:30:00Z").getDate()`)).toBe(14); // already the 14th in Karachi
    expect(run(`new Date("2026-11-13T21:30:00Z").getDay()`)).toBe(6);
    expect(run(`new Date("2026-11-13T10:00:00Z").getTimezoneOffset()`)).toBe(-300);
  });

  it("a time typed in means that time in Pakistan", () => {
    const run = page();
    expect(run(`new Date("2026-11-13T15:00").toISOString()`)).toBe("2026-11-13T10:00:00.000Z");
    expect(run(`new Date("2026-11-13 15:00").toISOString()`)).toBe("2026-11-13T10:00:00.000Z");
    expect(run(`new Date(Date.parse("2026-11-13T15:00:30")).toISOString()`)).toBe("2026-11-13T10:00:30.000Z");
    expect(run(`new Date(2026, 10, 13, 15, 0).toISOString()`)).toBe("2026-11-13T10:00:00.000Z");
    expect(run(`new Date("Nov 13, 2026 3:00 PM").toISOString()`)).toBe("2026-11-13T10:00:00.000Z");
  });

  it("times that name their zone, and bare dates, keep the standard meaning", () => {
    const run = page();
    expect(run(`new Date("2026-11-13T15:00:00Z").toISOString()`)).toBe("2026-11-13T15:00:00.000Z");
    expect(run(`new Date("2026-11-13T15:00:00-05:00").toISOString()`)).toBe("2026-11-13T20:00:00.000Z");
    expect(run(`new Date("2026-11-13").toISOString()`)).toBe("2026-11-13T00:00:00.000Z");
    expect(run(`new Date(1763028000000).getTime()`)).toBe(1763028000000);
  });

  it("shows Pakistan time unless another zone is asked for", () => {
    const run = page();
    const at = `new Date("2026-11-13T10:00:00Z")`;
    expect(run(`${at}.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" })`)).toBe("3:00 PM");
    expect(run(`${at}.toLocaleString("en-US")`)).toBe("11/13/2026, 3:00:00 PM");
    expect(run(`${at}.toLocaleDateString("en-US", { month: "short", day: "numeric" })`)).toBe("Nov 13");
    expect(run(`new Intl.DateTimeFormat("en-US", { hour: "numeric" }).format(${at})`)).toBe("3 PM");
    expect(run(`Intl.DateTimeFormat("en-US", { hour: "numeric" }).format(${at})`)).toBe("3 PM");
    expect(run(`Intl.DateTimeFormat().resolvedOptions().timeZone`)).toBe("Asia/Karachi");
    // An explicit zone (a lead's local time) is respected.
    expect(run(`${at}.toLocaleTimeString("en-US", { hour: "numeric", timeZone: "America/New_York" })`)).toBe("5 AM");
    expect(run(`new Intl.DateTimeFormat("en-US", { hour: "numeric", timeZone: "America/New_York" }).format(${at})`)).toBe("5 AM");
    expect(run(`${at}.toString()`)).toBe("Fri Nov 13 2026 15:00:00 GMT+0500 (Pakistan Standard Time)");
    expect(run(`${at}.toDateString()`)).toBe("Fri Nov 13 2026");
    expect(run(`String(new Date(NaN))`)).toBe("Invalid Date");
  });

  it("'end of today' and day arithmetic are Pakistan days", () => {
    const run = page();
    expect(run(`(function () { var d = new Date("2026-11-13T10:00:00Z"); d.setHours(23, 59, 59, 999); return d.toISOString(); })()`)).toBe("2026-11-13T18:59:59.999Z");
    expect(run(`(function () { var d = new Date("2026-11-30T10:00:00Z"); d.setDate(d.getDate() + 1); return d.toISOString(); })()`)).toBe("2026-12-01T10:00:00.000Z");
    expect(run(`(function () { var d = new Date("2026-11-13T10:00:00Z"); d.setHours(0, 0, 0, 0); return d.toISOString(); })()`)).toBe("2026-11-12T19:00:00.000Z");
    expect(run(`(function () { var d = new Date(NaN); return d.setHours(1); })()`)).toBeNaN();
  });
});

describe("the device's clock no longer matters", () => {
  it("new Date() and Date.now() follow the server, not a clock 3 hours slow", () => {
    const run = page(3 * HOUR);
    const device = vm.runInNewContext("Date.now()") as number;
    const skew = (run(`Date.now()`) as number) - device;
    expect(Math.abs(skew - 3 * HOUR)).toBeLessThan(2000);
    const fresh = (run(`new Date().getTime()`) as number) - device;
    expect(Math.abs(fresh - 3 * HOUR)).toBeLessThan(2000);
  });

  it("the clock can be corrected later; small jitter is ignored", () => {
    const run = page(0);
    run(`Date.__pkSetServerNow(Date.now() + 500, 2000)`);
    expect(Math.abs(run<number>(`Date.__pkSkew()`))).toBeLessThan(200);
    run(`Date.__pkSetServerNow(Date.now() + 3600000, 2000)`);
    expect(Math.abs(run<number>(`Date.__pkSkew()`) - HOUR)).toBeLessThan(200);
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
      "2026-11-13T10:00:00.000Z",
    ]);
    expect(run(`typeof Date()`)).toBe("string");
    expect(run(`new Date(new Date("2026-11-13T10:00:00Z")).toISOString()`)).toBe("2026-11-13T10:00:00.000Z");
    expect(run(`new Date("2026-11-13T10:00:00Z").constructor === Date`)).toBe(true);
    expect(run(`JSON.stringify({ at: new Date("2026-11-13T10:00:00Z") })`)).toBe('{"at":"2026-11-13T10:00:00.000Z"}');
    expect(run(`Date.UTC(2026, 10, 13)`)).toBe(Date.UTC(2026, 10, 13));
  });

  it("running the page script twice doesn't shift anything twice", () => {
    const ctx = vm.createContext({ console });
    vm.runInContext("var window = globalThis;", ctx);
    const now = vm.runInContext("Date.now()", ctx) as number;
    vm.runInContext(pakistanTimeScript(now), ctx);
    vm.runInContext(pakistanTimeScript(now), ctx);
    expect(vm.runInContext(`new Date("2026-11-13T10:00:00Z").getHours()`, ctx)).toBe(15);
    expect(vm.runInContext(`new Date("2026-11-13T15:00").toISOString()`, ctx)).toBe("2026-11-13T10:00:00.000Z");
  });

  it("the script is self-contained (it runs in an empty realm)", () => {
    expect(() => page()).not.toThrow();
    expect(pakistanTimeScript(0)).not.toMatch(/__vite|require\(|import /);
  });
});

describe("wired into every page and the server", () => {
  it("the root layout runs the script before any app code, stamped with the server time", async () => {
    const { readFileSync } = await import("node:fs");
    const layout = readFileSync("app/layout.tsx", "utf8");
    expect(layout).toMatch(/<Script id="pakistan-time" strategy="beforeInteractive">\s*(\{\/\*[^]*?\*\/\}\s*)?\{pakistanTimeScript\(Date\.now\(\)\)\}/);
    expect(layout).toMatch(/<ServerClockSync \/>/);
  });

  it("the server process runs on Pakistan time", async () => {
    const { readFileSync } = await import("node:fs");
    expect(readFileSync("instrumentation.ts", "utf8")).toMatch(/process\.env\.TZ = "Asia\/Karachi"/);
    expect(readFileSync("next.config.ts", "utf8")).toMatch(/process\.env\.TZ = "Asia\/Karachi"/);
    expect(readFileSync("ecosystem.config.cjs", "utf8")).toMatch(/TZ: "Asia\/Karachi"/);
  });

  it("/api/time answers the server's clock, and is reachable signed out", async () => {
    const { GET } = await import("@/app/api/time/route");
    const before = Date.now();
    const body = (await GET().json()) as { now: number };
    expect(body.now).toBeGreaterThanOrEqual(before);
    const { readFileSync } = await import("node:fs");
    expect(readFileSync("lib/supabase/middleware.ts", "utf8")).toMatch(/path === "\/api\/time"/);
  });
});
