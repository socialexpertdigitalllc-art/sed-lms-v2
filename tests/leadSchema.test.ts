import { describe, it, expect } from "vitest";
import { createLeadSchema, updateLeadSchema } from "@/lib/leads/schema";

describe("createLeadSchema", () => {
  it("requires a business name", () => {
    const r = createLeadSchema.safeParse({ status: "Not Ready", business_name: "" });
    expect(r.success).toBe(false);
  });

  it("coerces a numeric string price to a number", () => {
    const r = createLeadSchema.safeParse({
      business_name: "Acme",
      status: "Not Ready",
      price_quoted: "750",
    });
    expect(r.success).toBe(true);
    if (r.success) expect(r.data.price_quoted).toBe(750);
  });

  it("turns an empty price string into null (not 0)", () => {
    const r = createLeadSchema.safeParse({
      business_name: "Acme",
      status: "Not Ready",
      price_quoted: "",
    });
    expect(r.success).toBe(true);
    if (r.success) expect(r.data.price_quoted).toBeNull();
  });

  it("rejects an out-of-range rating", () => {
    const r = createLeadSchema.safeParse({
      business_name: "Acme",
      status: "Ready",
      rating: 15,
    });
    expect(r.success).toBe(false);
  });

  it("accepts a valid lead with arrays", () => {
    const r = createLeadSchema.safeParse({
      business_name: "Acme",
      status: "Ready",
      site_type: "Custom Website",
      services: ["SEO", "Web"],
      rating: 8,
    });
    expect(r.success).toBe(true);
  });
});

describe("updateLeadSchema", () => {
  it("allows a partial update (status only)", () => {
    const r = updateLeadSchema.safeParse({ status: "Closed" });
    expect(r.success).toBe(true);
  });
});
