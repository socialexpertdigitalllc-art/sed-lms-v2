// @vitest-environment node
import { describe, it, expect } from "vitest";
import {
  DEFAULT_RATE_BUDGETS,
  MIN_SCALE,
  resolveBudget,
  scaleBudget,
  type RateBudget,
} from "@/lib/ai-tools/providers/limits";

describe("resolveBudget", () => {
  it("uses the shipped default when there is no override", () => {
    expect(resolveBudget("minimax", null)).toEqual(DEFAULT_RATE_BUDGETS.minimax);
  });

  it("returns an empty budget for an unknown provider rather than inventing one", () => {
    expect(resolveBudget("nobody", null)).toEqual({});
  });

  it("lets an operator raise a dimension", () => {
    expect(resolveBudget("webcraft", { concurrency: 100, rpm: 500 })).toMatchObject({
      concurrency: 100,
      rpm: 500,
    });
  });

  it("treats an explicit null as 'this vendor does not limit that dimension'", () => {
    const out = resolveBudget("webcraft", { concurrency: null });
    expect(out.concurrency).toBeUndefined();
    expect(out.rpm).toBe(DEFAULT_RATE_BUDGETS.webcraft.rpm);
  });

  it("ignores nonsense rather than throttling to zero", () => {
    const out = resolveBudget("minimax", { rpm: 0, tpm: Number.NaN });
    expect(out.rpm).toBe(DEFAULT_RATE_BUDGETS.minimax.rpm);
    expect(out.tpm).toBe(DEFAULT_RATE_BUDGETS.minimax.tpm);
  });

  it("leaves an absent dimension absent — DeepSeek documents no RPM", () => {
    expect(DEFAULT_RATE_BUDGETS.deepseek.rpm).toBeUndefined();
    expect(resolveBudget("deepseek", null).rpm).toBeUndefined();
  });
});

describe("scaleBudget", () => {
  const budget: RateBudget = { concurrency: 10, rpm: 100, tpm: 1_000_000, tpd: 5_000_000 };

  it("is a no-op at full scale", () => {
    expect(scaleBudget(budget, 1)).toEqual(budget);
  });

  it("shrinks the per-minute dimensions", () => {
    expect(scaleBudget(budget, 0.5)).toMatchObject({ concurrency: 5, rpm: 50, tpm: 500_000 });
  });

  it("never scales a daily cap — a quota is absolute, not a rate", () => {
    expect(scaleBudget(budget, 0.25).tpd).toBe(5_000_000);
  });

  it("floors every scaled dimension at 1 so the gate can never wedge", () => {
    const tiny = scaleBudget({ concurrency: 2, rpm: 3 }, MIN_SCALE);
    expect(tiny.concurrency).toBeGreaterThanOrEqual(1);
    expect(tiny.rpm).toBeGreaterThanOrEqual(1);
  });

  it("clamps a scale above 1 — adaptation may only lower a stated limit", () => {
    expect(scaleBudget(budget, 5)).toEqual(budget);
  });

  it("leaves undeclared dimensions undeclared", () => {
    expect(scaleBudget({ concurrency: 4 }, 0.5).rpm).toBeUndefined();
  });
});
