// tests/siteAgentTypes.test.ts
// @vitest-environment node
import { describe, it, expect } from "vitest";
import {
  AGENT_SITES_BUCKET, AGENT_RUN_ACTIVE_STATUSES, MAX_CHANGED_FILES,
  MAX_RESULT_BYTES, TAIL_MAX_CHARS, originalZipPath, resultZipPath,
  isActiveStatus, MODELS_REFRESH_MS,
} from "@/lib/site-agent/types";

describe("site-agent constants", () => {
  it("storage paths are per-run and stable", () => {
    expect(AGENT_SITES_BUCKET).toBe("agent-sites");
    expect(originalZipPath("r1")).toBe("r1/original.zip");
    expect(resultZipPath("r1")).toBe("r1/result.zip");
  });
  it("active statuses match the DB partial index exactly — unchanged in v2", () => {
    expect(AGENT_RUN_ACTIVE_STATUSES).toEqual(["queued", "running", "review", "deploying"]);
    expect(isActiveStatus("review")).toBe(true);
    expect(isActiveStatus("deployed")).toBe(false);
    expect(isActiveStatus("discarded")).toBe(false);
  });
  it("caps are sane relative to the deploy path's 60MB zip limit", () => {
    expect(MAX_RESULT_BYTES).toBeLessThanOrEqual(60 * 1024 * 1024);
    expect(MAX_CHANGED_FILES).toBeGreaterThan(0);
    expect(TAIL_MAX_CHARS).toBe(6000);
  });
  it("model list refresh cadence is 10 minutes", () => {
    expect(MODELS_REFRESH_MS).toBe(600_000);
  });
});
