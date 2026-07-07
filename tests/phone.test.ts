import { describe, it, expect } from "vitest";
import { formatPhone, PHONE_RE } from "@/lib/forms/phone";

describe("formatPhone", () => {
  it("masks progressively", () => {
    expect(formatPhone("2")).toBe("(2");
    expect(formatPhone("252401")).toBe("(252) 401");
    expect(formatPhone("2524012775")).toBe("(252) 401-2775");
  });
  it("strips non-digits and caps at 10", () => {
    expect(formatPhone("(252) 401-2775 ext 9")).toBe("(252) 401-2775");
    expect(formatPhone("abc")).toBe("");
  });
  it("PHONE_RE matches the exact format", () => {
    expect(PHONE_RE.test("(252) 401-2775")).toBe(true);
    expect(PHONE_RE.test("252-401-2775")).toBe(false);
  });
});
