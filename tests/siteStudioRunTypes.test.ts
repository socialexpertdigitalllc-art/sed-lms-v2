import { describe, it, expect } from "vitest";
import { RUN_STATUSES, STEP_ORDER, nextStep, isTerminal, isEditable, canCancel } from "@/lib/site-studio/run/types";

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

/**
 * Blocker 1 (Phase 4b): `content`, `revert`, `theme`, `reroll`, and `images`
 * each used to gate an operator edit on `!isTerminal(status)` — which
 * refuses "ready" too, since `isTerminal` includes it. That made every Gate 2
 * edit 409 in the real app, because `RunPreview`/`ThemePanel` (Gate 2) only
 * ever mount once a run IS "ready". `isEditable` is the fix: Gate 1
 * ("reviewing") and Gate 2 ("ready") are editable; the machine-owned
 * in-between statuses and the two dead terminal ones are not.
 */
describe("isEditable", () => {
  it("accepts reviewing (Gate 1) and ready (Gate 2)", () => {
    expect(isEditable("reviewing")).toBe(true);
    expect(isEditable("ready")).toBe(true);
  });
  it("rejects the dead terminal statuses", () => {
    expect(isEditable("failed")).toBe(false);
    expect(isEditable("cancelled")).toBe(false);
  });
  it("rejects the machine-owned in-between statuses", () => {
    expect(isEditable("queued")).toBe(false);
    expect(isEditable("preparing")).toBe(false);
    expect(isEditable("approved")).toBe(false);
    expect(isEditable("rendering")).toBe(false);
  });
  it("is not the same predicate as !isTerminal — ready is editable but IS terminal", () => {
    expect(isTerminal("ready")).toBe(true);
    expect(isEditable("ready")).toBe(true);
  });
});
