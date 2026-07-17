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
