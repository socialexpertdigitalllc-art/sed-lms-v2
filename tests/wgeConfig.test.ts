import { describe, it, expect } from "vitest";
import { wgeConfigSchema } from "@/lib/ai-tools/wge-schema";
import { DEFAULT_WGE_CONFIG } from "@/lib/ai-tools/wge-defaults";

describe("wgeConfigSchema", () => {
  it("accepts the default config", () => {
    expect(wgeConfigSchema.safeParse(DEFAULT_WGE_CONFIG).success).toBe(true);
  });
  it("rejects a bad variable key", () => {
    const bad = { ...DEFAULT_WGE_CONFIG, variables: [{ key: "Bad Key", label: "x", type: "text", fallback: "", lead_column: null, join: ", " }] };
    expect(wgeConfigSchema.safeParse(bad).success).toBe(false);
  });
  it("rejects an unknown variable type", () => {
    const bad = { ...DEFAULT_WGE_CONFIG, variables: [{ key: "ok", label: "x", type: "color", fallback: "", lead_column: null, join: ", " }] };
    expect(wgeConfigSchema.safeParse(bad).success).toBe(false);
  });
  it("rejects out-of-range temperature", () => {
    const bad = { ...DEFAULT_WGE_CONFIG, settings: { ...DEFAULT_WGE_CONFIG.settings, temperature: 9 } };
    expect(wgeConfigSchema.safeParse(bad).success).toBe(false);
  });
  it("rejects an empty prompt template", () => {
    expect(wgeConfigSchema.safeParse({ ...DEFAULT_WGE_CONFIG, prompt_template: "" }).success).toBe(false);
  });
});
