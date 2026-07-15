import { describe, it, expect } from "vitest";
import { navCountKey, navCountTone } from "@/lib/nav/counts";

describe("navCountKey", () => {
  it("maps known nav hrefs to their count keys", () => {
    expect(navCountKey("/leads")).toBe("leads");
    expect(navCountKey("/leads/follow-ups")).toBe("followups");
    expect(navCountKey("/tickets")).toBe("tickets");
    expect(navCountKey("/feedback")).toBe("feedback");
    expect(navCountKey("/payments")).toBe("payments");
    expect(navCountKey("/pre-leads/all")).toBe("preleads");
    expect(navCountKey("/admin/users")).toBe("users");
    expect(navCountKey("/admin/departments")).toBe("departments");
    expect(navCountKey("/admin/add-ons")).toBe("addons");
  });

  it("returns undefined for rows without a badge", () => {
    expect(navCountKey("/dashboard")).toBeUndefined();
    expect(navCountKey("/notifications")).toBeUndefined();
    expect(navCountKey("/pre-leads")).toBeUndefined();
    expect(navCountKey("/by-agent")).toBeUndefined();
    expect(navCountKey("/unknown")).toBeUndefined();
  });
});

describe("navCountTone", () => {
  it("flags overdue/unresolved/open work as alert", () => {
    expect(navCountTone("followups")).toBe("alert");
    expect(navCountTone("tickets")).toBe("alert");
    expect(navCountTone("feedback")).toBe("alert");
  });

  it("keeps neutral counts default", () => {
    expect(navCountTone("leads")).toBe("default");
    expect(navCountTone("preleads")).toBe("default");
    expect(navCountTone("payments")).toBe("default");
    expect(navCountTone("users")).toBe("default");
    expect(navCountTone(undefined)).toBe("default");
  });
});
