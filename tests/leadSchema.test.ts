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

describe("createLeadSchema polish-3 fields", () => {
  const base = { business_name: "Acme", status: "Not Ready" };

  it("accepts up to 3 design reference urls", () => {
    const r = createLeadSchema.safeParse({
      ...base,
      design_reference_links: ["https://a.com", "https://b.com"],
    });
    expect(r.success).toBe(true);
    if (r.success)
      expect(r.data.design_reference_links).toEqual(["https://a.com", "https://b.com"]);
  });

  it("rejects more than 3 design reference urls", () => {
    const r = createLeadSchema.safeParse({
      ...base,
      design_reference_links: [
        "https://a.com",
        "https://b.com",
        "https://c.com",
        "https://d.com",
      ],
    });
    expect(r.success).toBe(false);
  });

  it("rejects a non-url design reference link", () => {
    const r = createLeadSchema.safeParse({ ...base, design_reference_links: ["not-a-url"] });
    expect(r.success).toBe(false);
  });

  it("accepts an add_ons snapshot array", () => {
    const r = createLeadSchema.safeParse({
      ...base,
      add_ons: [{ id: "x", label: "Live Chat", price: 50 }],
    });
    expect(r.success).toBe(true);
    if (r.success) expect(r.data.add_ons).toEqual([{ id: "x", label: "Live Chat", price: 50 }]);
  });

  it("accepts the boolean flags and closed_by", () => {
    const r = createLeadSchema.safeParse({
      ...base,
      no_email: true,
      logo_via_sms: true,
      color_same_as_logo: true,
      closed_by: "11111111-1111-4111-8111-111111111111",
    });
    expect(r.success).toBe(true);
    if (r.success) {
      expect(r.data.no_email).toBe(true);
      expect(r.data.logo_via_sms).toBe(true);
      expect(r.data.color_same_as_logo).toBe(true);
      expect(r.data.closed_by).toBe("11111111-1111-4111-8111-111111111111");
    }
  });

  it("rejects a non-uuid closed_by", () => {
    const r = createLeadSchema.safeParse({ ...base, closed_by: "not-a-uuid" });
    expect(r.success).toBe(false);
  });
});
