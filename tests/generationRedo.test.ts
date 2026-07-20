import { describe, it, expect } from "vitest";
import {
  REDOABLE_STEPS,
  REDO_STEP_ORDER,
  canRedoFrom,
  clearStale,
  describeImagesRedoLoss,
  isBuildPhaseStepKey,
  isRedoBlockedByRun,
  isRedoStepKey,
  isStale,
  markStale,
  parseStaleSteps,
  queuePhaseFor,
  redoRejectionReason,
  redoSpec,
  resetStepsForRedo,
  sameStale,
  staleNote,
  type RedoStepKey,
} from "@/lib/template-engine/redo";
import type { GenStep } from "@/lib/template-engine/types";

const step = (key: string, status: GenStep["status"] = "done"): GenStep => ({ key, label: key, status });

describe("the redo table", () => {
  it("covers exactly the three redoable steps, in pipeline order", () => {
    expect(REDO_STEP_ORDER).toEqual(["content", "images", "build"]);
    expect(REDOABLE_STEPS.map((s) => s.key)).toEqual(["content", "images", "build"]);
  });

  it("invalidates only the steps DOWNSTREAM of the one redone", () => {
    expect(redoSpec("content")!.invalidates).toEqual(["images", "build"]);
    expect(redoSpec("images")!.invalidates).toEqual(["build"]);
    expect(redoSpec("build")!.invalidates).toEqual([]);
  });

  it("never invalidates itself or anything upstream", () => {
    for (const spec of REDOABLE_STEPS) {
      const self = REDO_STEP_ORDER.indexOf(spec.key);
      for (const k of spec.invalidates) {
        expect(REDO_STEP_ORDER.indexOf(k)).toBeGreaterThan(self);
      }
    }
  });

  it("marks ONLY the images redo destructive — it is the one that discards curation", () => {
    expect(redoSpec("images")!.destructive).toBe(true);
    expect(redoSpec("content")!.destructive).toBe(false);
    // The rebuild reads content_model/image_slots; it never writes them, so no
    // operator input is at risk.
    expect(redoSpec("build")!.destructive).toBe(false);
  });

  it("enqueues a queue kind per step", () => {
    expect(REDOABLE_STEPS.map((s) => s.queueKind)).toEqual(["content", "images", "build"]);
  });

  it("recognises only the three keys", () => {
    for (const k of ["content", "images", "build"]) expect(isRedoStepKey(k)).toBe(true);
    for (const k of ["plan", "curate", "deploy", "", null, undefined, 1, {}]) expect(isRedoStepKey(k)).toBe(false);
    expect(redoSpec("plan")).toBeUndefined();
  });
});

describe("status eligibility", () => {
  it("allows content + images from every at-rest status", () => {
    for (const s of ["curating", "review", "failed", "cancelled", "paused"]) {
      expect(canRedoFrom("content", s)).toBe(true);
      expect(canRedoFrom("images", s)).toBe(true);
    }
  });

  it("allows build only once a build has been attempted", () => {
    for (const s of ["review", "failed", "cancelled"]) expect(canRedoFrom("build", s)).toBe(true);
    // curating has /build; a run paused mid-build has /resume, which already
    // re-runs the build from prepare.
    for (const s of ["curating", "paused"]) expect(canRedoFrom("build", s)).toBe(false);
  });

  it("refuses every step while a run is actually in flight", () => {
    for (const s of ["running", "planning", "building", "queued"]) {
      for (const k of REDO_STEP_ORDER) expect(canRedoFrom(k, s)).toBe(false);
    }
  });

  it("never redoes a live site out from under a deployment", () => {
    for (const k of REDO_STEP_ORDER) expect(canRedoFrom(k, "deployed")).toBe(false);
  });

  it("refuses an unknown step from any status", () => {
    expect(canRedoFrom("plan", "curating")).toBe(false);
    expect(canRedoFrom("", "review")).toBe(false);
  });

  it("knows which refusals should say 'pause it first'", () => {
    for (const s of ["running", "planning", "building"]) expect(isRedoBlockedByRun(s)).toBe(true);
    for (const s of ["queued", "curating", "paused", "review"]) expect(isRedoBlockedByRun(s)).toBe(false);
    expect(redoRejectionReason("content", "building")).toContain("pause it first");
    expect(redoRejectionReason("build", "curating")).toContain("cannot be redone");
    expect(redoRejectionReason("nope", "curating")).toContain("Unknown step");
  });
});

describe("markStale", () => {
  it("marks images AND build stale when the content is re-planned", () => {
    expect(markStale(null, "content")).toEqual(["images", "build"]);
  });

  it("marks only build stale when the images are re-gathered", () => {
    expect(markStale(null, "images")).toEqual(["build"]);
  });

  it("marks nothing when the build itself is redone — there is nothing after it", () => {
    expect(markStale(null, "build")).toEqual([]);
  });

  it("clears the redone step's own mark: its output is about to be replaced", () => {
    expect(markStale(["images", "build"], "images")).toEqual(["build"]);
    expect(markStale(["build"], "build")).toEqual([]);
  });

  it("is idempotent and order-independent", () => {
    expect(markStale(markStale(null, "content"), "content")).toEqual(["images", "build"]);
    expect(markStale(["build", "images"], "content")).toEqual(["images", "build"]);
  });

  it("keeps marks it did not touch", () => {
    // build was already stale from an earlier content redo; re-gathering images
    // must not un-stale it.
    expect(markStale(["build"], "images")).toEqual(["build"]);
  });

  it("drops junk already in the column", () => {
    expect(markStale(["plan", 7, null, "build"], "images")).toEqual(["build"]);
    expect(markStale("not an array", "images")).toEqual(["build"]);
  });
});

describe("clearStale", () => {
  it("clears only the step that just re-ran", () => {
    expect(clearStale(["images", "build"], "images")).toEqual(["build"]);
    expect(clearStale(["images", "build"], "build")).toEqual(["images"]);
  });

  it("is a no-op when the step was not stale", () => {
    expect(clearStale(["build"], "images")).toEqual(["build"]);
    expect(clearStale(null, "build")).toEqual([]);
  });

  it("round-trips with markStale: redo content, then redo both downstream steps", () => {
    let stale = markStale(null, "content");
    expect(stale).toEqual(["images", "build"]);
    stale = clearStale(stale, "images"); // the images redo finished
    expect(stale).toEqual(["build"]);
    stale = clearStale(stale, "build"); // the rebuild finished
    expect(stale).toEqual([]);
  });
});

describe("stale helpers", () => {
  it("parses the column defensively and canonically", () => {
    expect(parseStaleSteps(null)).toEqual([]);
    expect(parseStaleSteps(undefined)).toEqual([]);
    expect(parseStaleSteps(["build", "images"])).toEqual(["images", "build"]);
    expect(parseStaleSteps(["build", "junk", 3])).toEqual(["build"]);
  });

  it("answers isStale per step", () => {
    expect(isStale(["build"], "build")).toBe(true);
    expect(isStale(["build"], "images")).toBe(false);
    expect(isStale(null, "build")).toBe(false);
  });

  it("compares sets so a no-op write can be skipped", () => {
    expect(sameStale([], [])).toBe(true);
    expect(sameStale(["build"], ["build"])).toBe(true);
    expect(sameStale(["build"], [])).toBe(false);
    expect(sameStale(["images", "build"], ["build", "images"] as RedoStepKey[])).toBe(false);
  });

  it("explains each stale marker in plain words", () => {
    expect(staleNote("images")).toContain("content was regenerated");
    expect(staleNote("build")).toContain("built");
  });
});

describe("resetStepsForRedo", () => {
  const timeline: GenStep[] = [
    step("plan"),
    step("images"),
    step("curate"),
    step("prepare"),
    step("build:index.html"),
    step("verify"),
    step("finalize"),
    step("deploy:upload"),
  ];

  it("content clears only its own plan entry (and the curate marker it re-adds)", () => {
    expect(resetStepsForRedo(timeline, "content").map((s) => s.key)).toEqual([
      "images", "prepare", "build:index.html", "verify", "finalize", "deploy:upload",
    ]);
  });

  it("images clears only its own entry (and the curate marker it re-adds)", () => {
    expect(resetStepsForRedo(timeline, "images").map((s) => s.key)).toEqual([
      "plan", "prepare", "build:index.html", "verify", "finalize", "deploy:upload",
    ]);
  });

  it("build clears the whole build/deploy phase and nothing else", () => {
    expect(resetStepsForRedo(timeline, "build").map((s) => s.key)).toEqual(["plan", "images", "curate"]);
  });

  it("never touches the steps a surgical redo is leaving alone", () => {
    // The plan entry survives an images redo — that is the whole point.
    expect(resetStepsForRedo(timeline, "images").some((s) => s.key === "plan")).toBe(true);
    // The images entry survives a content redo.
    expect(resetStepsForRedo(timeline, "content").some((s) => s.key === "images")).toBe(true);
  });

  it("classifies build-phase keys the same way the runner's prune does", () => {
    for (const k of ["prepare", "verify", "finalize", "build:index.html", "deploy:link"]) {
      expect(isBuildPhaseStepKey(k)).toBe(true);
    }
    for (const k of ["plan", "images", "curate", "building"]) expect(isBuildPhaseStepKey(k)).toBe(false);
  });

  it("tolerates an empty timeline", () => {
    expect(resetStepsForRedo([], "build")).toEqual([]);
  });
});

describe("describeImagesRedoLoss", () => {
  const slot = (selected: string[], sources: string[] = []) => ({
    selected,
    candidates: sources.map((source) => ({ source })),
  });

  it("counts the slots, the picks and the custom URLs about to be destroyed", () => {
    const msg = describeImagesRedoLoss([
      slot(["a"], ["pexels", "custom"]),
      slot(["b"], ["pexels"]),
      slot([], ["pexels"]),
    ]);
    expect(msg).toContain("This replaces all candidates and clears your current selections for 3 slots.");
    expect(msg).toContain("2 slots have a picked image");
    expect(msg).toContain("1 custom URL you added");
    expect(msg).toContain("no undo");
  });

  it("says plainly when there is nothing to lose", () => {
    const msg = describeImagesRedoLoss([slot([], ["pexels"])]);
    expect(msg).toContain("1 slot.");
    expect(msg).toContain("nothing to lose");
  });

  it("singularises one picked slot and one custom URL", () => {
    const msg = describeImagesRedoLoss([slot(["a"], ["custom"])]);
    expect(msg).toContain("1 slot has a picked image");
    expect(msg).toContain("1 custom URL you added");
  });
});

describe("queuePhaseFor", () => {
  it("maps the redo kinds to single-step phases", () => {
    expect(queuePhaseFor("content")).toBe("content");
    expect(queuePhaseFor("images")).toBe("images");
    expect(queuePhaseFor("build")).toBe("build");
  });

  it("keeps every legacy/unknown kind on the full plan phase", () => {
    for (const k of ["plan", null, undefined, "", "nonsense", 7]) expect(queuePhaseFor(k)).toBe("full");
  });
});
