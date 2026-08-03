import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { isProtectedDomain, protectedDomains } from "@/lib/site-studio/deploy/protected";

const ORIG = { list: process.env.PROTECTED_DOMAINS, apex: process.env.DA_DOMAIN };

beforeEach(() => {
  process.env.PROTECTED_DOMAINS = "socialexpertdigital.com, SedSolutions.online";
  process.env.DA_DOMAIN = "dmviral.com";
});
afterEach(() => {
  process.env.PROTECTED_DOMAINS = ORIG.list;
  process.env.DA_DOMAIN = ORIG.apex;
});

describe("protectedDomains", () => {
  it("parses the env list and always includes the staging apex", () => {
    expect(protectedDomains()).toEqual(["socialexpertdigital.com", "sedsolutions.online", "dmviral.com"]);
  });
});

describe("isProtectedDomain", () => {
  it("matches exact domains case-insensitively", () => {
    expect(isProtectedDomain("socialexpertdigital.com")).toBe(true);
    expect(isProtectedDomain("SEDSOLUTIONS.ONLINE")).toBe(true);
  });
  it("matches subdomains of protected domains", () => {
    expect(isProtectedDomain("www.socialexpertdigital.com")).toBe(true);
    expect(isProtectedDomain("anything.dmviral.com")).toBe(true);
  });
  it("does not match lookalikes or client domains", () => {
    expect(isProtectedDomain("notsocialexpertdigital.com")).toBe(false);
    expect(isProtectedDomain("oceancutz.com")).toBe(false);
    expect(isProtectedDomain(null)).toBe(false);
  });
});
