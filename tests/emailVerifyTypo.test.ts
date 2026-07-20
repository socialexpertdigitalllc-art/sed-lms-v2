// @vitest-environment node
import { describe, it, expect } from "vitest";
import { suggestDomain, suggestEmail, editDistance } from "@/lib/email-verify/typo";

describe("email-verify typo suggestions", () => {
  it("corrects common domain-name misspellings", () => {
    expect(suggestDomain("gmial.com")).toBe("gmail.com");
    expect(suggestDomain("gmai.com")).toBe("gmail.com");
    expect(suggestDomain("hotmial.com")).toBe("hotmail.com");
    expect(suggestDomain("outlok.com")).toBe("outlook.com");
    expect(suggestDomain("yaho.com")).toBe("yahoo.com");
  });

  it("weights the TLD separately from the domain name", () => {
    // correct name, broken TLD
    expect(suggestDomain("gmail.con")).toBe("gmail.com");
    expect(suggestDomain("example.con")).toBe("example.com");
    expect(suggestDomain("company.cm")).toBe("company.com");
    // both broken at once
    expect(suggestDomain("gmial.con")).toBe("gmail.com");
  });

  it("treats .co as a truncated .com only for well-known free-mail domains", () => {
    expect(suggestDomain("gmail.co")).toBe("gmail.com");
    expect(suggestDomain("yahoo.co")).toBe("yahoo.com");
    // .co is a real ccTLD — do not mangle a legitimate company domain
    expect(suggestDomain("acmestartup.co")).toBeNull();
    // .co.uk is not a .co TLD at all
    expect(suggestDomain("example.co.uk")).toBeNull();
    expect(suggestDomain("yahoo.co.uk")).toBeNull();
  });

  it("returns null for correct domains", () => {
    for (const d of ["gmail.com", "example.com", "outlook.com", "sed-lms.io", "icloud.com"]) {
      expect(suggestDomain(d)).toBeNull();
    }
  });

  it("does not 'correct' real domains that sit one edit from a popular one", () => {
    expect(suggestDomain("mail.com")).toBeNull();
    expect(suggestDomain("email.com")).toBeNull();
    expect(suggestDomain("gmx.com")).toBeNull();
  });

  it("suggests a full address without touching the local part", () => {
    expect(suggestEmail("John.Doe@gmial.com")).toBe("John.Doe@gmail.com");
    expect(suggestEmail("John.Doe@gmail.com")).toBeNull();
  });

  it("never returns a suggestion for an unparseable input", () => {
    expect(suggestEmail("not-an-email")).toBeNull();
    expect(suggestEmail("@gmial.com")).toBeNull();
    expect(suggestEmail("user@")).toBeNull();
    expect(suggestDomain("")).toBeNull();
    expect(suggestDomain("nodot")).toBeNull();
  });

  it("computes an optimal-string-alignment distance including transpositions", () => {
    expect(editDistance("gmail", "gmail")).toBe(0);
    expect(editDistance("gmial", "gmail")).toBe(1); // transposition
    expect(editDistance("gmai", "gmail")).toBe(1); // deletion
    expect(editDistance("gmaill", "gmail")).toBe(1); // insertion
    expect(editDistance("yahoo", "gmail")).toBe(5);
  });
});
