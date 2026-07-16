import { describe, it, expect } from "vitest";
import { VISION_SYSTEM, visionPrompt, parseVisionVerdicts } from "@/lib/template-engine/vision";

describe("visionPrompt", () => {
  const brief = { query: "modern kitchen remodel", kind: "hero", businessType: "kitchen remodeling" };

  it("names the business type, section kind, and search query", () => {
    const p = visionPrompt(brief);
    expect(p).toContain("kitchen remodeling");
    expect(p).toContain("hero");
    expect(p).toContain("modern kitchen remodel");
  });

  it("specifies the exact JSON verdict contract", () => {
    const p = visionPrompt(brief);
    expect(p).toContain("people");
    expect(p).toContain("relevance");
    expect(p).toContain("quality");
    expect(p).toContain("reason");
    expect(p.toLowerCase()).toContain("json array");
  });

  it("instructs a conservative, any-body-part people rule", () => {
    const p = visionPrompt(brief).toLowerCase();
    expect(p).toMatch(/hand|arm|face|body part/);
  });

  it("is deterministic for the same brief", () => {
    expect(visionPrompt(brief)).toBe(visionPrompt({ ...brief }));
  });
});

describe("VISION_SYSTEM", () => {
  it("is a non-empty system instruction", () => {
    expect(typeof VISION_SYSTEM).toBe("string");
    expect(VISION_SYSTEM.length).toBeGreaterThan(20);
  });
});

describe("parseVisionVerdicts", () => {
  const good = [
    { people: false, relevance: 0.9, quality: 0.8, reason: "clean paintbrush shot" },
    { people: true, relevance: 0.5, quality: 0.7, reason: "shows a hand" },
  ];
  const conservative = { people: true, relevance: 0, quality: 0, reason: "unreadable" };

  it("parses a well-formed JSON array as-is", () => {
    expect(parseVisionVerdicts(JSON.stringify(good), 2)).toEqual(good);
  });

  it("parses Gemini-style fenced JSON", () => {
    const fenced = "```json\n" + JSON.stringify(good) + "\n```";
    expect(parseVisionVerdicts(fenced, 2)).toEqual(good);
  });

  it("pads a short array with conservative defaults for the missing entries", () => {
    const short = [good[0]];
    const out = parseVisionVerdicts(JSON.stringify(short), 3);
    expect(out).toEqual([good[0], conservative, conservative]);
  });

  it("replaces a malformed entry with the conservative default while keeping valid siblings", () => {
    const mixed = [good[0], { people: "yes", relevance: 0.9, quality: 0.9 }, good[1]];
    const out = parseVisionVerdicts(JSON.stringify(mixed), 3);
    expect(out).toEqual([good[0], conservative, good[1]]);
  });

  it("truncates an over-long array to exactly n", () => {
    const long = [good[0], good[1], good[0]];
    expect(parseVisionVerdicts(JSON.stringify(long), 2)).toEqual([good[0], good[1]]);
  });

  it("returns all-conservative verdicts for unparseable garbage", () => {
    const out = parseVisionVerdicts("not json at all, sorry about that", 2);
    expect(out).toEqual([conservative, conservative]);
  });
});
