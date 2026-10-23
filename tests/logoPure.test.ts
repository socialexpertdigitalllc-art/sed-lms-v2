// @vitest-environment node
import { describe, it, expect } from "vitest";
import { brandColors, colorName, logoBrief, logoTextFor, nameKey } from "@/lib/logos/brief";
import { CONCEPT_SYSTEM, conceptUserPrompt, fallbackConcepts, iconPrompt, IMAGE_PROMPT_MAX, linesFrom, normalizeConcept, parseConceptReply, snapColor, splitName, type LogoConcept } from "@/lib/logos/prompt";
import { designScore, parseIconReading } from "@/lib/logos/check";
import { wantsNewIcon } from "@/lib/logos/runner";
import { imageEndpoint, imageErrorMessage, parseImageReply } from "@/lib/logos/minimaxImage";
import { ProviderHttpError } from "@/lib/ai-tools/providers/errors";
import { logoFilename } from "@/lib/logos/accept";
import { candidateView, generationView, isStale, LOGO_STALE_MS, STALE_MESSAGE, type LogoCandidate, type LogoGeneration } from "@/lib/logos/store";

/**
 * The logo generator's rules, in code: only the business name goes on the
 * logo — typeset by us, so never misspelled — the image model draws only the
 * symbol (never any text), and the designs are horizontal, in the lead's colours.
 */

const lead = { business_name: "Garcia's Roofing & Repair LLC", services: ["Roof repair", "Gutters"], category: "Roofing", about_business: "Family-run since 1998.", color_scheme: "navy, orange, white" };
const brief = logoBrief(lead);
const concept: LogoConcept = {
  title: "Roof peak", idea: "A roof peak beside the name.", layout: "icon-left", symbol: "a bold roof peak", badge: "circle", font: "montserrat", letterCase: "upper",
  lines: ["Garcia's Roofing & Repair"], tracking: 0.03, nameColor: "#1e3a8a", subColor: "#ea580c", twoTone: false, iconColors: "orange roof, navy base", iconScale: 1,
};

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

describe("the symbol prompt (the image model draws ONLY the symbol)", () => {
  it("describes the symbol in the brand colours, never the name, never hex, and forbids any text", () => {
    const p = iconPrompt(brief, concept);
    expect(p).toMatch(/A single flat vector logo symbol for a roofing business: a bold roof peak\./);
    expect(p).toMatch(/Colours: orange roof, navy base\./);
    expect(p).toMatch(/Absolutely no text of any kind: no letters, no words, no numbers, no initials/);
    expect(p).toMatch(/Plain pure white background/);
    expect(p).not.toMatch(/Garcia/i); // the name is never sent to the picture — so it can't be drawn wrong
    expect(p).not.toMatch(/#[0-9a-f]{6}/i);
    expect(p).not.toMatch(/Gutters|Roof repair/);
    expect(p.length).toBeLessThanOrEqual(IMAGE_PROMPT_MAX);
  });

  it("stays under the limit with a long symbol; a redraw asks even harder for no writing", () => {
    const p = iconPrompt(brief, { ...concept, symbol: "x".repeat(4000) });
    expect(p.length).toBeLessThanOrEqual(IMAGE_PROMPT_MAX);
    expect(p).toMatch(/Absolutely no text/);
    expect(iconPrompt(brief, concept, { strict: true })).toMatch(/nothing that looks like writing/);
  });
});

describe("the concept writer", () => {
  it("fresh designs: the name is typeset in a font from our list; the symbol is a picture without letters", () => {
    const p = conceptUserPrompt(brief, { mode: "new", count: 4 });
    expect(p).toMatch(/Logo text \(exactly these words, nothing else\): Garcia's Roofing & Repair/);
    expect(p).toMatch(/Services \(for inspiration only — never written on the logo\): Roof repair, Gutters/);
    expect(p).toMatch(/- "montserrat": modern geometric sans/);
    expect(p).toMatch(/"bebas": .*\(capitals only\)/);
    expect(p).toMatch(/NO letters or numbers/);
    expect(p).toMatch(/navy blue #1e3a8a \(main\)/);
    expect(CONCEPT_SYSTEM).toMatch(/TYPESETS the business name in a real font/);
  });

  it("a change to one design: the change applied, everything else kept, and keep-or-redraw the symbol", () => {
    const r = conceptUserPrompt(brief, { mode: "refine", count: 4, instructions: "bolder name", base: concept, baseHasIcon: true });
    expect(r).toMatch(/They want these changes: «bolder name»/);
    expect(r).toContain(JSON.stringify(concept));
    expect(r).toMatch(/"icon": "keep" when the change is about the lettering/);
    expect(r).toMatch(/\{"icon": "keep" \| "redraw", "concepts"/);
    expect(conceptUserPrompt(brief, { mode: "refine", count: 4, instructions: "x", base: concept, baseHasIcon: false })).toMatch(/no reusable symbol/);
    expect(conceptUserPrompt(brief, { mode: "idea", count: 4, instructions: "a shield", font: "lora" })).toMatch(/Use the font "lora" in every version/);
  });

  it("reads the reply safely: known fonts/layouts/cases, colours snapped to the brand, the name's own spelling", () => {
    const reply = `<think>…</think>\n\`\`\`json\n${JSON.stringify({
      icon: "keep",
      concepts: [
        { title: "A", layout: "icon-left", symbol: "a roof", font: "Playfair Display", case: "title", lines: ["GARCIA'S", "ROOFING & REPAIR"], nameColor: "#203b8a", subColor: "#f0600f", tracking: 0.9 },
        { title: "B", layout: "icon-left", symbol: "", font: "comic sans", lines: ["Garcias Roofing & Repair"], badge: "star" },
        { title: "C", layout: "wordmark", font: "bebas", case: "title", lines: ["Garcia's Roofing and Repair"], nameColor: "#ffff00" },
        { title: "D", layout: "integrated", symbol: "a hammer", font: "pacifico", tracking: 0.2, lines: ["Garcia's Roofing & Repair"] },
        "junk",
      ],
    })}\n\`\`\``;
    const { concepts: out, icon } = parseConceptReply(reply, 4, brief);
    expect(icon).toBe("keep");
    expect(out).toHaveLength(4);
    // the split is kept, but the letters are re-cut from the name as typed (the model's capitals don't leak in)
    expect(out[0]).toMatchObject({ font: "playfair", layout: "icon-left", lines: ["Garcia's", "Roofing & Repair"], nameColor: "#1e3a8a", subColor: "#ea580c", tracking: 0.3 });
    // a symbol-less icon layout becomes a badge; an unknown font, the default; a misspelt line, the name as typed
    expect(out[1]).toMatchObject({ layout: "badge-left", font: "montserrat", lines: ["Garcia's Roofing & Repair"], badge: "circle" });
    // "and" for "&" is a different text → the typed name; a capitals-only font sets capitals
    expect(out[2]).toMatchObject({ layout: "wordmark", font: "bebas", letterCase: "upper", lines: ["Garcia's Roofing & Repair"] });
    // "integrated" is drawn as a symbol beside the name; a script font is never letter-spaced
    expect(out[3]).toMatchObject({ layout: "icon-left", symbol: "a hammer", font: "pacifico", tracking: 0 });
    expect(parseConceptReply("no json here", 4, brief)).toEqual({ concepts: [], icon: null });
  });

  it("lines: re-cut from the typed name, or nothing when they don't spell it", () => {
    expect(linesFrom(["GARCIA'S ROOFING", "& REPAIR"], "Garcia's Roofing & Repair")).toEqual(["Garcia's Roofing", "& Repair"]);
    expect(linesFrom(["GARCIA'S  ROOFING & REPAIR "], "Garcia's Roofing & Repair")).toEqual(["Garcia's Roofing & Repair"]);
    expect(linesFrom(["Garcias Roofing & Repair"], "Garcia's Roofing & Repair")).toBeNull();
    expect(linesFrom(["a", "b", "c"], "a b c")).toBeNull();
    expect(splitName("Garcia's Roofing & Repair")).toEqual(["Garcia's", "Roofing & Repair"]);
    expect(splitName("AJ Pro Plumbing")).toEqual(["AJ Pro", "Plumbing"]);
    expect(splitName("Zenith")).toBeNull();
    expect(snapColor("#ff0000", ["#1e3a8a", "#ea580c"], "#111")).toBe("#ea580c");
    expect(snapColor("teal", [], "#111")).toBe("#111");
  });

  it("when the writer is down, code designs four (a picked font in all); a change keeps the design", () => {
    const f = fallbackConcepts(brief, { mode: "new", count: 4 });
    expect(f.map((c) => c.layout)).toEqual(["icon-left", "badge-left", "wordmark", "icon-left"]);
    expect(new Set(f.map((c) => c.font)).size).toBe(4);
    expect(f.every((c) => c.lines.join(" ") === "Garcia's Roofing & Repair")).toBe(true);
    expect(fallbackConcepts(brief, { mode: "new", count: 4, font: "lora" }).every((c) => c.font === "lora")).toBe(true);
    const base = normalizeConcept({ layout: "icon-left", symbol: "roof", font: "oswald", case: "upper", lines: ["Garcia's Roofing & Repair"] }, brief);
    const r = fallbackConcepts(brief, { mode: "refine", count: 4, base, instructions: "x" });
    expect(r[0]).toEqual(base);
    expect(r.every((c) => c.symbol === "roof" && c.font === "oswald")).toBe(true);
  });
});

describe("the symbol check", () => {
  it("reads the checker's reply defensively", () => {
    expect(parseIconReading('<think>x</think>{"text":true,"clean":false,"issues":["letters"],"quality":14}')).toEqual({ text: true, clean: false, issues: ["letters"], quality: 10 });
    expect(parseIconReading("nope")).toBeNull();
  });

  it("ranks clean, good symbols first; writing in a symbol sorts last", () => {
    const good = designScore({ hasIcon: true, check: { text: false, clean: true, issues: [], quality: 8 } });
    const unchecked = designScore({ hasIcon: true, check: null });
    const scribbled = designScore({ hasIcon: true, check: { text: true, clean: true, issues: [], quality: 9 } });
    const badge = designScore({ hasIcon: false, check: null });
    expect(good).toBeGreaterThan(unchecked);
    expect(unchecked).toBeGreaterThan(badge);
    expect(badge).toBeGreaterThan(scribbled);
  });

  it("without the writer saying, only a change to the symbol's look redraws it", () => {
    expect(wantsNewIcon("make the name bolder")).toBe(false);
    expect(wantsNewIcon("bigger icon")).toBe(false);
    expect(wantsNewIcon("a different icon, maybe a hammer")).toBe(true);
    expect(wantsNewIcon("simpler symbol")).toBe(true);
    expect(wantsNewIcon(null)).toBe(false);
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
