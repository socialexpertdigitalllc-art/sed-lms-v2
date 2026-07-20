// @vitest-environment node
import { describe, it, expect } from "vitest";
import {
  PROVIDER_REGISTRY,
  RECOMMENDED_ORDER,
  getDescriptor,
  hasCompleteCredentials,
  isKnownProvider,
  maskCredentialHint,
  recommendedPriority,
} from "@/lib/email-verify/registry";
import { PROVIDER_LIMITS } from "@/lib/email-verify/providers/quota";
import { credentialsFromEnv } from "@/lib/email-verify/config";
import type { ProviderName } from "@/lib/email-verify/types";

describe("provider registry", () => {
  it("describes exactly the providers we have adapters for", () => {
    expect(PROVIDER_REGISTRY.map((p) => p.key)).toEqual([
      "verifalia",
      "reoon",
      "mailrook",
      "inboxtrue",
      "check_mail",
    ]);
    // The two SMTP-accurate vendors stay first; domain-level Check-Mail stays
    // last, and mailbox-level newcomers slot in ahead of it.
    expect(RECOMMENDED_ORDER).toEqual(["verifalia", "reoon", "mailrook", "inboxtrue", "check_mail"]);
  });

  it("agrees with the chain's free-tier limits", () => {
    for (const d of PROVIDER_REGISTRY) {
      const limits = PROVIDER_LIMITS[d.key as ProviderName];
      expect({ limit: d.freeLimit, period: d.period }).toEqual(limits);
    }
  });

  it("declares the credential fields the UI must render", () => {
    expect(getDescriptor("verifalia")?.fields.map((f) => [f.key, f.type])).toEqual([
      ["username", "text"],
      ["password", "password"],
    ]);
    expect(getDescriptor("reoon")?.fields.map((f) => [f.key, f.type])).toEqual([["api_key", "password"]]);
    expect(getDescriptor("mailrook")?.fields.map((f) => [f.key, f.type])).toEqual([["api_key", "password"]]);
    expect(getDescriptor("inboxtrue")?.fields.map((f) => [f.key, f.type])).toEqual([["api_key", "password"]]);
    expect(getDescriptor("check_mail")?.fields.map((f) => [f.key, f.type])).toEqual([["api_key", "password"]]);
  });

  it("only claims balance support where a real endpoint is documented", () => {
    expect(getDescriptor("verifalia")?.supportsBalance).toBe(true);
    expect(getDescriptor("reoon")?.supportsBalance).toBe(true);
    // None of these documents a credits endpoint — they fall back to our counter.
    // (InboxTrue publishes rate-limit headers only, which are request pacing.)
    expect(getDescriptor("mailrook")?.supportsBalance).toBe(false);
    expect(getDescriptor("inboxtrue")?.supportsBalance).toBe(false);
    expect(getDescriptor("check_mail")?.supportsBalance).toBe(false);
  });

  it("declares a seed env var for every credential field", () => {
    for (const d of PROVIDER_REGISTRY) {
      for (const f of d.fields) expect(d.envKeys[f.key]).toMatch(/^[A-Z0-9_]+$/);
    }
  });

  it("gives every provider a docs url and a factual privacy note", () => {
    for (const d of PROVIDER_REGISTRY) {
      expect(d.docsUrl).toMatch(/^https:\/\//);
      expect(d.privacyNote.length).toBeGreaterThan(20);
    }
  });

  it("resolves and rejects keys", () => {
    expect(getDescriptor("verifalia")?.label).toBe("Verifalia");
    expect(getDescriptor("nope")).toBeUndefined();
    expect(isKnownProvider("reoon")).toBe(true);
    expect(isKnownProvider("neverbounce")).toBe(false);
  });

  it("prioritises by the recommended order, unknowns last", () => {
    expect(recommendedPriority("verifalia")).toBe(0);
    expect(recommendedPriority("reoon")).toBe(1);
    expect(recommendedPriority("mailrook")).toBe(2);
    expect(recommendedPriority("inboxtrue")).toBe(3);
    expect(recommendedPriority("check_mail")).toBe(4);
    expect(recommendedPriority("nope")).toBe(RECOMMENDED_ORDER.length);
  });
});

describe("credential completeness", () => {
  const verifalia = getDescriptor("verifalia")!;
  const reoon = getDescriptor("reoon")!;

  it("requires every declared field to be non-blank", () => {
    expect(hasCompleteCredentials(verifalia, { username: "u", password: "p" })).toBe(true);
    expect(hasCompleteCredentials(verifalia, { username: "u", password: "  " })).toBe(false);
    expect(hasCompleteCredentials(verifalia, { username: "u" })).toBe(false);
    expect(hasCompleteCredentials(verifalia, null)).toBe(false);
    expect(hasCompleteCredentials(reoon, { api_key: "k" })).toBe(true);
  });
});

describe("credential hints", () => {
  const verifalia = getDescriptor("verifalia")!;
  const reoon = getDescriptor("reoon")!;

  it("shows a text field verbatim and masks a secret to its last 4", () => {
    expect(maskCredentialHint(verifalia, { username: "ops@sed.com", password: "hunter2" })).toBe("ops@sed.com");
    expect(maskCredentialHint(reoon, { api_key: "abcdefgh1234" })).toBe("••••1234");
  });

  it("never leaks a short secret", () => {
    expect(maskCredentialHint(reoon, { api_key: "abc" })).toBe("••••");
  });

  it("returns null when nothing usable is stored", () => {
    expect(maskCredentialHint(reoon, null)).toBeNull();
    expect(maskCredentialHint(reoon, { api_key: "" })).toBeNull();
  });

  it("never returns the secret itself", () => {
    const secret = "SUPERSECRETKEY9999";
    expect(maskCredentialHint(reoon, { api_key: secret })).not.toContain("SUPERSECRET");
  });
});

describe("env seeding source", () => {
  const verifalia = getDescriptor("verifalia")!;
  const reoon = getDescriptor("reoon")!;

  it("reads the documented env vars", () => {
    expect(credentialsFromEnv(verifalia, { VERIFALIA_USERNAME: "u", VERIFALIA_PASSWORD: "p" })).toEqual({
      username: "u",
      password: "p",
    });
    expect(credentialsFromEnv(reoon, { REOON_API_KEY: " k " })).toEqual({ api_key: "k" });
  });

  it("refuses a half-filled environment rather than seeding a broken row", () => {
    expect(credentialsFromEnv(verifalia, { VERIFALIA_USERNAME: "u" })).toBeNull();
    expect(credentialsFromEnv(verifalia, { VERIFALIA_USERNAME: "u", VERIFALIA_PASSWORD: "  " })).toBeNull();
    expect(credentialsFromEnv(reoon, {})).toBeNull();
  });
});
