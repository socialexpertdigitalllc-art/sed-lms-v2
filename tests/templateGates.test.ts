import { describe, it, expect } from "vitest";
import { runGates } from "@/lib/template-engine/gates";

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
});
