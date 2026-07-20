// @vitest-environment node
import { describe, it, expect } from "vitest";
import { computeVerdict } from "@/lib/email-verify/verdict";
import type { ProviderSignal, VerdictSignals } from "@/lib/email-verify/types";

const goodSyntax = { valid: true, reasons: [] as never[] };

function v(overrides: Partial<VerdictSignals> = {}) {
  return computeVerdict({ syntax: goodSyntax, dns: "ok", ...overrides });
}

function provider(
  classification: ProviderSignal["classification"],
  detail: ProviderSignal["detail"] = null
): ProviderSignal {
  return { provider: "verifalia", status: "X", classification, detail };
}

describe("email-verify verdict engine", () => {
  it("returns OK for a clean address", () => {
    expect(v()).toEqual({ verdict: "OK", reasons: ["dns_ok"] });
  });

  describe("BLOCK is reserved for deterministic failures", () => {
    it("blocks bad syntax and surfaces the syntax reasons", () => {
      const r = computeVerdict({ syntax: { valid: false, reasons: ["syntax_at_count"] } });
      expect(r.verdict).toBe("BLOCK");
      expect(r.reasons).toEqual(["syntax_at_count"]);
    });

    it("blocks NXDOMAIN", () => {
      expect(v({ dns: "nxdomain" })).toEqual({ verdict: "BLOCK", reasons: ["dns_nxdomain"] });
    });

    it("blocks an RFC 7505 null MX", () => {
      expect(v({ dns: "null_mx" })).toEqual({ verdict: "BLOCK", reasons: ["dns_null_mx"] });
    });

    it("blocks no-MX-and-no-A/AAAA", () => {
      expect(v({ dns: "no_mx_no_addr" })).toEqual({ verdict: "BLOCK", reasons: ["dns_no_mx_no_addr"] });
    });

    it("a deterministic DNS failure outranks every soft signal", () => {
      const r = v({ dns: "nxdomain", disposable: true, provider: provider("deliverable") });
      expect(r.verdict).toBe("BLOCK");
    });
  });

  describe("everything probabilistic is only a WARN", () => {
    it("never blocks on a DNS timeout / SERVFAIL", () => {
      const r = v({ dns: "unknown" });
      expect(r.verdict).toBe("WARN");
      expect(r.reasons).toContain("dns_unknown");
    });

    it("warns on a disposable domain", () => {
      const r = v({ disposable: true });
      expect(r.verdict).toBe("WARN");
      expect(r.reasons).toContain("disposable_domain");
    });

    it("warns on a role account", () => {
      const r = v({ role: true, localPart: "sales" });
      expect(r.verdict).toBe("WARN");
      expect(r.reasons).toContain("role_account");
    });

    it("warns when a typo is suspected", () => {
      const r = v({ suggestion: "a@gmail.com" });
      expect(r.verdict).toBe("WARN");
      expect(r.reasons).toContain("typo_suspected");
    });

    it.each([
      ["undeliverable", "provider_undeliverable"],
      ["risky", "provider_risky"],
      ["unknown", "provider_unknown"],
    ] as const)("warns (never blocks) when the provider says %s", (cls, reason) => {
      const r = v({ provider: provider(cls) });
      expect(r.verdict).toBe("WARN");
      expect(r.reasons).toContain(reason);
    });

    it("warns on catch-all and mailbox-not-found details", () => {
      expect(v({ provider: provider("risky", "catch_all") }).reasons).toContain("provider_catch_all");
      const notFound = v({ provider: provider("undeliverable", "mailbox_not_found") });
      expect(notFound.verdict).toBe("WARN");
      expect(notFound.reasons).toContain("provider_mailbox_not_found");
    });
  });

  it("stays OK when the provider says deliverable", () => {
    const r = v({ provider: provider("deliverable") });
    expect(r.verdict).toBe("OK");
    expect(r.reasons).toContain("provider_deliverable");
  });

  it("treats a privacy relay as informational, not disposable", () => {
    const r = v({ privacyRelay: true, disposable: true });
    expect(r.verdict).toBe("OK");
    expect(r.reasons).toContain("privacy_relay");
    expect(r.reasons).not.toContain("disposable_domain");
  });

  it("labels a local-only result without changing the verdict", () => {
    const r = v({ localOnly: true });
    expect(r.verdict).toBe("OK");
    expect(r.reasons).toContain("local_only");
  });

  describe("postmaster@ is never reported as invalid", () => {
    it("is not downgraded by its role status", () => {
      const r = v({ role: true, localPart: "postmaster" });
      expect(r.verdict).toBe("OK");
    });

    it("survives a provider claiming the mailbox does not exist", () => {
      const r = v({
        role: true,
        localPart: "postmaster",
        provider: provider("undeliverable", "mailbox_not_found"),
      });
      expect(r.verdict).toBe("OK");
    });

    it("but still blocks when the DOMAIN itself is dead", () => {
      expect(v({ dns: "nxdomain", localPart: "postmaster", role: true }).verdict).toBe("BLOCK");
      expect(v({ dns: "null_mx", localPart: "postmaster", role: true }).verdict).toBe("BLOCK");
    });

    it("still warns when the domain looks like a typo", () => {
      const r = v({ role: true, localPart: "postmaster", suggestion: "postmaster@gmail.com" });
      expect(r.verdict).toBe("WARN");
    });
  });

  it("never emits duplicate reason codes", () => {
    const r = v({ role: true, disposable: true, suggestion: "x@y.com", provider: provider("risky", "role") });
    expect(new Set(r.reasons).size).toBe(r.reasons.length);
  });

  it("treats a missing DNS signal as unknown rather than a pass", () => {
    const r = computeVerdict({ syntax: goodSyntax });
    expect(r.verdict).toBe("WARN");
    expect(r.reasons).toContain("dns_unknown");
  });
});
