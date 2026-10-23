// @vitest-environment node
import { describe, it, expect, vi } from "vitest";
import { memorySupabase } from "./helpers/memorySupabase";
import { pickEngine, runLogoGeneration, type LogoRunnerDeps } from "@/lib/logos/runner";
import { defaultEngine } from "@/lib/logos/deps";
import { logoBrief } from "@/lib/logos/brief";
import { artConceptPrompt, artImagePrompt, ART_CONCEPT_SYSTEM, fallbackArtConcepts, fixLetteringPrompt, parseArtConcepts, refineArtPrompt } from "@/lib/logos/artPrompt";
import { artScore, judgeSpelling } from "@/lib/logos/check";
import type { CleanLogo } from "@/lib/logos/cleanup";
import { LOGO_TABLE, type LogoGeneration } from "@/lib/logos/store";

/**
 * Google designs COMPLETE logos (graphic and name) from agency-grade briefs.
 * Each one is read back letter by letter; a misspelled one goes back to Google
 * to fix the lettering. Changing a design EDITS that very picture. If Google
 * can't design at all, MiniMax makes the round instead.
 */

const lead = { business_name: "Garcia's Roofing & Repair LLC", services: ["Roof repair", "Gutters"], category: "Roofing", about_business: null, color_scheme: "navy, orange, white" };
const brief = logoBrief(lead);

describe("the art direction", () => {
  it("briefs a creative director: agency quality, no clip-art, the exact name, the brand colours", () => {
    expect(ART_CONCEPT_SYSTEM).toMatch(/award-winning branding agency/);
    expect(ART_CONCEPT_SYSTEM).toMatch(/Never clip-art, never a plain generic icon/);
    const p = artConceptPrompt(brief, { count: 4 });
    expect(p).toMatch(/Business name \(exactly, nothing else is written\): Garcia's Roofing & Repair/);
    expect(p).toMatch(/navy blue \(#1E3A8A\), bright orange \(#EA580C\), white \(#FFFFFF\)/);
    expect(p).toMatch(/"emblem":/);
    expect(artConceptPrompt(brief, { count: 4, instructions: "a shield with a hammer", font: "playfair" })).toMatch(/«a shield with a hammer»[\s\S]*Playfair Display/);
  });

  it("the picture prompt quotes the name exactly, keeps services and taglines off, and asks for a wide logo on white", () => {
    const c = fallbackArtConcepts(brief, { count: 4 })[0];
    const p = artImagePrompt(brief, c);
    expect(p).toMatch(/Design a professional logo for "Garcia's Roofing & Repair", a roofing business/);
    expect(p).toMatch(/the only text in the image is the business name "Garcia's Roofing & Repair", spelled exactly like that, letter for letter, written once/);
    expect(p).toMatch(/not clip-art, not a generic icon/);
    expect(p).toMatch(/horizontal logo .* plain pure white background/);
    expect(p).toMatch(/Do not add: a tagline, slogan, services, phone number/);
    expect(p).not.toMatch(/Gutters|Roof repair/);
    expect(artImagePrompt(brief, c, { font: "lora" })).toMatch(/in lettering like Lora/);
  });

  it("reads the writer's briefs; four stock briefs (in four styles) when it is down", () => {
    const raw = `<think>…</think>${JSON.stringify({ concepts: [{ title: "Peak", idea: "i", style: "emblem", brief: "a crest", typography: "slab" }, { title: "x", style: "weird", brief: "an abstract mark" }, { title: "no brief" }] })}`;
    expect(parseArtConcepts(raw, 4)).toEqual([
      { title: "Peak", idea: "i", style: "emblem", brief: "a crest", typography: "slab" },
      { title: "x", idea: "", style: "combination", brief: "an abstract mark", typography: "" },
    ]);
    const f = fallbackArtConcepts(brief, { count: 4, instructions: "eagle" });
    expect(new Set(f.map((c) => c.style)).size).toBe(4);
    expect(f.every((c) => /eagle/.test(c.brief))).toBe(true);
    expect(f[2].brief).toMatch(/GR/);
  });

  it("a lettering fix and a change are EDITS: only the lettering / only the change, the rest kept", () => {
    expect(fixLetteringPrompt(brief, "GARCIA'S ROFING")).toMatch(/it reads "GARCIA'S ROFING"[\s\S]*reads exactly "Garcia's Roofing & Repair"[\s\S]*Keep the graphic, layout and colours exactly/);
    const v1 = refineArtPrompt(brief, "make the roof bigger", 0);
    expect(v1).toMatch(/Change: make the roof bigger\.[\s\S]*Keep everything else exactly the same/);
    expect(v1).not.toMatch(/version/);
    expect(refineArtPrompt(brief, "make the roof bigger", 2)).toMatch(/version 3 of 4/);
  });

  it("the spelling verdict: the name, nothing else; & = and; lines don't matter", () => {
    const read = (...text: string[]) => ({ text, legible: true, issues: [], quality: 8 });
    expect(judgeSpelling(read("GARCIA'S ROOFING", "AND REPAIR"), brief.logoText).verdict).toBe("exact");
    expect(judgeSpelling(read("Garcia's Roofing & Repair", "Since 1998"), brief.logoText)).toMatchObject({ verdict: "extra", extra: ["Since 1998"] });
    expect(judgeSpelling(read("GARCIA'S ROFING & REPAIR"), brief.logoText).verdict).toBe("misspelled");
    expect(judgeSpelling(null, brief.logoText).verdict).toBe("unchecked");
    expect(artScore({ spelling: "exact", quality: 4, horizontal: true })).toBeGreaterThan(artScore({ spelling: "misspelled", quality: 10, horizontal: true }));
  });
});

describe("which designer", () => {
  it("MiniMax by default (Google is billed per picture, chosen per round); an admin can prefer one (LOGO_IMAGE_ENGINE)", () => {
    const both = { google: {} as never, minimax: {} as never };
    expect(defaultEngine(both, undefined)).toBe("minimax");
    expect(defaultEngine(both, "google")).toBe("google");
    expect(defaultEngine({ google: null, minimax: {} as never }, "google")).toBe("minimax");
    expect(defaultEngine({ google: {} as never, minimax: null }, undefined)).toBe("google");
    expect(defaultEngine({ google: null, minimax: null }, undefined)).toBeNull();
    const fns = { art: vi.fn(), draw: vi.fn() };
    expect(pickEngine(null, fns)).toBe("minimax");
    expect(pickEngine("google", fns)).toBe("google");
    expect(pickEngine("google", { art: null, draw: vi.fn() })).toBe("minimax");
    expect(pickEngine(null, { art: vi.fn(), draw: null })).toBe("google");
  });
});

/* ------------------------------------------------------------- the runner */

const now = new Date("2026-10-23T12:00:00Z");
const gen = (over: Partial<LogoGeneration> = {}) =>
  ({
    id: "G1", lead_id: "L1", user_id: "U1", mode: "new", parent_id: null, parent_index: null, instructions: null, logo_text: "Garcia's Roofing & Repair",
    status: "running", stage: "concepts", concepts: [], candidates: [], notes: [], error: null, accepted_index: null, accepted_url: null, accepted_at: null,
    heartbeat_at: now.toISOString(), finished_at: null, created_at: now.toISOString(), updated_at: now.toISOString(), ...over,
  }) as unknown as Record<string, unknown>;
const cleaned = (png: Buffer): CleanLogo => ({ png, width: 1500, height: 500, aspect: 3, horizontal: true, transparent: true, background: "removed", colors: { present: [], missing: [], offPalette: 0, dominant: [] } });
const briefs = JSON.stringify({ concepts: ["combination", "emblem", "lettermark", "wordmark"].map((style, i) => ({ title: `Logo ${i + 1}`, idea: "i", style, brief: `brief ${i + 1}`, typography: "bold sans" })) });

/** The proofreader: what each saved picture says, by its path. */
const reader = (says: (url: string) => string) => vi.fn(async (_s: string, _u: string, url: string) => JSON.stringify({ text: [says(url)], legible: true, issues: [], quality: 8 }));

function setup(over: Partial<LogoRunnerDeps> = {}, row = gen(), extra: Record<string, unknown>[] = []) {
  const db = memorySupabase({ leads: [{ id: "L1", ...lead }], [LOGO_TABLE]: [row, ...extra] });
  const files = new Map<string, Buffer>();
  let n = 0;
  const deps: LogoRunnerDeps = {
    db: db.client,
    storage: {
      put: vi.fn(async (path: string, png: Buffer) => (files.set(path, png), `https://cdn.test/${path}`)),
      get: vi.fn(async (path: string) => files.get(path) ?? Buffer.from(`stored:${path}`)),
    },
    writeConcepts: vi.fn(async () => briefs),
    readLogo: reader(() => "GARCIA'S ROOFING & REPAIR"),
    draw: vi.fn(async () => Buffer.from("symbol")),
    art: vi.fn(async () => ({ png: Buffer.from(`art${++n}`), model: "gemini-3-pro-image" })),
    clean: vi.fn(async (png: Buffer) => cleaned(png)),
    compose: vi.fn(async () => ({ png: Buffer.from("lockup"), width: 1200, height: 400 })),
    flatten: vi.fn(async (png: Buffer) => Buffer.from(`white:${png.toString()}`)),
    now: () => now,
    ...over,
  };
  const stored = () => db.tables[LOGO_TABLE].find((r) => r.id === "G1") as unknown as LogoGeneration;
  return { db, deps, stored, files };
}

describe("a Google round", () => {
  it("four complete logos from four briefs, each read back — spelling checked, best first", async () => {
    const s = setup();
    await runLogoGeneration("G1", s.deps, { engine: "google" });
    const g = s.stored();
    expect(g).toMatchObject({ status: "ready", error: null, images_drawn: 4 });
    expect(s.deps.art).toHaveBeenCalledTimes(4);
    expect(s.deps.draw).not.toHaveBeenCalled();
    const prompts = vi.mocked(s.deps.art!).mock.calls.map(([p, image]) => ({ p, image }));
    expect(prompts.every(({ p, image }) => /Design a professional logo for "Garcia's Roofing & Repair"/.test(p) && image === null)).toBe(true);
    expect(prompts.map(({ p }) => p.match(/Concept: (brief \d)/)?.[1]).sort()).toEqual(["brief 1", "brief 2", "brief 3", "brief 4"]);
    expect(g.candidates).toHaveLength(4);
    expect(g.candidates.every((c) => c.engine === "google" && !c.typeset && c.check?.verdict === "exact" && c.fixes === 0 && c.model === "gemini-3-pro-image")).toBe(true);
    expect(g.concepts.map((c) => c.style)).toEqual(["combination", "emblem", "lettermark", "wordmark"]);
  });

  it("misspelled → Google fixes just the lettering on the picture it drew; still wrong after two fixes → flagged, last", async () => {
    // design 1 is wrong once then right; design 2 stays wrong
    const s = setup({ readLogo: reader((url) => (/\/1\.png$/.test(url) ? "GARCIA'S ROFING & REPAIR" : /\/2(-fix\d)?\.png$/.test(url) ? "GARCA'S ROOFING & REPAIR" : "GARCIA'S ROOFING & REPAIR")) });
    await runLogoGeneration("G1", s.deps, { engine: "google" });
    const calls = vi.mocked(s.deps.art!).mock.calls;
    const fixes = calls.filter(([p]) => /Its lettering is wrong/.test(p));
    expect(fixes.length).toBe(3); // design 1 once, design 2 twice
    expect(fixes.every(([, image]) => Buffer.isBuffer(image) && image.toString().startsWith("art"))).toBe(true); // the picture it drew
    expect(fixes[0][0]).toMatch(/it reads "GARCIA'S ROFING & REPAIR"/);
    const g = s.stored();
    const fixedOk = g.candidates.find((c) => c.fixes === 1)!;
    expect(fixedOk.check?.verdict).toBe("exact");
    expect(fixedOk.path).toMatch(/-fix1\.png$/);
    const stillWrong = g.candidates.find((c) => c.check?.verdict === "misspelled")!;
    expect(stillWrong.fixes).toBe(2);
    expect(stillWrong.score).toBe(Math.min(...g.candidates.map((c) => c.score)));
    expect(g.notes.join(" ")).toMatch(/1 design came out misspelled and was corrected automatically/);
    expect(g.notes.join(" ")).toMatch(/still has wrong lettering after two fixes/);
    expect(g.images_drawn).toBe(7);
  });

  it("changing a design EDITS that picture: four versions, the person's words, the rest kept", async () => {
    const parent = gen({ id: "P1", status: "ready", concepts: [{ title: "Peak emblem" }] as never, candidates: [{ index: 3, concept: 0, path: "lead-logos/L1/P1/4.png", seed: 0 }] as never });
    const s = setup({}, gen({ mode: "refine", parent_id: "P1", parent_index: 3, instructions: "make the roof bigger and the name bolder" }), [parent]);
    await runLogoGeneration("G1", s.deps, { engine: "google" });
    expect(s.deps.storage.get).toHaveBeenCalledWith("lead-logos/L1/P1/4.png");
    expect(s.deps.writeConcepts).not.toHaveBeenCalled();
    const calls = vi.mocked(s.deps.art!).mock.calls;
    expect(calls).toHaveLength(4);
    expect(calls.every(([p, image]) => /Change: make the roof bigger and the name bolder\./.test(p) && image?.toString() === "white:stored:lead-logos/L1/P1/4.png")).toBe(true);
    expect(calls.filter(([p]) => /version \d of 4/.test(p))).toHaveLength(3);
    const g = s.stored();
    expect(g.candidates).toHaveLength(4);
    expect(g.concepts[0].title).toBe("Peak emblem — changed");
  });

  it("Google can't design at all (key, billing…) → MiniMax makes the round, and the note says why", async () => {
    const s = setup({ art: vi.fn(async () => { throw new Error("Google's image models need billing switched on for the Gemini API key's Google Cloud project."); }), writeConcepts: vi.fn(async () => { throw new Error("down"); }) });
    await runLogoGeneration("G1", s.deps, { engine: "google" });
    const g = s.stored();
    expect(g.status).toBe("ready");
    expect(g.candidates.length).toBe(4);
    expect(g.candidates.every((c) => c.engine === "minimax" && c.typeset)).toBe(true);
    expect(g.notes.join(" ")).toMatch(/Google couldn't design these logos \(Google's image models need billing switched on/);
  });

  it("no MiniMax to fall back on → the round fails with Google's reason", async () => {
    const s = setup({ draw: null, art: vi.fn(async () => { throw new Error("Google refused the Gemini API key — check it under Admin → AI providers."); }) });
    await runLogoGeneration("G1", s.deps, { engine: "google" });
    expect(s.stored()).toMatchObject({ status: "failed", error: "Google refused the Gemini API key — check it under Admin → AI providers." });
  });

  it("a picked font becomes the lettering direction; no proofreader → unchecked, with a note", async () => {
    const s = setup({ readLogo: null });
    await runLogoGeneration("G1", s.deps, { engine: "google", font: "playfair" });
    expect(vi.mocked(s.deps.art!).mock.calls.every(([p]) => /in lettering like Playfair Display/.test(p))).toBe(true);
    expect(s.stored().candidates.every((c) => c.check?.verdict === "unchecked")).toBe(true);
    expect(s.stored().notes.join(" ")).toMatch(/spelling couldn't be checked/);
  });
});
