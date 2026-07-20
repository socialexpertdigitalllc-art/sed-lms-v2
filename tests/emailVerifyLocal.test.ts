// @vitest-environment node
import { describe, it, expect } from "vitest";
import { buildLocalResult } from "@/lib/email-verify";
import { computeVerdict } from "@/lib/email-verify/verdict";
import type { DnsResult } from "@/lib/email-verify/types";

const dnsOk: DnsResult = {
  domain: "example.com",
  status: "ok",
  hasMx: true,
  nullMx: false,
  hasAddr: false,
  checkedAt: new Date().toISOString(),
};

function verdictFor(email: string, dns: DnsResult | null = dnsOk) {
  const local = buildLocalResult(email, dns);
  return computeVerdict({
    syntax: local.syntax,
    localPart: local.localPart,
    dns: dns?.status ?? null,
    disposable: local.disposable,
    role: local.role,
    privacyRelay: local.privacyRelay,
    suggestion: local.suggestion,
    localOnly: true,
  });
}

describe("buildLocalResult", () => {
  it("gathers every free signal for a clean address", () => {
    const r = buildLocalResult("Milton@Example.com", dnsOk);
    expect(r.normalized).toBe("Milton@example.com");
    expect(r.localPart).toBe("Milton");
    expect(r.domain).toBe("example.com");
    expect(r.syntax.valid).toBe(true);
    expect(r.suggestion).toBeNull();
    expect(r.disposable).toBe(false);
    expect(r.role).toBe(false);
    expect(r.dns).toBe(dnsOk);
  });

  it("flags a disposable domain and a role account", () => {
    expect(buildLocalResult("x@mailinator.com", dnsOk).disposable).toBe(true);
    expect(buildLocalResult("sales@example.com", dnsOk).role).toBe(true);
  });

  it("flags a privacy relay without calling it disposable", () => {
    const r = buildLocalResult("abc@privaterelay.appleid.com", dnsOk);
    expect(r.privacyRelay).toBe(true);
    expect(r.disposable).toBe(false);
  });

  it("attaches a typo suggestion without altering the address", () => {
    const r = buildLocalResult("milton@gmial.com", dnsOk);
    expect(r.suggestion).toBe("milton@gmail.com");
    expect(r.normalized).toBe("milton@gmial.com");
  });

  it("still parses what it can out of an invalid address", () => {
    const r = buildLocalResult("bad..user@gmial.com", null);
    expect(r.syntax.valid).toBe(false);
    expect(r.normalized).toBe("");
    expect(r.suggestion).toBe("bad..user@gmail.com");
  });
});

describe("end-to-end local verdicts (no network, no provider)", () => {
  it.each([
    ["milton@example.com", "OK"],
    ["sales@example.com", "WARN"],
    ["x@mailinator.com", "WARN"],
    ["milton@gmial.com", "WARN"],
    ["not-an-email", "BLOCK"],
    ["a@@b.com", "BLOCK"],
  ] as const)("%s → %s", (email, expected) => {
    expect(verdictFor(email).verdict).toBe(expected);
  });

  it("blocks on a dead domain", () => {
    const dead: DnsResult = { ...dnsOk, status: "nxdomain", hasMx: false };
    expect(verdictFor("milton@example.com", dead).verdict).toBe("BLOCK");
  });

  it("only warns when DNS could not be resolved", () => {
    const unknown: DnsResult = { ...dnsOk, status: "unknown", hasMx: false };
    expect(verdictFor("milton@example.com", unknown).verdict).toBe("WARN");
  });
});
