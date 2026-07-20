import { describe, it, expect } from "vitest";
import { runGates, type GateResult } from "@/lib/template-engine/gates";
import {
  MAX_REPAIR_ROUNDS,
  gateFingerprint,
  repairStalled,
  describeGateFailure,
} from "@/lib/template-engine/runnerV2";

const template = { "index.html": `<div class="hero"><h1>Northpoint Remodeling</h1></div>` };
const clean = { "index.html": `<div class="hero"><h1>Inside Out Painting</h1></div>` };
const leaky = { "index.html": `<div class="hero"><h1>Northpoint Remodeling</h1></div>` };
const broken = { "index.html": `<section><h1>Inside Out Painting</h1></section>` };
const tokens = ["Northpoint Remodeling"];

describe("runGates", () => {
  it("passes clean, structurally-identical output", () => {
    const r = runGates({ template, output: clean, demoTokens: tokens });
    expect(r.ok).toBe(true);
    expect(r.leaks).toEqual([]);
  });
  it("FAILS an unchanged template — the exact v1 Warrior bug", () => {
    const r = runGates({ template, output: leaky, demoTokens: tokens });
    expect(r.ok).toBe(false);
    expect(r.leaks.length).toBeGreaterThan(0);
    expect(r.leaks[0].token).toBe("Northpoint Remodeling");
  });
  it("fails output that dropped the template's structure", () => {
    const r = runGates({ template, output: broken, demoTokens: tokens });
    expect(r.ok).toBe(false);
    expect(r.structure.some((s) => !s.ok)).toBe(true);
  });
  it("reports a machine-readable result for gate_results", () => {
    const r = runGates({ template, output: clean, demoTokens: tokens });
    expect(() => JSON.stringify(r)).not.toThrow();
    expect(r).toHaveProperty("ok");
  });

  // The production failure: the demo token "King" made the gate unpassable
  // because every page legitimately says "working"/"booking".
  it("passes honest copy containing 'working' against the token 'King'", () => {
    const t = { "index.html": `<div class="hero"><h1>King Painting</h1></div>` };
    const o = { "index.html": `<div class="hero"><h1>Inside Out Painting for living and working spaces</h1></div>` };
    const r = runGates({ template: t, output: o, demoTokens: ["King", "King Painting"] });
    expect(r.leaks).toEqual([]);
    expect(r.ok).toBe(true);
  });
  it("still fails when the demo brand itself survives", () => {
    const t = { "index.html": `<div class="hero"><h1>King Painting</h1></div>` };
    const r = runGates({ template: t, output: t, demoTokens: ["King", "King Painting"] });
    expect(r.ok).toBe(false);
    expect(r.leaks.map((l) => l.token)).toContain("King Painting");
  });
});

// The repair loop's stop condition, tested as pure data — no AI calls involved.
function gate(leaks: [string, string][], structFails: string[] = []): GateResult {
  return {
    ok: leaks.length === 0 && structFails.length === 0,
    leaks: leaks.map(([file, token]) => ({ file, token, excerpt: "…" })),
    structure: structFails.map((file) => ({ file, ok: false, detail: "missing classes: hero" })),
    checkedAt: "2026-01-01T00:00:00.000Z",
  };
}

describe("repair loop control", () => {
  it("caps the rounds so a hopeless run cannot burn credits forever", () => {
    expect(MAX_REPAIR_ROUNDS).toBe(3);
  });
  it("fingerprints a failure by its tokens and broken files, order-independently", () => {
    const a = gate([["index.html", "King"], ["about.html", "King"]], ["index.html"]);
    const b = gate([["about.html", "King"], ["index.html", "King"]], ["index.html"]);
    expect(gateFingerprint(a)).toBe(gateFingerprint(b));
  });
  it("breaks early when a round changes nothing", () => {
    const before = gate([["index.html", "King"]]);
    const after = gate([["index.html", "King"]]);
    expect(repairStalled(before, after)).toBe(true);
  });
  it("keeps going when a round removed one of the leaks", () => {
    const before = gate([["index.html", "King"], ["about.html", "King"]]);
    const after = gate([["index.html", "King"]]);
    expect(repairStalled(before, after)).toBe(false);
  });
  it("never reports a stall once the gate passes", () => {
    const passing = gate([]);
    expect(repairStalled(passing, passing)).toBe(false);
  });
  it("distinguishes 'no progress' from 'ran out of rounds', with the tokens", () => {
    const g = gate([["index.html", "King"]]);
    const stuck = describeGateFailure(g, { rounds: 2, stalled: true });
    const exhausted = describeGateFailure(g, { rounds: 3, stalled: false });
    expect(stuck).toMatch(/no progress after 2 repair round/);
    expect(stuck).toContain("index.html:King");
    expect(exhausted).toMatch(/still failing after 3 repair round/);
    expect(exhausted).toContain("index.html:King");
    expect(describeGateFailure(g)).not.toMatch(/round/);
  });
});
