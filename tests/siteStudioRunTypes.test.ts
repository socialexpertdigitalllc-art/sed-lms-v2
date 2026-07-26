import { describe, it, expect } from "vitest";
import { RUN_STATUSES, STEP_ORDER, nextStep, isTerminal, canCancel } from "@/lib/site-studio/run/types";

describe("run step machine", () => {
  it("declares the statuses and the step order", () => {
    expect(RUN_STATUSES).toEqual(["queued","preparing","reviewing","approved","rendering","ready","failed","cancelled"]);
    expect(STEP_ORDER).toEqual(["prepare","write","render","finalize"]);
  });
  it("walks queued → prepare → write → [gate 1] → approved → render → finalize → done", () => {
    expect(nextStep("queued")).toBe("prepare");
    expect(nextStep("preparing")).toBe("write");
    expect(nextStep("approved")).toBe("render");
    expect(nextStep("rendering")).toBe("finalize");
    expect(nextStep("ready")).toBeNull();
  });
  it("has no next step once terminal, and reviewing is a park (not terminal, but no step)", () => {
    for (const s of ["ready","failed","cancelled"] as const) {
      expect(nextStep(s)).toBeNull();
      expect(isTerminal(s)).toBe(true);
    }
    expect(nextStep("reviewing")).toBeNull();
    expect(isTerminal("reviewing")).toBe(false);
  });
  it("cancels only an active run", () => {
    expect(canCancel("queued")).toBe(true);
    expect(canCancel("reviewing")).toBe(true);
    expect(canCancel("approved")).toBe(true);
    expect(canCancel("ready")).toBe(false);
    expect(canCancel("cancelled")).toBe(false);
  });
});
