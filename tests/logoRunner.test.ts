// @vitest-environment node
import { describe, it, expect, vi } from "vitest";
import { memorySupabase } from "./helpers/memorySupabase";
import { runLogoGeneration, type LogoRunnerDeps } from "@/lib/logos/runner";
import type { CleanLogo } from "@/lib/logos/cleanup";
import { LOGO_TABLE, type LogoCandidate, type LogoGeneration } from "@/lib/logos/store";

/**
 * One logo round, with nobody waiting: ideas → drawings (saved as they come)
 * → proofreading → best first. A round where nothing is spelled right draws
 * more; a dead concept writer or proofreader never stops the button working;
 * Stop wins over late work.
 */

const now = new Date("2026-10-22T12:00:00Z");
const lead = { id: "L1", business_name: "ABC Roofing LLC", services: ["Roof repair"], category: "Roofing", about_business: null, color_scheme: "navy, orange" };
const gen = (over: Partial<LogoGeneration> = {}) =>
  ({
    id: "G1", lead_id: "L1", user_id: "U1", mode: "new", parent_id: null, parent_index: null, instructions: null, logo_text: "ABC Roofing",
    status: "running", stage: "concepts", concepts: [], candidates: [], notes: [], error: null, accepted_index: null, accepted_url: null, accepted_at: null,
    heartbeat_at: now.toISOString(), finished_at: null, created_at: now.toISOString(), updated_at: now.toISOString(), ...over,
  }) as unknown as Record<string, unknown>;

const concepts = (n: number) =>
  JSON.stringify({ concepts: Array.from({ length: n }, (_, i) => ({ title: `Idea ${i + 1}`, idea: "i", symbol: `symbol ${i + 1}`, typography: "bold", layout: ["icon-left", "wordmark", "integrated", "badge-left"][i % 4], colorUse: "c" })) });

const cleaned = (over: Partial<CleanLogo> = {}): CleanLogo => ({
  png: Buffer.from("png"), width: 900, height: 300, aspect: 3, horizontal: true, transparent: true, background: "removed",
  colors: { present: ["#1e3a8a", "#ea580c"], missing: [], offPalette: 0, dominant: [] }, ...over,
});

/** What the proofreader reads on each design, by its file number. */
function reader(readings: Record<number, string[]>) {
  return vi.fn(async (_s: string, _u: string, url: string) => {
    const n = Number(url.match(/(\d+)\.png$/)?.[1]);
    return JSON.stringify({ text: readings[n] ?? ["ABC ROOFING"], layout: "horizontal", legible: true, issues: [], quality: 7 });
  });
}

function setup(over: Partial<LogoRunnerDeps> = {}, row = gen(), extra: Record<string, Record<string, unknown>[]> = {}) {
  const db = memorySupabase({ leads: [lead], [LOGO_TABLE]: [row, ...(extra[LOGO_TABLE] ?? [])] });
  let seedCount = 0;
  const deps: LogoRunnerDeps = {
    db: db.client,
    storage: { put: vi.fn(async (path: string) => `https://cdn.test/${path}`) },
    writeConcepts: vi.fn(async () => concepts(4)),
    readLogo: reader({}),
    draw: vi.fn(async () => Buffer.from("img")),
    clean: vi.fn(async () => cleaned()),
    now: () => now,
    random: () => (++seedCount % 10) / 10,
    ...over,
  };
  const stored = () => db.tables[LOGO_TABLE].find((r) => r.id === "G1") as unknown as LogoGeneration;
  return { db, deps, stored };
}

describe("runLogoGeneration", () => {
  it("draws one design per idea, proofreads each, and finishes — best first", async () => {
    const { deps, stored } = setup({ readLogo: reader({ 2: ["ABC ROFING"] }) });
    await runLogoGeneration("G1", deps);
    const g = stored();
    expect(g).toMatchObject({ status: "ready", stage: null, error: null, images_drawn: 4, finished_at: now.toISOString() });
    expect(g.concepts.map((c) => c.title)).toEqual(["Idea 1", "Idea 2", "Idea 3", "Idea 4"]);
    expect(g.candidates).toHaveLength(4);
    expect(deps.draw).toHaveBeenCalledTimes(4);
    // every picture prompt carries the exact words and nothing else to write
    for (const [prompt] of vi.mocked(deps.draw).mock.calls) expect(prompt).toContain('"ABC Roofing"');
    expect(vi.mocked(deps.writeConcepts).mock.calls[0][1]).toMatch(/Logo text \(exactly these words, nothing else\): ABC Roofing/);
    const misspelled = g.candidates.find((c) => c.check?.verdict === "misspelled") as LogoCandidate;
    expect(misspelled.check?.read).toBe("ABC ROFING");
    expect(Math.max(...g.candidates.map((c) => c.score))).toBeGreaterThan(misspelled.score);
    expect(g.candidates.every((c) => c.path.startsWith("lead-logos/L1/G1/") && c.url.startsWith("https://cdn.test/"))).toBe(true);
    expect(new Set(g.candidates.map((c) => c.seed)).size).toBe(4);
  });

  it("nothing spelled right → one more round with plainer lettering (8 at most)", async () => {
    const wrong = { 1: ["ABD ROOFING"], 2: ["ABC ROOFNG"], 3: ["ACB ROOFING"], 4: ["ABC ROOOFING"] };
    const { deps, stored } = setup({ readLogo: reader(wrong) });
    await runLogoGeneration("G1", deps);
    const g = stored();
    expect(deps.draw).toHaveBeenCalledTimes(8);
    expect(vi.mocked(deps.draw).mock.calls.slice(4).every(([p]) => /every letter fully drawn/.test(p))).toBe(true);
    expect(g.candidates.filter((c) => c.round === 2)).toHaveLength(4);
    expect(g.candidates.filter((c) => c.check?.verdict === "exact")).toHaveLength(4);
    expect(g.notes.join(" ")).toMatch(/spelling mistakes, so it drew more/);
    expect(g.images_drawn).toBe(8);
  });

  it("the concept writer is down → standard layouts, and it still draws", async () => {
    const { deps, stored } = setup({ writeConcepts: vi.fn(async () => { throw new Error("busy"); }) });
    await runLogoGeneration("G1", deps);
    expect(stored().status).toBe("ready");
    expect(stored().concepts).toHaveLength(4);
    expect(stored().notes.join(" ")).toMatch(/standard layouts/);
  });

  it("no proofreader → designs are marked unchecked, with a note to read them", async () => {
    const { deps, stored } = setup({ readLogo: null });
    await runLogoGeneration("G1", deps);
    expect(stored().candidates.every((c) => c.check === null)).toBe(true);
    expect(stored().notes.join(" ")).toMatch(/spelling wasn't checked/);
    expect(deps.draw).toHaveBeenCalledTimes(4); // no extra round without a check
  });

  it("some drawings fail → the rest are kept and the failure is noted; all fail → failed with MiniMax's reason", async () => {
    let n = 0;
    const flaky = setup({ draw: vi.fn(async () => { if (++n === 2) throw new Error("MiniMax is busy right now."); return Buffer.from("img"); }) });
    await runLogoGeneration("G1", flaky.deps);
    expect(flaky.stored()).toMatchObject({ status: "ready" });
    expect(flaky.stored().candidates).toHaveLength(3);
    expect(flaky.stored().notes.join(" ")).toMatch(/1 design couldn't be drawn \(MiniMax is busy right now\.\)/);

    const dead = setup({ draw: vi.fn(async () => { throw new Error("The MiniMax plan has no image allowance left right now."); }) });
    await runLogoGeneration("G1", dead.deps);
    expect(dead.stored()).toMatchObject({ status: "failed", error: "The MiniMax plan has no image allowance left right now." });
  });

  it("Stop wins: once cancelled, nothing more is written or drawn", async () => {
    const box: { db?: ReturnType<typeof memorySupabase> } = {};
    let drawn = 0;
    const s = setup({
      draw: vi.fn(async () => {
        drawn++;
        // The person presses Stop while the first drawing is under way.
        const row = box.db!.tables[LOGO_TABLE][0];
        row.status = "cancelled";
        return Buffer.from("img");
      }),
    });
    box.db = s.db;
    await runLogoGeneration("G1", s.deps);
    expect(s.stored().status).toBe("cancelled");
    expect(s.stored().candidates).toEqual([]);
    expect(s.deps.readLogo).not.toHaveBeenCalled();
    expect(drawn).toBeLessThanOrEqual(4);
  });

  it("refine: changes ONE design — its concept is revised, and the first drawing reuses its seed", async () => {
    const parent = gen({
      id: "P1", status: "ready",
      concepts: [{ title: "Old roof", idea: "i", symbol: "a roof", typography: "bold", layout: "icon-left", colorUse: "c" }],
      candidates: [{ index: 2, concept: 0, seed: 424242, round: 1, prompt: "p", path: "x", url: "u", width: 1, height: 1, aspect: 3, horizontal: true, transparent: true, background: "removed", colors: { present: [], missing: [], offPalette: 0, dominant: [] }, check: null, score: 1 }],
    });
    const { deps, stored } = setup(
      { writeConcepts: vi.fn(async () => concepts(1)) },
      gen({ mode: "refine", parent_id: "P1", parent_index: 2, instructions: "simpler roof" }),
      { [LOGO_TABLE]: [parent] },
    );
    await runLogoGeneration("G1", deps);
    const userPrompt = vi.mocked(deps.writeConcepts).mock.calls[0][1];
    expect(userPrompt).toMatch(/They want these changes: «simpler roof»/);
    expect(userPrompt).toMatch(/"title":"Old roof"/);
    expect(vi.mocked(deps.draw).mock.calls[0][1]).toBe(424242);
    expect(stored().candidates.every((c) => c.concept === 0)).toBe(true);
    expect(stored().candidates).toHaveLength(4);
  });

  it("does nothing for a round that isn't running", async () => {
    const { deps } = setup({}, gen({ status: "cancelled" }));
    await runLogoGeneration("G1", deps);
    expect(deps.writeConcepts).not.toHaveBeenCalled();
  });
});
