import { describe, it, expect } from "vitest";
import { renderTemplate, listTemplateVars } from "@/lib/ai-tools/template";

describe("renderTemplate", () => {
  it("substitutes a present value", () => {
    expect(renderTemplate("Hi {{name}}", { name: "Acme" })).toBe("Hi Acme");
  });
  it("uses inline fallback when the value is empty or missing", () => {
    expect(renderTemplate("{{name|(none)}}", { name: "" })).toBe("(none)");
    expect(renderTemplate("{{name|(none)}}", {})).toBe("(none)");
  });
  it("prefers the value over the fallback when present", () => {
    expect(renderTemplate("{{name|(none)}}", { name: "Acme" })).toBe("Acme");
  });
  it("renders empty for a missing key with no fallback", () => {
    expect(renderTemplate("[{{x}}]", {})).toBe("[]");
  });
  it("replaces every occurrence", () => {
    expect(renderTemplate("{{p}}/{{p}}", { p: "2" })).toBe("2/2");
  });
  it("keeps only the part before the first pipe as the key", () => {
    expect(renderTemplate("{{a|x|y}}", {})).toBe("x|y");
  });
  it("leaves text without placeholders untouched (incl. CSS braces)", () => {
    expect(renderTemplate(":root { --x: 1 }", {})).toBe(":root { --x: 1 }");
  });
});

describe("listTemplateVars", () => {
  it("returns the unique set of placeholder keys", () => {
    expect(listTemplateVars("{{a}} {{b|f}} {{a}}").sort()).toEqual(["a", "b"]);
  });
  it("returns an empty array when there are no placeholders", () => {
    expect(listTemplateVars("plain text { css }")).toEqual([]);
  });
  it("trims whitespace inside the braces", () => {
    expect(listTemplateVars("{{  spaced  }}")).toEqual(["spaced"]);
  });
});
