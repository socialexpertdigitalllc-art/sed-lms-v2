import { describe, it, expect } from "vitest";
import { navCountKey, navCountTone } from "@/lib/nav/counts";

describe("Forms nav badge", () => {
  it("maps /forms to the forms count in the alert palette", () => {
    expect(navCountKey("/forms")).toBe("forms");
    expect(navCountTone("forms")).toBe("alert");
  });
});
