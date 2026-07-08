import { describe, it, expect } from "vitest";
import { normPhone, normEmail, normName, findCollisions } from "@/lib/leads/duplicate";

describe("normalizers", () => {
  it("phone → digits only", () => expect(normPhone("(252) 401-2775")).toBe("2524012775"));
  it("email → lowercased trimmed", () => expect(normEmail("  A@B.COM ")).toBe("a@b.com"));
  it("name → lowercased trimmed", () => expect(normName("  Acme Co ")).toBe("acme co"));
});

describe("findCollisions", () => {
  const rows = [{ id: "1", business_name: "Acme Co", phone: "(252) 401-2775", email: "a@b.com", owner: "u1", ownerName: "Jane" }];
  const input = { business_name: "acme co", phone: "252-401-2775", email: "x@y.com" };
  it("flags name + phone match, not email", () => {
    const c = findCollisions(input, rows, "me");
    expect(c.find(x => x.field === "business_name")).toBeTruthy();
    expect(c.find(x => x.field === "phone")).toBeTruthy();
    expect(c.find(x => x.field === "email")).toBeFalsy();
  });
  it("reports owner + isOwn", () => {
    const c = findCollisions(input, rows, "u1");
    expect(c[0].ownerDisplayName).toBe("Jane");
    expect(c[0].isOwn).toBe(true);
  });
  it("skips empty input fields", () => {
    expect(findCollisions({ business_name: "", phone: "", email: "" }, rows, "me")).toHaveLength(0);
  });
});
