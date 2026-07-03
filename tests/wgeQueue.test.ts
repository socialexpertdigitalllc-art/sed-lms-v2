import { describe, it, expect } from "vitest";
import { isLeadReady, shouldAutoEnqueue } from "@/lib/ai-tools/queue";
import { DEFAULT_SETTINGS } from "@/lib/ai-tools/wge-defaults";

describe("isLeadReady", () => {
  it("true when all required keys have non-empty values", () => {
    expect(isLeadReady({ name: "Acme", services: "Roofing", pages: "5" }, ["name", "services", "pages"])).toBe(true);
  });
  it("false when a required key is missing or empty", () => {
    expect(isLeadReady({ name: "Acme", services: "", pages: "5" }, ["name", "services", "pages"])).toBe(false);
    expect(isLeadReady({ name: "Acme" }, ["name", "services"])).toBe(false);
  });
  it("true when ready_required is empty", () => {
    expect(isLeadReady({}, [])).toBe(true);
  });
});

describe("shouldAutoEnqueue", () => {
  const engine = { provider: "deepseek" as const, model: "deepseek-chat" };
  const ready = { name: "Acme", services: "Roofing", pages: "5" };
  it("true when enabled, engine set, ready, not yet queued/generated", () => {
    const s = { ...DEFAULT_SETTINGS, auto_generate: true, auto_engine: engine };
    expect(shouldAutoEnqueue(s, ready, { hasActive: false, hasGeneration: false })).toBe(true);
  });
  it("false when auto_generate is off", () => {
    const s = { ...DEFAULT_SETTINGS, auto_generate: false, auto_engine: engine };
    expect(shouldAutoEnqueue(s, ready, { hasActive: false, hasGeneration: false })).toBe(false);
  });
  it("false when auto_engine is null", () => {
    const s = { ...DEFAULT_SETTINGS, auto_generate: true, auto_engine: null };
    expect(shouldAutoEnqueue(s, ready, { hasActive: false, hasGeneration: false })).toBe(false);
  });
  it("false when not ready", () => {
    const s = { ...DEFAULT_SETTINGS, auto_generate: true, auto_engine: engine };
    expect(shouldAutoEnqueue(s, { name: "Acme" }, { hasActive: false, hasGeneration: false })).toBe(false);
  });
  it("false when already active or already generated", () => {
    const s = { ...DEFAULT_SETTINGS, auto_generate: true, auto_engine: engine };
    expect(shouldAutoEnqueue(s, ready, { hasActive: true, hasGeneration: false })).toBe(false);
    expect(shouldAutoEnqueue(s, ready, { hasActive: false, hasGeneration: true })).toBe(false);
  });
});
