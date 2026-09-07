// tests/formsGate.test.ts
// @vitest-environment node
import { describe, it, expect, beforeEach } from "vitest";
import { originHost, originAllowed, clientIp, ipRateAllowed, resetIpRate, gateSubmission, IP_LIMIT_PER_MINUTE } from "@/lib/forms/gate";

beforeEach(() => resetIpRate());

describe("originHost", () => {
  it("prefers Origin, falls back to Referer host, lowercases", () => {
    expect(originHost("https://Foo.com", null)).toBe("foo.com");
    expect(originHost(null, "https://bar.com/contact?x=1")).toBe("bar.com");
    expect(originHost("null", null)).toBeNull();
    expect(originHost(null, null)).toBeNull();
  });
});

describe("originAllowed", () => {
  it("allows anything when the list is empty", () => {
    expect(originAllowed(null, [])).toBe(true);
    expect(originAllowed("x.com", [])).toBe(true);
  });
  it("matches exact and wildcard entries, rejects unknown/missing", () => {
    expect(originAllowed("foo.com", ["foo.com"])).toBe(true);
    expect(originAllowed("www.foo.com", ["*.foo.com"])).toBe(true);
    expect(originAllowed("foo.com", ["*.foo.com"])).toBe(true);
    expect(originAllowed("evil.com", ["foo.com"])).toBe(false);
    expect(originAllowed(null, ["foo.com"])).toBe(false);
  });
});

describe("clientIp", () => {
  it("takes the first x-forwarded-for hop", () => {
    expect(clientIp(new Headers({ "x-forwarded-for": "1.2.3.4, 10.0.0.1" }))).toBe("1.2.3.4");
    expect(clientIp(new Headers({ "x-real-ip": "5.6.7.8" }))).toBe("5.6.7.8");
    expect(clientIp(new Headers())).toBe("unknown");
  });
});

describe("ipRateAllowed", () => {
  it("allows up to the limit per minute then blocks, and slides", () => {
    let t = 1_000_000;
    const now = () => t;
    for (let i = 0; i < IP_LIMIT_PER_MINUTE; i++) expect(ipRateAllowed("1.1.1.1", now)).toBe(true);
    expect(ipRateAllowed("1.1.1.1", now)).toBe(false);
    expect(ipRateAllowed("2.2.2.2", now)).toBe(true);
    t += 61_000;
    expect(ipRateAllowed("1.1.1.1", now)).toBe(true);
  });
});

describe("gateSubmission", () => {
  const endpoint = { allowed_origins: ["foo.com"], daily_limit: 2 };
  it("passes a clean request", () => {
    expect(gateSubmission({ originHost: "foo.com", endpoint, honeypot: "", ip: "9.9.9.9", todayCount: 0 })).toEqual({ ok: true });
  });
  it("flags origin first", () => {
    expect(gateSubmission({ originHost: "evil.com", endpoint, honeypot: "bot", ip: "9.9.9.9", todayCount: 0 })).toEqual({ ok: false, reason: "origin", status: 403 });
  });
  it("flags honeypot with a fake 200", () => {
    expect(gateSubmission({ originHost: "foo.com", endpoint, honeypot: "x", ip: "9.9.9.9", todayCount: 0 })).toEqual({ ok: false, reason: "honeypot", status: 200 });
  });
  it("flags the daily limit", () => {
    expect(gateSubmission({ originHost: "foo.com", endpoint, honeypot: "", ip: "9.9.9.9", todayCount: 2 })).toEqual({ ok: false, reason: "rate_daily", status: 429 });
  });
  it("rate-limits a honeypot flood instead of replying fake-200 forever", () => {
    for (let i = 0; i < IP_LIMIT_PER_MINUTE; i++) {
      expect(gateSubmission({ originHost: "foo.com", endpoint, honeypot: "bot", ip: "8.8.8.8", todayCount: 0 })).toEqual({ ok: false, reason: "honeypot", status: 200 });
    }
    expect(gateSubmission({ originHost: "foo.com", endpoint, honeypot: "bot", ip: "8.8.8.8", todayCount: 0 })).toEqual({ ok: false, reason: "rate_ip", status: 429 });
  });
  it("flags per-IP bursts", () => {
    for (let i = 0; i < IP_LIMIT_PER_MINUTE; i++) gateSubmission({ originHost: "foo.com", endpoint, honeypot: "", ip: "7.7.7.7", todayCount: 0 });
    expect(gateSubmission({ originHost: "foo.com", endpoint, honeypot: "", ip: "7.7.7.7", todayCount: 0 })).toEqual({ ok: false, reason: "rate_ip", status: 429 });
  });
});
