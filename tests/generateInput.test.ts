import { describe, it, expect } from "vitest";
import { generateInputSchema } from "@/lib/template-engine/generateInput";

const base = {
  leadId: "e721febb-8a30-441e-bae0-6835af74d5fd",
  templateId: "c2d638ea-cdd6-4e80-aa80-c89cef2898c7",
  pages: ["index.html"],
};

describe("generateInputSchema", () => {
  it("defaults tool/model to the v2 gemini pipeline when omitted", () => {
    const out = generateInputSchema.parse(base);
    expect(out.tool).toBe("gemini");
    expect(out.model).toBe("gemini-3.1-pro-preview");
  });
  it("defaults options.exclude_people to true", () => {
    expect(generateInputSchema.parse(base).options.exclude_people).toBe(true);
  });
  it("accepts an explicit exclude_people=false", () => {
    const out = generateInputSchema.parse({ ...base, options: { exclude_people: false } });
    expect(out.options.exclude_people).toBe(false);
  });
  it("still accepts explicit v1 tool/model (back-compat)", () => {
    const out = generateInputSchema.parse({ ...base, tool: "webcraft", model: "moonshot-v1-128k" });
    expect(out.tool).toBe("webcraft");
  });
  it("rejects a non-uuid lead, empty pages, empty page string", () => {
    expect(generateInputSchema.safeParse({ ...base, leadId: "nope" }).success).toBe(false);
    expect(generateInputSchema.safeParse({ ...base, pages: [] }).success).toBe(false);
    expect(generateInputSchema.safeParse({ ...base, pages: [""] }).success).toBe(false);
  });
});
