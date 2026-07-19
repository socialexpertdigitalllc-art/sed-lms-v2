import { describe, it, expect } from "vitest";
import { formatAddress, formatAddressList, makePreview, hasAttachments, normalizeFolder } from "@/lib/mail/message";

describe("formatAddress / formatAddressList", () => {
  it("renders 'Name <email>' when a name is present", () => {
    expect(formatAddress({ name: "Jane Doe", address: "jane@x.test" })).toBe("Jane Doe <jane@x.test>");
  });
  it("falls back to the bare address when there's no name", () => {
    expect(formatAddress({ address: "jane@x.test" })).toBe("jane@x.test");
  });
  it("returns '' for missing/addressless input", () => {
    expect(formatAddress(undefined)).toBe("");
    expect(formatAddress({ name: "Nobody" })).toBe("");
  });
  it("joins a list with commas, dropping empties", () => {
    expect(formatAddressList([{ name: "A", address: "a@x.test" }, { address: "b@x.test" }])).toBe("A <a@x.test>, b@x.test");
    expect(formatAddressList([])).toBe("");
    expect(formatAddressList(undefined)).toBe("");
  });
});

describe("makePreview", () => {
  it("collapses whitespace and trims", () => {
    expect(makePreview("  hello\n\t world  ")).toBe("hello world");
  });
  it("truncates with an ellipsis past the limit", () => {
    expect(makePreview("abcdefghij", 5)).toBe("abcd…");
  });
  it("returns '' for empty input", () => {
    expect(makePreview("")).toBe("");
    expect(makePreview(null)).toBe("");
  });
});

describe("hasAttachments", () => {
  it("detects a node disposed as attachment", () => {
    expect(hasAttachments({ childNodes: [{ type: "text/plain" }, { disposition: "attachment", type: "application/pdf" }] })).toBe(true);
  });
  it("is false for a plain text-only structure", () => {
    expect(hasAttachments({ type: "text/plain" })).toBe(false);
  });
  it("is false for null", () => {
    expect(hasAttachments(null)).toBe(false);
  });
});

describe("normalizeFolder", () => {
  it("maps 'sent' (any case) to Sent", () => {
    expect(normalizeFolder("Sent")).toBe("Sent");
    expect(normalizeFolder("SENT")).toBe("Sent");
  });
  it("defaults everything else to INBOX", () => {
    expect(normalizeFolder("INBOX")).toBe("INBOX");
    expect(normalizeFolder("Junk")).toBe("INBOX");
    expect(normalizeFolder(undefined)).toBe("INBOX");
  });
});
