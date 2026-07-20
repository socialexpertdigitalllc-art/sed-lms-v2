import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { VISION_SYSTEM, visionPrompt, parseVisionVerdicts, rankImages } from "@/lib/template-engine/vision";
import { callForTask } from "@/lib/ai-tools/providers/run";

// The vision step routes through the per-task model router now; the network
// call itself is what we stub, exactly as before.
vi.mock("@/lib/ai-tools/providers/run", () => ({
  callForTask: vi.fn(),
}));

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

describe("parseVisionVerdicts — truncation salvage", () => {
  const conservative = { people: true, relevance: 0, quality: 0, reason: "unreadable" };

  it("keeps the complete leading verdicts of a truncated array and pads the rest conservative", () => {
    // The real 2026-07-16 failure: gemini-3.5-flash hit max_tokens mid-array
    // (thinking tokens ate the budget), returning 200 + a cut-off JSON array.
    // The complete leading verdicts are independently safe — losing ALL 12
    // because verdict #5 was cut is what emptied whole image slots.
    const truncated =
      '[{"people":false,"relevance":0.9,"quality":0.8,"reason":"clean roof shot"},' +
      '{"people":true,"relevance":0.5,"quality":0.7,"reason":"crew visible"},' +
      '{"people":false,"relevance":0.7,"qual';
    const out = parseVisionVerdicts(truncated, 4);
    expect(out).toEqual([
      { people: false, relevance: 0.9, quality: 0.8, reason: "clean roof shot" },
      { people: true, relevance: 0.5, quality: 0.7, reason: "crew visible" },
      conservative,
      conservative,
    ]);
  });

  it("salvages a truncated array inside an unterminated ```json fence", () => {
    const fenced = '```json\n[{"people":false,"relevance":1,"quality":1,"reason":"ok"},{"people":fa';
    const out = parseVisionVerdicts(fenced, 2);
    expect(out).toEqual([{ people: false, relevance: 1, quality: 1, reason: "ok" }, conservative]);
  });
});

describe("rankImages", () => {
  const brief = { query: "new roof", kind: "service", businessType: "General Contractor" };
  const mockCall = vi.mocked(callForTask);
  const goodVerdicts = (n: number) =>
    JSON.stringify(
      Array.from({ length: n }, (_, i) => ({
        people: false,
        relevance: 0.9,
        quality: 0.8,
        reason: `photo ${i} fine`,
      })),
    );
  const answer = (text: string) => ({ text, tokens: 100, providerKey: "gemini", model: "gemini-3.5-flash" });
  let errSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    mockCall.mockReset();
    errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
  });
  afterEach(() => {
    errSpy.mockRestore();
  });

  it("gives the vision call enough output budget for thinking tokens (>= 8000)", async () => {
    mockCall.mockResolvedValue(answer(goodVerdicts(2)));
    await rankImages([{ url: "a" }, { url: "b" }], brief);
    expect(mockCall).toHaveBeenCalledTimes(1);
    const opts = mockCall.mock.calls[0][3];
    // 2000 was eaten almost entirely by gemini-3.5-flash's hidden thinking
    // tokens (~1600-1800/call), truncating the verdicts JSON.
    expect(opts.maxTokens).toBeGreaterThanOrEqual(8000);
  });

  it("retries a chunk whose response was fully unreadable and uses the retry's verdicts", async () => {
    mockCall
      .mockResolvedValueOnce(answer("totally not json"))
      .mockResolvedValueOnce(answer(goodVerdicts(2)));
    const out = await rankImages([{ url: "a" }, { url: "b" }], brief);
    expect(mockCall).toHaveBeenCalledTimes(2);
    expect(out).toEqual([
      { people: false, relevance: 0.9, quality: 0.8, reason: "photo 0 fine" },
      { people: false, relevance: 0.9, quality: 0.8, reason: "photo 1 fine" },
    ]);
  });

  it("retries when the provider throws, then succeeds", async () => {
    mockCall
      .mockRejectedValueOnce(new Error("HTTP 429"))
      .mockResolvedValueOnce(answer(goodVerdicts(1)));
    const out = await rankImages([{ url: "a" }], brief);
    expect(mockCall).toHaveBeenCalledTimes(2);
    expect(out).toEqual([{ people: false, relevance: 0.9, quality: 0.8, reason: "photo 0 fine" }]);
  });

  it("does NOT retry a chunk that salvaged some real verdicts", async () => {
    // Partial salvage means the call fundamentally worked; a retry would just
    // burn quota. The missing tail stays conservative (dropped upstream).
    const truncated = '[{"people":false,"relevance":0.9,"quality":0.8,"reason":"ok"},{"people":fa';
    mockCall.mockResolvedValue(answer(truncated));
    const out = await rankImages([{ url: "a" }, { url: "b" }], brief);
    expect(mockCall).toHaveBeenCalledTimes(1);
    expect(out[0]).toEqual({ people: false, relevance: 0.9, quality: 0.8, reason: "ok" });
    expect(out[1]).toEqual({ people: true, relevance: 0, quality: 0, reason: "unreadable" });
  });

  it("settles on all-conservative verdicts and logs loudly after every attempt fails", async () => {
    mockCall.mockResolvedValue(answer("garbage every time"));
    const out = await rankImages([{ url: "a" }, { url: "b" }], brief);
    expect(mockCall.mock.calls.length).toBeGreaterThanOrEqual(2); // must have retried
    expect(out).toEqual([
      { people: true, relevance: 0, quality: 0, reason: "unreadable" },
      { people: true, relevance: 0, quality: 0, reason: "unreadable" },
    ]);
    expect(errSpy).toHaveBeenCalled(); // silent-empty slots are how this bug shipped
  });

  it("returns [] for no candidates without calling the provider", async () => {
    const out = await rankImages([], brief);
    expect(out).toEqual([]);
    expect(mockCall).not.toHaveBeenCalled();
  });
});
