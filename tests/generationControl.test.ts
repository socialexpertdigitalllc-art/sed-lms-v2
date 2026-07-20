import { describe, it, expect } from "vitest";
import {
  interpretControl,
  isPausableStatus,
  isCancellableStatus,
  isAtRestStatus,
  resumeTarget,
  shouldSkipClaimed,
  PAUSABLE_STATUSES,
  CANCELLABLE_STATUSES,
  AT_REST_STATUSES,
} from "@/lib/template-engine/control";
import type { GenStep } from "@/lib/template-engine/types";

const step = (key: string, status: GenStep["status"] = "done"): GenStep => ({ key, label: key, status });

describe("interpretControl", () => {
  it("recognises the two halting flags", () => {
    expect(interpretControl("pause")).toBe("pause");
    expect(interpretControl("cancel")).toBe("cancel");
  });
  it("tolerates casing and surrounding whitespace", () => {
    expect(interpretControl("  Pause ")).toBe("pause");
    expect(interpretControl("CANCEL")).toBe("cancel");
  });
  it("fails open: anything unrecognised means run normally", () => {
    for (const v of [null, undefined, "", "   ", "stop", "paused", 1, {}, [], true]) {
      expect(interpretControl(v)).toBe("continue");
    }
  });
});

describe("status sets", () => {
  it("pauses only running-ish runs", () => {
    for (const s of PAUSABLE_STATUSES) expect(isPausableStatus(s)).toBe(true);
    for (const s of ["curating", "review", "deployed", "failed", "paused", "cancelled"]) {
      expect(isPausableStatus(s)).toBe(false);
    }
  });
  it("cancels anything not already finished", () => {
    for (const s of CANCELLABLE_STATUSES) expect(isCancellableStatus(s)).toBe(true);
    for (const s of ["review", "ready_for_review", "deployed", "failed", "cancelled"]) {
      expect(isCancellableStatus(s)).toBe(false);
    }
  });
  it("knows which statuses have no runner polling the flag", () => {
    for (const s of AT_REST_STATUSES) expect(isAtRestStatus(s)).toBe(true);
    // These have a live runner; the route must NOT transition them itself.
    for (const s of ["running", "planning", "building"]) expect(isAtRestStatus(s)).toBe(false);
  });
});

describe("resumeTarget", () => {
  const planned = { brief: { business_name: "X" }, content_model: { services: [] } };

  it("resumes the build phase when the run had reached it", () => {
    expect(
      resumeTarget({ ...planned, image_slots: [{ id: "a" }], steps: [step("plan"), step("prepare")] }),
    ).toEqual({ status: "building", enqueue: "build" });
  });
  it("treats a per-file build step as the build phase too", () => {
    expect(
      resumeTarget({ ...planned, image_slots: [{ id: "a" }], steps: [step("plan"), step("build:index.html", "pending")] }),
    ).toEqual({ status: "building", enqueue: "build" });
  });
  it("hands a fully-planned run back to the operator at curation, with no queue row", () => {
    expect(
      resumeTarget({ ...planned, image_slots: [{ id: "a" }], steps: [step("plan"), step("images")] }),
    ).toEqual({ status: "curating", enqueue: null });
  });
  it("re-plans from scratch when the content model never landed", () => {
    expect(resumeTarget({ brief: { b: 1 }, content_model: null, image_slots: null, steps: [] })).toEqual({
      status: "queued",
      enqueue: "plan",
    });
  });
  it("re-plans when the model landed but no image slots did (paused mid-plan)", () => {
    expect(resumeTarget({ ...planned, image_slots: [], steps: [step("plan")] })).toEqual({
      status: "queued",
      enqueue: "plan",
    });
  });
  it("re-plans when image_slots is not an array at all", () => {
    expect(resumeTarget({ ...planned, image_slots: "nonsense", steps: [step("plan")] })).toEqual({
      status: "queued",
      enqueue: "plan",
    });
  });
});

describe("shouldSkipClaimed", () => {
  it("drops a claimed row whose generation is already at rest", () => {
    expect(shouldSkipClaimed("paused", null)).toBe(true);
    expect(shouldSkipClaimed("cancelled", null)).toBe(true);
  });
  it("drops a claimed row that has a pending stop flag", () => {
    expect(shouldSkipClaimed("queued", "pause")).toBe(true);
    expect(shouldSkipClaimed("queued", "cancel")).toBe(true);
  });
  it("runs a normal queued row", () => {
    expect(shouldSkipClaimed("queued", null)).toBe(false);
    expect(shouldSkipClaimed("building", "")).toBe(false);
    expect(shouldSkipClaimed("curating", "garbage")).toBe(false);
  });
});
