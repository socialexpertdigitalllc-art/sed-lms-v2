import { describe, it, expect } from "vitest";
import { pruneBuildPhaseSteps } from "@/lib/template-engine/runnerV2";
import type { GenStep } from "@/lib/template-engine/types";

function step(key: string, status: GenStep["status"] = "done"): GenStep {
  return { key, label: key, status };
}

describe("pruneBuildPhaseSteps", () => {
  it("strips all build- and deploy-phase keys", () => {
    const steps: GenStep[] = [
      step("plan"),
      step("images"),
      step("curate"),
      step("prepare"),
      step("build:index.html"),
      step("build:about.html"),
      step("verify"),
      step("finalize"),
      step("deploy:subdomain"),
      step("deploy:upload"),
      step("deploy:verify"),
      step("deploy:link"),
    ];
    const pruned = pruneBuildPhaseSteps(steps);
    expect(pruned.map((s) => s.key)).toEqual(["plan", "images", "curate"]);
  });

  it("keeps plan-phase keys untouched, including a still-running one", () => {
    const steps: GenStep[] = [step("plan"), step("images"), step("curate", "running")];
    const pruned = pruneBuildPhaseSteps(steps);
    expect(pruned).toEqual(steps);
  });

  it("is safe on an empty array", () => {
    expect(pruneBuildPhaseSteps([])).toEqual([]);
  });

  it("does not mutate the input array", () => {
    const steps: GenStep[] = [step("plan"), step("prepare")];
    const pruned = pruneBuildPhaseSteps(steps);
    expect(steps).toHaveLength(2);
    expect(pruned).toHaveLength(1);
  });
});
