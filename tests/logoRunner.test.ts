// @vitest-environment node
import { describe, it, expect, vi } from "vitest";
import sharp from "sharp";
import { memorySupabase } from "./helpers/memorySupabase";
import { runLogoGeneration, type LogoRunnerDeps } from "@/lib/logos/runner";
import type { CleanLogo } from "@/lib/logos/cleanup";
import type { LockupInput } from "@/lib/logos/compose";
import { LOGO_TABLE, type LogoCandidate, type LogoGeneration } from "@/lib/logos/store";

/**
 * One logo round, with nobody waiting: ideas → each SYMBOL drawn by MiniMax
 * (never any text), checked for stray letters, then the name TYPESET beside
 * it — so every design is spelled exactly right. Changing a design keeps its
 * symbol unless the change is about the symbol. MiniMax down → badges, not a
 * failure. Stop wins over late work.
 */

const now = new Date("2026-10-23T12:00:00Z");
const lead = { id: "L1", business_name: "ABC Roofing LLC", services: ["Roof repair"], category: "Roofing", about_business: null, color_scheme: "navy, orange" };
const gen = (over: Partial<LogoGeneration> = {}) =>
  ({
    id: "G1", lead_id: "L1", user_id: "U1", mode: "new", parent_id: null, parent_index: null, instructions: null, logo_text: "ABC Roofing",
    status: "running", stage: "concepts", concepts: [], candidates: [], notes: [], error: null, accepted_index: null, accepted_url: null, accepted_at: null,
    heartbeat_at: now.toISOString(), finished_at: null, created_at: now.toISOString(), updated_at: now.toISOString(), ...over,
  }) as unknown as Record<string, unknown>;

const LAYOUTS = ["icon-left", "badge-left", "wordmark", "icon-left"];
const reply = (n = 4, over: Record<string, unknown> = {}) =>
  JSON.stringify({
    ...over,
    concepts: Array.from({ length: n }, (_, i) => ({
      title: `Idea ${i + 1}`, idea: "i", layout: LAYOUTS[i % 4], symbol: LAYOUTS[i % 4] === "icon-left" ? `roof symbol ${i + 1}` : "", font: ["montserrat", "oswald", "poppins", "lora"][i % 4],
      case: "upper", lines: ["ABC", "Roofing"], nameColor: "#1e3a8a", subColor: "#ea580c",
    })),
  });

const cleaned = (over: Partial<CleanLogo> = {}): CleanLogo => ({
  png: Buffer.from("symbol"), width: 400, height: 380, aspect: 1.05, horizontal: false, transparent: true, background: "removed",
  colors: { present: [], missing: [], offPalette: 0, dominant: [] }, ...over,
});

/** What the checker says about each symbol, by its file name. */
function checker(withText: (url: string) => boolean = () => false) {
  return vi.fn(async (_s: string, _u: string, url: string) => JSON.stringify({ text: withText(url), clean: true, issues: withText(url) ? ["letters in it"] : [], quality: 7 }));
}

function setup(over: Partial<LogoRunnerDeps> = {}, row = gen(), extra: Record<string, unknown>[] = []) {
  const db = memorySupabase({ leads: [lead], [LOGO_TABLE]: [row, ...extra] });
  let seedCount = 0;
  const files = new Map<string, Buffer>();
  const deps: LogoRunnerDeps = {
    db: db.client,
    storage: {
      put: vi.fn(async (path: string, png: Buffer) => {
        files.set(path, png);
        return `https://cdn.test/${path}`;
      }),
      get: vi.fn(async (path: string) => files.get(path) ?? sharp({ create: { width: 40, height: 30, channels: 4, background: "#ea580c" } }).png().toBuffer()),
    },
    writeConcepts: vi.fn(async () => reply()),
    readLogo: checker(),
    draw: vi.fn(async () => Buffer.from("img")),
    clean: vi.fn(async () => cleaned()),
    compose: vi.fn(async (input: LockupInput) => ({ png: Buffer.from(`lockup:${input.layout}`), width: 1200, height: 400 })),
    now: () => now,
    random: () => (++seedCount % 10) / 10,
    ...over,
  };
  const stored = () => db.tables[LOGO_TABLE].find((r) => r.id === "G1") as unknown as LogoGeneration;
  return { db, deps, stored, files };
}

describe("runLogoGeneration", () => {
  it("draws only the symbols (no name, no text), typesets the name, and finishes best first", async () => {
    const { deps, stored } = setup();
    await runLogoGeneration("G1", deps);
    const g = stored();
    expect(g).toMatchObject({ status: "ready", stage: null, error: null, images_drawn: 2 });
    expect(g.candidates).toHaveLength(4);
    // only the two icon-left designs needed a picture — square symbols, never the name
    expect(deps.draw).toHaveBeenCalledTimes(2);
    for (const [prompt] of vi.mocked(deps.draw).mock.calls) {
      expect(prompt).toMatch(/logo symbol for a roofing business: roof symbol/);
      expect(prompt).toMatch(/Absolutely no text of any kind/);
      expect(prompt).not.toMatch(/ABC/);
    }
    // the name goes to the typesetter, split as designed, in the chosen fonts
    const composed = vi.mocked(deps.compose!).mock.calls.map(([input]) => input);
    expect(composed.map((c) => c.lines)).toEqual(Array(4).fill(["ABC", "Roofing"]));
    expect(composed.map((c) => c.font).sort()).toEqual(["lora", "montserrat", "oswald", "poppins"]);
    expect(composed.filter((c) => c.layout === "icon-left").every((c) => c.icon?.png.toString() === "symbol")).toBe(true);
    expect(composed.find((c) => c.layout === "badge-left")?.badge).toEqual({ shape: "circle", color: "#ea580c", initials: "AR" });
    // every design: exact spelling, typeset, with its own symbol file to reuse later
    expect(g.candidates.every((c) => c.typeset && c.check?.verdict === "exact" && c.check.read === "ABC ROOFING")).toBe(true);
    const withIcon = g.candidates.filter((c) => c.layout === "icon-left");
    expect(withIcon.every((c) => c.iconPath?.startsWith("lead-logos/L1/G1/symbol-") && c.iconCheck?.text === false)).toBe(true);
    expect(Math.max(...withIcon.map((c) => c.score))).toBeGreaterThan(Math.max(...g.candidates.filter((c) => c.layout !== "icon-left").map((c) => c.score)));
  });

  it("a symbol with letters in it is drawn again with stricter words; still lettered → kept, flagged and last", async () => {
    let n = 0;
    const s = setup({ draw: vi.fn(async () => Buffer.from(`img${++n}`)), readLogo: checker((url) => url.includes("symbol-1")) });
    await runLogoGeneration("G1", s.deps);
    const prompts = vi.mocked(s.deps.draw).mock.calls.map(([p]) => p);
    expect(prompts).toHaveLength(3); // design 1 twice (both lettered), design 4 once
    expect(prompts.filter((p) => /nothing that looks like writing/.test(p))).toHaveLength(1);
    const g = s.stored();
    const flagged = g.candidates.find((c) => c.iconCheck?.text) as LogoCandidate;
    expect(flagged).toBeDefined();
    expect(flagged.score).toBe(Math.min(...g.candidates.map((c) => c.score)));
    expect(g.notes.join(" ")).toMatch(/letter-like marks/);
  });

  it("a symbol that didn't come out on plain white is drawn again", async () => {
    let n = 0;
    const s = setup({ clean: vi.fn(async () => (++n === 1 ? cleaned({ background: "busy", transparent: false }) : cleaned())) });
    await runLogoGeneration("G1", s.deps);
    expect(s.deps.draw).toHaveBeenCalledTimes(3);
    expect(s.stored().candidates).toHaveLength(4);
  });

  it("MiniMax can't draw at all → the designs come back with a badge of the initials instead, and say why", async () => {
    const s = setup({ draw: vi.fn(async () => { throw new Error("The MiniMax plan has no image allowance left right now."); }) });
    await runLogoGeneration("G1", s.deps);
    const g = s.stored();
    expect(g.status).toBe("ready");
    expect(g.candidates).toHaveLength(4);
    expect(g.candidates.filter((c) => c.layout === "badge-left")).toHaveLength(3);
    expect(g.notes.join(" ")).toMatch(/MiniMax couldn't draw some symbols \(The MiniMax plan has no image allowance left right now\.\) — those designs use a badge/);
  });

  it("the concept writer is down → standard designs, still typeset", async () => {
    const s = setup({ writeConcepts: vi.fn(async () => { throw new Error("busy"); }) });
    await runLogoGeneration("G1", s.deps);
    expect(s.stored().status).toBe("ready");
    expect(s.stored().candidates).toHaveLength(4);
    expect(s.stored().notes.join(" ")).toMatch(/standard layouts/);
  });

  it("a font the person picked is used in every design", async () => {
    const s = setup();
    await runLogoGeneration("G1", s.deps, { font: "playfair" });
    expect(vi.mocked(s.deps.compose!).mock.calls.every(([input]) => input.font === "playfair")).toBe(true);
    expect(vi.mocked(s.deps.writeConcepts).mock.calls[0][1]).toMatch(/Use the font "playfair" in every version/);
  });

  describe("changing one design", () => {
    const parent = (iconPath: string | null) =>
      gen({
        id: "P1", status: "ready",
        concepts: [{ title: "Roof", idea: "i", layout: "icon-left", symbol: "a roof", badge: "circle", font: "oswald", letterCase: "upper", lines: ["ABC Roofing"], tracking: 0.03, nameColor: "#1e3a8a", subColor: "#ea580c", twoTone: false, iconColors: "orange", iconScale: 1 }],
        candidates: [{ index: 2, concept: 0, seed: 424242, round: 1, prompt: "p", path: "x", url: "u", width: 1, height: 1, aspect: 3, horizontal: true, transparent: true, background: "removed", colors: { present: [], missing: [], offPalette: 0, dominant: [] }, check: null, score: 1, typeset: !!iconPath, iconPath, iconUrl: iconPath ? `https://cdn.test/${iconPath}` : null, iconCheck: null }],
      });
    const refine = (instructions: string) => gen({ mode: "refine", parent_id: "P1", parent_index: 2, instructions });

    it("a change to the lettering keeps the very same symbol — nothing is redrawn", async () => {
      const s = setup({ writeConcepts: vi.fn(async () => reply(4, { icon: "keep" }).replace(/"layout":"(badge-left|wordmark)"/g, '"layout":"icon-left"').replace(/"symbol":""/g, '"symbol":"a roof"')) }, refine("bolder name, Playfair font"), [parent("lead-logos/L1/P1/symbol-3.png")]);
      await runLogoGeneration("G1", s.deps);
      expect(s.deps.draw).not.toHaveBeenCalled();
      expect(s.deps.storage.get).toHaveBeenCalledWith("lead-logos/L1/P1/symbol-3.png");
      const g = s.stored();
      expect(g.candidates).toHaveLength(4);
      expect(g.candidates.every((c) => c.iconPath === "lead-logos/L1/P1/symbol-3.png" && c.seed === 424242)).toBe(true);
      expect(vi.mocked(s.deps.writeConcepts).mock.calls[0][1]).toMatch(/They want these changes: «bolder name, Playfair font»/);
    });

    it("a change to the symbol redraws it, the first version from the same seed", async () => {
      const s = setup({ writeConcepts: vi.fn(async () => reply(4, { icon: "redraw" })) }, refine("a simpler roof icon"), [parent("lead-logos/L1/P1/symbol-3.png")]);
      await runLogoGeneration("G1", s.deps);
      expect(s.deps.draw).toHaveBeenCalled();
      expect(vi.mocked(s.deps.draw).mock.calls.some(([, seed]) => seed === 424242)).toBe(true);
    });

    it("without the writer saying, the words decide (bigger icon → keep; different icon → redraw)", async () => {
      const keep = setup({}, refine("bigger icon"), [parent("lead-logos/L1/P1/symbol-3.png")]);
      await runLogoGeneration("G1", keep.deps);
      expect(keep.deps.draw).not.toHaveBeenCalled();
      const redraw = setup({}, refine("a different icon"), [parent("lead-logos/L1/P1/symbol-3.png")]);
      await runLogoGeneration("G1", redraw.deps);
      expect(redraw.deps.draw).toHaveBeenCalled();
    });

    it("a design from before typesetting (its name was drawn into the picture) gets a new, typeset version", async () => {
      const s = setup({ writeConcepts: vi.fn(async () => reply(4, { icon: "keep" })) }, refine("fix the spelling"), [parent(null)]);
      await runLogoGeneration("G1", s.deps);
      expect(s.deps.draw).toHaveBeenCalled(); // nothing to reuse: the old picture had the misspelt name in it
      expect(s.stored().candidates.every((c) => c.typeset && c.check?.read === "ABC ROOFING")).toBe(true);
    });
  });

  it("Stop wins: once cancelled, nothing more is written", async () => {
    const box: { db?: ReturnType<typeof memorySupabase> } = {};
    const s = setup({
      draw: vi.fn(async () => {
        box.db!.tables[LOGO_TABLE][0].status = "cancelled";
        return Buffer.from("img");
      }),
    });
    box.db = s.db;
    await runLogoGeneration("G1", s.deps);
    expect(s.stored().status).toBe("cancelled");
    expect(s.stored().candidates.filter((c) => c.layout === "icon-left")).toEqual([]);
  });

  it("does nothing for a round that isn't running", async () => {
    const { deps } = setup({}, gen({ status: "cancelled" }));
    await runLogoGeneration("G1", deps);
    expect(deps.writeConcepts).not.toHaveBeenCalled();
  });
});

describe("end to end (real cleanup and typesetting)", () => {
  it("a drawn symbol and the typeset name make one transparent, horizontal PNG", async () => {
    const symbol = await sharp(Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="1024" height="1024"><rect width="1024" height="1024" fill="#fff"/><polygon points="212,560 512,260 812,560" fill="#ea580c"/><rect x="330" y="560" width="364" height="230" fill="#1e3a8a"/></svg>`)).jpeg({ quality: 90 }).toBuffer();
    const s = setup({ draw: vi.fn(async () => symbol), clean: undefined, compose: undefined });
    await runLogoGeneration("G1", s.deps);
    const g = s.stored();
    expect(g.candidates).toHaveLength(4);
    const design = g.candidates.find((c) => c.layout === "icon-left")!;
    const png = s.files.get(design.path)!;
    const meta = await sharp(png).metadata();
    expect(meta.hasAlpha).toBe(true);
    expect(meta.width! / meta.height!).toBeGreaterThan(1.7);
  }, 30_000);
});
