import { describe, it, expect } from "vitest";
import { STUDIO_STATUSES, canTransition } from "@/lib/site-studio/service/types";

describe("studio template status transitions", () => {
  it("declares the six statuses", () => {
    expect(STUDIO_STATUSES).toEqual(["uploaded", "needs_review", "certified", "rejected", "disabled"]);
  });
  it("allows the operator transitions and nothing else", () => {
    expect(canTransition("needs_review", "rejected")).toBe(true);
    expect(canTransition("certified", "disabled")).toBe(true);
    expect(canTransition("disabled", "certified")).toBe(true);
    expect(canTransition("rejected", "needs_review")).toBe(true);
    // certification is NOT a generic transition — it has its own route with
    // preconditions (zero blockers), so the generic map refuses it:
    expect(canTransition("needs_review", "certified")).toBe(false);
    // compile owns uploaded→needs_review:
    expect(canTransition("uploaded", "needs_review")).toBe(false);
    expect(canTransition("certified", "rejected")).toBe(false);
  });
});
