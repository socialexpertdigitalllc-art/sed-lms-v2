import { describe, it, expect } from "vitest";
import { isLiveGenerationStatus, LIVE_GENERATION_STATUSES } from "@/lib/template-engine/deletion";

describe("isLiveGenerationStatus — template-delete in-progress guard", () => {
  it("blocks deletion for exactly the six live statuses", () => {
    for (const s of LIVE_GENERATION_STATUSES) expect(isLiveGenerationStatus(s)).toBe(true);
    // guard against silent drift in the set the DELETE route depends on
    expect([...LIVE_GENERATION_STATUSES].sort()).toEqual(
      ["building", "curating", "paused", "planning", "queued", "running"].sort()
    );
  });

  it("allows deletion for terminal / at-rest statuses (they get unlinked)", () => {
    for (const s of ["review", "ready_for_review", "deployed", "failed", "cancelled"]) {
      expect(isLiveGenerationStatus(s)).toBe(false);
    }
  });

  it("tolerates junk coming back from DB JSON", () => {
    for (const s of [null, undefined, 1, {}, [], "", "RUNNING", "done"]) {
      expect(isLiveGenerationStatus(s)).toBe(false);
    }
  });
});
