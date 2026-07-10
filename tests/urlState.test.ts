import { describe, it, expect } from "vitest";
import { buildQuery } from "@/lib/url/buildQuery";

const D = { q: "", status: "All", region: "", page: "0" };

describe("buildQuery", () => {
  it("sets a non-default key", () => expect(buildQuery("", D, { status: "Ready" })).toBe("status=Ready"));
  it("drops a key set back to its default", () => expect(buildQuery("status=Ready", D, { status: "All" })).toBe(""));
  it("drops an emptied key", () => expect(buildQuery("q=cafe", D, { q: "" })).toBe(""));
  it("merges patch while preserving existing keys", () => {
    const p = new URLSearchParams(buildQuery("status=Ready", D, { q: "cafe" }));
    expect(p.get("status")).toBe("Ready");
    expect(p.get("q")).toBe("cafe");
  });
  it("preserves a comma-joined region value", () =>
    expect(new URLSearchParams(buildQuery("", D, { region: "California,Texas" })).get("region")).toBe("California,Texas"));
});
