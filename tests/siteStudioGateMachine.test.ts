import { describe, it, expect } from "vitest";
import { RUN_STATUSES, nextStep, isTerminal, canCancel, awaitingGate, RUNNING_STATUS } from "@/lib/site-studio/run/types";

describe("gate-aware step machine", () => {
  it("declares the 3b statuses (writing is gone; reviewing/approved exist)", () => {
    expect(RUN_STATUSES).toEqual(["queued","preparing","reviewing","approved","rendering","ready","failed","cancelled"]);
  });
  it("walks the machine steps: queued→prepare, preparing→write, approved→render, rendering→finalize", () => {
    expect(nextStep("queued")).toBe("prepare");
    expect(nextStep("preparing")).toBe("write");
    expect(nextStep("approved")).toBe("render");
    expect(nextStep("rendering")).toBe("finalize");
  });
  it("REVIEWING is a park: no machine step may advance it — only the approve action", () => {
    expect(nextStep("reviewing")).toBeNull();
    expect(awaitingGate("reviewing")).toBe(true);
    expect(awaitingGate("preparing")).toBe(false);
  });
  it("terminal statuses are unchanged and cancellable set includes the gate", () => {
    for (const s of ["ready","failed","cancelled"] as const) expect(isTerminal(s)).toBe(true);
    expect(canCancel("reviewing")).toBe(true);
    expect(canCancel("approved")).toBe(true);
    expect(canCancel("ready")).toBe(false);
  });
  it("RUNNING_STATUS has no entry pointing at the dead 'writing' status", () => {
    expect(Object.values(RUNNING_STATUS)).not.toContain("writing");
  });
});
