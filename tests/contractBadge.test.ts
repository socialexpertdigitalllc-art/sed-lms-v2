import { describe, it, expect } from "vitest";
import { sentContractLeadIds } from "@/lib/contracts/badge";

describe("sentContractLeadIds", () => {
  it("returns the set of lead ids with at least one sent contract", () => {
    const rows = [
      { lead_id: "a", status: "sent" },
      { lead_id: "b", status: "draft" },
      { lead_id: "a", status: "draft" },
      { lead_id: "c", status: "sent" },
    ];
    const s = sentContractLeadIds(rows);
    expect(s.has("a")).toBe(true);
    expect(s.has("c")).toBe(true);
    expect(s.has("b")).toBe(false);
    expect(s.size).toBe(2);
  });
  it("handles an empty input", () => {
    expect(sentContractLeadIds([]).size).toBe(0);
  });
});
