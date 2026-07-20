// @vitest-environment node
import { describe, it, expect } from "vitest";
import { parseEmail, isValidSyntax, normalizeEmail } from "@/lib/email-verify/syntax";

describe("email-verify syntax", () => {
  it("accepts ordinary addresses", () => {
    for (const e of ["a@b.co", "john.doe@example.com", "j+tag@sub.example.co.uk", "x!#$%&'*+-/=?^_`{|}~@ex.io"]) {
      expect(isValidSyntax(e)).toBe(true);
    }
  });

  it("requires exactly one @", () => {
    expect(parseEmail("noatsign.com").reasons).toContain("syntax_at_count");
    expect(parseEmail("a@b@c.com").reasons).toContain("syntax_at_count");
    expect(parseEmail("@example.com").reasons).toContain("syntax_local_empty");
    expect(parseEmail("user@").reasons).toContain("syntax_domain_empty");
  });

  it("rejects an empty input", () => {
    expect(parseEmail("").reasons).toEqual(["syntax_empty"]);
    expect(parseEmail("   ").reasons).toEqual(["syntax_empty"]);
  });

  it("enforces the 64-octet local-part limit in OCTETS, not characters", () => {
    expect(isValidSyntax(`${"a".repeat(64)}@example.com`)).toBe(true);
    expect(parseEmail(`${"a".repeat(65)}@example.com`).reasons).toContain("syntax_local_too_long");
    // 33 two-byte characters = 66 octets, but only 33 JS characters.
    expect(parseEmail(`${"é".repeat(33)}@example.com`).reasons).toContain("syntax_local_too_long");
  });

  it("enforces the 254-octet whole-address limit (RFC 3696 errata)", () => {
    // 64 local + "@" + 189 domain = 254 octets exactly (labels stay <= 63).
    const domain = `${"d".repeat(63)}.${"d".repeat(60)}.${"d".repeat(60)}.com`;
    expect(domain.length).toBe(189);
    expect(isValidSyntax(`${"a".repeat(64)}@${domain}`)).toBe(true);
    const tooLong = `${"a".repeat(64)}@${"d".repeat(63)}.${"d".repeat(61)}.${"d".repeat(60)}.com`;
    expect(tooLong.length).toBe(255);
    expect(parseEmail(tooLong).reasons).toContain("syntax_too_long");
  });

  it("requires at least one dot in the domain", () => {
    expect(parseEmail("user@localhost").reasons).toContain("syntax_domain_no_dot");
    expect(isValidSyntax("user@localhost.dev")).toBe(true);
  });

  it("rejects leading, trailing and consecutive dots in the local part", () => {
    expect(parseEmail(".user@example.com").reasons).toContain("syntax_local_dot");
    expect(parseEmail("user.@example.com").reasons).toContain("syntax_local_dot");
    expect(parseEmail("us..er@example.com").reasons).toContain("syntax_local_dot");
    expect(isValidSyntax("u.s.e.r@example.com")).toBe(true);
  });

  it("rejects malformed domain labels", () => {
    expect(parseEmail("user@-bad.com").reasons).toContain("syntax_domain_label");
    expect(parseEmail("user@bad-.com").reasons).toContain("syntax_domain_label");
    expect(parseEmail("user@ex..com").reasons).toContain("syntax_domain_label");
    expect(parseEmail("user@1.2.3.4").reasons).toContain("syntax_domain_label");
  });

  it("rejects spaces and unquoted specials in the local part", () => {
    expect(parseEmail("us er@example.com").reasons).toContain("syntax_local_charset");
    expect(parseEmail('"quoted"@example.com').reasons).toContain("syntax_local_charset");
  });

  it("lowercases the DOMAIN ONLY — local-parts may be case-sensitive", () => {
    const r = parseEmail("John.Doe@EXAMPLE.COM");
    expect(r.localPart).toBe("John.Doe");
    expect(r.domain).toBe("example.com");
    expect(r.normalized).toBe("John.Doe@example.com");
  });

  it("trims whitespace and angle brackets", () => {
    expect(normalizeEmail("  <A@Example.com>  ")).toBe("A@example.com");
  });

  it("returns an empty normalized value for an invalid address", () => {
    expect(normalizeEmail("nope")).toBe("");
  });
});
