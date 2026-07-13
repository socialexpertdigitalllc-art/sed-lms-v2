import { describe, it, expect } from "vitest";
import { stripUnreadPrefix, withUnreadPrefix } from "@/lib/notifications/tabBadge";

describe("stripUnreadPrefix", () => {
  it("strips a leading (n) prefix", () => {
    expect(stripUnreadPrefix("(3) Leads — SED LMS")).toBe("Leads — SED LMS");
  });
  it("leaves titles without a prefix untouched", () => {
    expect(stripUnreadPrefix("Leads — SED LMS")).toBe("Leads — SED LMS");
  });
  it("does not strip parenthesised text that is not a count", () => {
    expect(stripUnreadPrefix("(beta) Dashboard")).toBe("(beta) Dashboard");
  });
});

describe("withUnreadPrefix", () => {
  it("adds a prefix when total > 0", () => {
    expect(withUnreadPrefix("Dashboard", 4)).toBe("(4) Dashboard");
  });
  it("replaces an existing prefix without stacking", () => {
    expect(withUnreadPrefix("(2) Dashboard", 7)).toBe("(7) Dashboard");
  });
  it("removes the prefix at 0", () => {
    expect(withUnreadPrefix("(5) Dashboard", 0)).toBe("Dashboard");
  });
  it("keeps a plain title unchanged at 0", () => {
    expect(withUnreadPrefix("Dashboard", 0)).toBe("Dashboard");
  });
});
