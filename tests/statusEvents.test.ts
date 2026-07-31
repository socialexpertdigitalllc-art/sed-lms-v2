import { describe, it, expect } from "vitest";
import { statusTimestampPatch } from "@/lib/leads/statusEvents";

const AT = "2026-07-15T10:00:00.000Z";

describe("statusTimestampPatch", () => {
  it("entering Closed stamps closed_at and clears dropped_at", () => {
    expect(statusTimestampPatch("Closed", AT)).toEqual({ closed_at: AT, dropped_at: null });
  });
  it("entering Dropped stamps dropped_at and clears closed_at", () => {
    expect(statusTimestampPatch("Dropped", AT)).toEqual({ closed_at: null, dropped_at: AT });
  });
  it("entering any open status clears both", () => {
    for (const s of ["Ready", "Not Ready", "Long Term"]) {
      expect(statusTimestampPatch(s, AT)).toEqual({ closed_at: null, dropped_at: null });
    }
  });
});
