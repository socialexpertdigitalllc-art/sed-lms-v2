import { describe, it, expect } from "vitest";
import { isDeployableStatus } from "@/lib/template-engine/wizard";

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
