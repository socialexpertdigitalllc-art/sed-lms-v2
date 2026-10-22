// @vitest-environment node
import { describe, it, expect } from "vitest";
import { brandColors, colorName, logoBrief, logoTextFor, nameKey } from "@/lib/logos/brief";
import { conceptUserPrompt, fallbackConcepts, imagePrompt, IMAGE_PROMPT_MAX, parseConcepts, type LogoConcept } from "@/lib/logos/prompt";
import { editDistance, judgeSpelling, parseReading, rankScore, type RankInput } from "@/lib/logos/check";
import { imageEndpoint, imageErrorMessage, parseImageReply } from "@/lib/logos/minimaxImage";
import { ProviderHttpError } from "@/lib/ai-tools/providers/errors";
import { logoFilename } from "@/lib/logos/accept";
import { candidateView, generationView, isStale, LOGO_STALE_MS, STALE_MESSAGE, type LogoCandidate, type LogoGeneration } from "@/lib/logos/store";

/**
 * The logo generator's rules, in code: only the business name goes on the
 * logo, it is horizontal, in the lead's colours, and a misspelled design is
 * caught and sorted last.
 */

const lead = { business_name: "Garcia's Roofing & Repair LLC", services: ["Roof repair", "Gutters"], category: "Roofing", about_business: "Family-run since 1998.", color_scheme: "navy, orange, white" };
const brief = logoBrief(lead);
const concept: LogoConcept = { title: "Roof peak", idea: "A roof peak beside the name.", symbol: "a bold roof peak", typography: "heavy sans-serif capitals", layout: "icon-left", colorUse: "roof in orange, name in navy" };

describe("the words on the logo", () => {
  it("are the business name without its legal ending", () => {
    expect(logoTextFor("ABC Roofing LLC")).toBe("ABC Roofing");
    expect(logoTextFor("J&J Services, L.L.C.")).toBe("J&J Services");
    expect(logoTextFor("Acme Inc.")).toBe("Acme");
    expect(logoTextFor("Smith & Co.")).toBe("Smith & Co.");
    expect(logoTextFor("  Bright   Smile  Dental PLLC ")).toBe("Bright Smile Dental");
    expect(brief.logoText).toBe("Garcia's Roofing & Repair");
  });

  it("compare ignoring case, spacing, punctuation and accents; & = and", () => {
    expect(nameKey("Garcia's Roofing & Repair")).toBe(nameKey("GARCIAS ROOFING AND REPAIR"));
    expect(nameKey("Café Olé")).toBe("CAFEOLE");
  });

  it("a person can choose other words", () => {
    expect(logoBrief(lead, "  Garcia   Roofing ").logoText).toBe("Garcia Roofing");
  });
});

describe("the colours", () => {
  it("come from the lead, in order, named for the image model (never as hex)", () => {
    expect(brandColors("navy, orange, white")).toEqual([
      { hex: "#1e3a8a", name: "navy blue", role: "main" },
      { hex: "#ea580c", name: "bright orange", role: "accent" },
      { hex: "#ffffff", name: "white", role: "light" },
    ]);
    expect(colorName("#1f3b8c")).toBe("navy blue");
    expect(brandColors("")).toEqual([]);
    expect(brandColors("black, white").map((c) => c.role)).toEqual(["main", "light"]);
    expect(brandColors("#111111, red").map((c) => c.role)).toEqual(["dark", "main"]);
  });
});

describe("the picture prompt", () => {
  it("quotes the exact name, says horizontal + white + flat, lists what must never appear, and has no hex codes", () => {
    const p = imagePrompt(brief, concept);
    expect(p).toContain(`"Garcia's Roofing & Repair"`);
    expect(p).toMatch(/horizontal logo/);
    expect(p).toMatch(/only text in the image is the name/);
    expect(p).toMatch(/Plain pure white background/);
    expect(p).toMatch(/No tagline, slogan, phone number, email, website, address/);
    expect(p).toMatch(/navy blue and bright orange/);
    expect(p).toMatch(/to the LEFT of the name/);
    expect(p).not.toMatch(/#[0-9a-f]{6}/i);
    expect(p).not.toMatch(/Gutters|Roof repair/); // services are never sent to the picture
    expect(p.length).toBeLessThanOrEqual(IMAGE_PROMPT_MAX);
  });

  it("stays under the limit with a long concept — trimming the concept, never the rules", () => {
    const p = imagePrompt(brief, { ...concept, symbol: "x".repeat(4000) });
    expect(p.length).toBeLessThanOrEqual(IMAGE_PROMPT_MAX);
    expect(p).toMatch(/No tagline/);
    expect(p).toContain(`"Garcia's Roofing & Repair"`);
  });

  it("a second round after misspellings asks for plainer letters; a wordmark has no icon", () => {
    expect(imagePrompt(brief, concept, { strict: true })).toMatch(/every letter fully drawn/);
    expect(imagePrompt(brief, { ...concept, layout: "wordmark", symbol: "" })).toMatch(/Lettering only — no separate icon\./);
  });

  it("no colours on the lead → the concept's own palette, by name", () => {
    const b = logoBrief({ ...lead, color_scheme: null });
    expect(imagePrompt(b, { ...concept, palette: ["#15803d", "#facc15"] })).toMatch(/kelly green and golden yellow/);
  });
});

describe("the concept writer", () => {
  it("fresh designs: four different layouts, the services only as inspiration", () => {
    const p = conceptUserPrompt(brief, { mode: "new", count: 4 });
    expect(p).toMatch(/Logo text \(exactly these words, nothing else\): Garcia's Roofing & Repair/);
    expect(p).toMatch(/Services \(for inspiration only — never written on the logo\): Roof repair, Gutters/);
    expect(p).toMatch(/at least one "wordmark"/);
    expect(p).toMatch(/navy blue #1e3a8a \(main\)/);
  });

  it("the person's idea, and a change to one design (everything else kept)", () => {
    expect(conceptUserPrompt(brief, { mode: "idea", count: 4, instructions: "a shield with a hammer" })).toMatch(/The client described what they want: «a shield with a hammer»/);
    const r = conceptUserPrompt(brief, { mode: "refine", count: 1, instructions: "simpler roof", base: concept });
    expect(r).toMatch(/They want these changes: «simpler roof»/);
    expect(r).toContain(JSON.stringify(concept));
    expect(r).toMatch(/keep everything else the same/);
    expect(r).toMatch(/if they ask for extra words on the logo, leave them off/);
  });

  it("reads the reply through reasoning and fences; fixes a bad layout; keeps only hex colours", () => {
    const reply = `<think>let me think…</think>\n\`\`\`json\n${JSON.stringify({
      concepts: [
        { title: "A", idea: "i", symbol: "s", typography: "t", layout: "sideways", colorUse: "c", palette: ["#ABC", "blue", "#112233"] },
        { title: "B", idea: "i", symbol: "", typography: "t", layout: "wordmark", colorUse: "c" },
        "junk",
      ],
    })}\n\`\`\``;
    const out = parseConcepts(reply, 4);
    expect(out).toHaveLength(2);
    expect(out[0]).toMatchObject({ title: "A", layout: "icon-left", palette: ["#aabbcc", "#112233"] });
    expect(out[1]).toMatchObject({ layout: "wordmark", symbol: "" });
    expect(parseConcepts("no json here", 4)).toEqual([]);
  });

  it("when the writer is down, code writes four distinct concepts (or keeps the design being changed)", () => {
    const f = fallbackConcepts(brief, { mode: "new", count: 4 });
    expect(new Set(f.map((c) => c.layout)).size).toBe(4);
    expect(f.find((c) => c.layout === "badge-left")?.symbol).toMatch(/GR/);
    expect(fallbackConcepts(brief, { mode: "refine", count: 1, base: concept, instructions: "bigger roof" })[0]).toMatchObject({ layout: "icon-left", symbol: expect.stringMatching(/bigger roof/) });
  });
});

describe("the spelling check", () => {
  const read = (...text: string[]) => ({ text, layout: "horizontal" as const, legible: true, issues: [], quality: 8 });

  it("exact: case, spacing and line breaks don't matter; & = and", () => {
    expect(judgeSpelling(read("GARCIA'S ROOFING", "AND REPAIR"), brief.logoText).verdict).toBe("exact");
    expect(judgeSpelling(read("Garcias Roofing & Repair"), brief.logoText).verdict).toBe("exact");
  });

  it("extra words (a tagline) and misspellings are caught", () => {
    expect(judgeSpelling(read("Garcia's Roofing & Repair", "Quality you can trust"), brief.logoText)).toMatchObject({ verdict: "extra", extra: ["Quality you can trust"] });
    expect(judgeSpelling(read("GARCIA'S ROFING & REPAIR"), brief.logoText)).toMatchObject({ verdict: "misspelled", read: "GARCIA'S ROFING & REPAIR" });
    expect(judgeSpelling(read(), brief.logoText).verdict).toBe("misspelled");
    expect(judgeSpelling(null, brief.logoText).verdict).toBe("unchecked");
  });

  it("parses the proofreader's reply defensively", () => {
    expect(parseReading('<think>x</think>{"text":"ABC","layout":"stacked","legible":true,"issues":["cramped"],"quality":14}')).toEqual({ text: ["ABC"], layout: "stacked", legible: true, issues: ["cramped"], quality: 10 });
    expect(parseReading("nope")).toBeNull();
    expect(editDistance("ROOFING", "ROFING")).toBe(1);
  });

  it("ranks right spelling first, then horizontal, on-brand and good", () => {
    const base: RankInput = { spelling: "exact", quality: 7, horizontal: true, background: "removed", colorShare: 1, offPalette: 0 };
    const order = (["misspelled", "extra", "unchecked", "exact"] as const).map((s) => rankScore({ ...base, spelling: s }));
    expect(order).toEqual([...order].sort((a, b) => a - b));
    expect(rankScore(base)).toBeGreaterThan(rankScore({ ...base, horizontal: false }));
    expect(rankScore(base)).toBeGreaterThan(rankScore({ ...base, colorShare: 0, offPalette: 0.6 }));
    expect(rankScore({ ...base, spelling: "exact", quality: 3 })).toBeGreaterThan(rankScore({ ...base, spelling: "misspelled", quality: 10 }));
  });
});

describe("MiniMax image-01 replies", () => {
  it("returns the image bytes", () => {
    const b64 = Buffer.from("x".repeat(200)).toString("base64");
    expect(parseImageReply({ data: { image_base64: [b64] }, base_resp: { status_code: 0 } }, 200)[0].toString()).toBe("x".repeat(200));
  });

  it("turns MiniMax's codes into messages a salesperson can act on", () => {
    const err = (body: unknown, status = 200) => {
      try {
        parseImageReply(body, status);
      } catch (e) {
        return e as ProviderHttpError;
      }
      throw new Error("no error");
    };
    expect(err({ base_resp: { status_code: 1008, status_msg: "insufficient balance" } })).toMatchObject({ status: 402, message: expect.stringMatching(/no image allowance left/) });
    expect(err({ base_resp: { status_code: 1026, status_msg: "sensitive" } })).toMatchObject({ status: 400, message: expect.stringMatching(/flagged the request as sensitive/) });
    expect(err({ base_resp: { status_code: 1002 } }).status).toBe(429);
    expect(err({ base_resp: { status_code: 2049 } }).message).toMatch(/Admin → AI providers/);
    expect(err({ data: { image_base64: [] }, metadata: { failed_count: "1" }, base_resp: { status_code: 0 } }).message).toMatch(/safety filter/);
    expect(err({ data: {}, base_resp: { status_code: 0 } }).status).toBe(502);
    expect(err(null, 503).status).toBe(503);
    expect(imageErrorMessage(500, "")).toMatch(/HTTP 500/);
  });

  it("is called on the provider's own host", () => {
    expect(imageEndpoint({ endpoint: "https://api.minimax.io/v1/chat/completions" })).toBe("https://api.minimax.io/v1/image_generation");
  });
});

describe("what the lead page is sent", () => {
  const cand = (over: Partial<LogoCandidate>): LogoCandidate => ({
    index: 0, concept: 0, seed: 1, round: 1, prompt: "secret-ish prompt", path: "lead-logos/L/G/1.png", url: "https://cdn/1.png", width: 900, height: 300, aspect: 3, horizontal: true, transparent: true, background: "removed",
    colors: { present: [], missing: [], offPalette: 0, dominant: [] }, check: null, score: 50, ...over,
  });
  const row = (over: Partial<LogoGeneration> = {}): LogoGeneration => ({
    id: "G", lead_id: "L", user_id: "U", mode: "new", parent_id: null, parent_index: null, instructions: null, logo_text: "ABC", status: "ready", stage: null, concepts: [], notes: [],
    candidates: [cand({ index: 0, score: 40 }), cand({ index: 1, score: 140 })], error: null, accepted_index: null, accepted_url: null, accepted_at: null,
    heartbeat_at: "2026-10-22T10:00:00Z", finished_at: null, created_at: "2026-10-22T10:00:00Z", updated_at: "2026-10-22T10:00:00Z", ...over,
  });

  it("best design first, no storage paths or prompts", () => {
    const v = generationView(row());
    expect(v.candidates.map((c) => c.index)).toEqual([1, 0]);
    expect(v.candidates[0]).not.toHaveProperty("path");
    expect(v.candidates[0]).not.toHaveProperty("prompt");
    expect(candidateView(cand({}))).toHaveProperty("url", "https://cdn/1.png");
  });

  it("a run that stopped sending heartbeats shows as failed", () => {
    const at = Date.parse("2026-10-22T10:00:00Z");
    const running = row({ status: "running", stage: "drawing" });
    expect(isStale(running, at + LOGO_STALE_MS - 1)).toBe(false);
    expect(generationView(running, at + LOGO_STALE_MS + 1)).toMatchObject({ status: "failed", stage: null, error: STALE_MESSAGE });
  });

  it("the accepted file is named after the business", () => {
    expect(logoFilename("Garcia's Roofing & Repair LLC")).toBe("garcia-s-roofing-repair-llc-logo.png");
    expect(logoFilename("!!!")).toBe("business-logo.png");
  });
});
