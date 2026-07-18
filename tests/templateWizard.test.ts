import { describe, it, expect } from "vitest";
import { isDeployableStatus } from "@/lib/template-engine/wizard";
import {
  activeWizardStep,
  maxReachedStep,
  V2_STATUS_PILL,
  statusPill,
  slotProgress,
} from "@/lib/template-engine/wizard";
import type { ImageSlot } from "@/lib/template-engine/imageSlots";

describe("isDeployableStatus", () => {
  it("accepts the v2 terminal status and the v1 legacy + deployed", () => {
    expect(isDeployableStatus("review")).toBe(true); // v2 build ends here
    expect(isDeployableStatus("ready_for_review")).toBe(true); // v1 legacy rows
    expect(isDeployableStatus("deployed")).toBe(true); // redeploy
  });
  it("rejects every in-flight or failed status", () => {
    for (const s of ["queued", "running", "planning", "curating", "building", "failed"]) {
      expect(isDeployableStatus(s)).toBe(false);
    }
  });
});

describe("activeWizardStep", () => {
  it("maps every status to the step the operator should see", () => {
    expect(activeWizardStep("queued")).toBe(4); // pipeline running → tracker
    expect(activeWizardStep("running")).toBe(4);
    expect(activeWizardStep("planning")).toBe(4);
    expect(activeWizardStep("curating")).toBe(3); // the centrepiece
    expect(activeWizardStep("building")).toBe(4);
    expect(activeWizardStep("review")).toBe(5);
    expect(activeWizardStep("ready_for_review")).toBe(5);
    expect(activeWizardStep("deployed")).toBe(5);
    expect(activeWizardStep("failed")).toBe(4); // tracker shows the failure
  });
});

describe("maxReachedStep", () => {
  it("lets the operator navigate back but never ahead of the pipeline", () => {
    expect(maxReachedStep("planning")).toBe(4); // steps 2-3 have no data yet, tracker visible
    expect(maxReachedStep("curating")).toBe(3); // content + images editable, build not run
    expect(maxReachedStep("building")).toBe(4);
    expect(maxReachedStep("review")).toBe(5);
    expect(maxReachedStep("deployed")).toBe(5);
  });
});

describe("statusPill", () => {
  it("knows every v2 status (v1 board only knew five)", () => {
    for (const s of ["queued", "running", "planning", "curating", "building", "review", "ready_for_review", "deployed", "failed"]) {
      expect(V2_STATUS_PILL[s]).toBeDefined();
      expect(statusPill(s).label.length).toBeGreaterThan(0);
    }
  });
  it("falls back to Queued for unknown strings", () => {
    expect(statusPill("garbage").label).toBe("Queued");
  });
});

describe("slotProgress", () => {
  const slot = (id: string, selected: string[]): ImageSlot => ({
    id, kind: "service", label: id, pick_max: 1, present_max: 5,
    candidates: [], selected, seen_pexels_ids: [],
  });
  it("counts slots with at least one pick", () => {
    const slots = [slot("a", ["u1"]), slot("b", []), slot("c", ["u2"])];
    expect(slotProgress(slots)).toEqual({ chosen: 2, total: 3 });
  });
  it("handles empty", () => {
    expect(slotProgress([])).toEqual({ chosen: 0, total: 0 });
  });
});

import { buildEtaLabel } from "@/lib/template-engine/wizard";
import type { GenStep } from "@/lib/template-engine/types";

describe("buildEtaLabel", () => {
  const step = (over: Partial<GenStep>): GenStep => ({ key: "k", label: "l", status: "pending", ...over });
  const t0 = Date.parse("2026-07-18T12:00:00.000Z");

  it("returns null without an estimate", () => {
    expect(buildEtaLabel([], null, t0)).toBeNull();
    expect(buildEtaLabel([], 0, t0)).toBeNull();
  });
  it("counts down from the earliest running step's started_at + estimate", () => {
    const steps = [
      step({ key: "a", status: "done" }),
      step({ key: "b", status: "running", started_at: "2026-07-18T12:00:00.000Z" }),
      step({ key: "c", status: "running", started_at: "2026-07-18T12:01:00.000Z" }),
    ];
    // 5 min estimate, 1 min elapsed → ~4 min remaining
    expect(buildEtaLabel(steps, 5 * 60000, t0 + 60000)).toBe("~4 min remaining");
  });
  it("floors remaining at 1 min (never ~0 or negative)", () => {
    const steps = [step({ key: "b", status: "running", started_at: "2026-07-18T12:00:00.000Z" })];
    expect(buildEtaLabel(steps, 60000, t0 + 5 * 60000)).toBe("~1 min remaining");
  });
  it("falls back to the typical estimate when no running step has a timestamp", () => {
    const steps = [step({ key: "a", status: "done" }), step({ key: "b", status: "pending" })];
    expect(buildEtaLabel(steps, 3 * 60000, t0)).toBe("~3 min");
  });
});

import { applyToggle } from "@/lib/template-engine/wizard";

describe("applyToggle", () => {
  it("adds a url when under pick_max", () => {
    expect(applyToggle(["a"], "b", 3)).toEqual({ selected: ["a", "b"], full: false });
  });
  it("removes a url that is already selected", () => {
    expect(applyToggle(["a", "b"], "a", 3)).toEqual({ selected: ["b"], full: false });
  });
  it("swaps on a single-pick slot (pick_max 1)", () => {
    expect(applyToggle(["a"], "b", 1)).toEqual({ selected: ["b"], full: false });
  });
  it("reports full when a multi-pick slot is at pick_max", () => {
    expect(applyToggle(["a", "b", "c"], "d", 3)).toEqual({ selected: ["a", "b", "c"], full: true });
  });
  it("deselect still works even when full", () => {
    expect(applyToggle(["a", "b", "c"], "b", 3)).toEqual({ selected: ["a", "c"], full: false });
  });
});
