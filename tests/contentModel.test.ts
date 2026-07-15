import { describe, it, expect } from "vitest";
import { contentModelSchema, emptyContentModel } from "@/lib/template-engine/contentModel";

const valid = {
  identity: { name: "Inside Out Painting", tagline: "Done once, done right",
    positioning: "Cost-effective professional painting", phone: "(631) 334-4032",
    email: "hi@x.com", areas: ["Brentwood, NY"], years: 20, license_line: "Licensed · Insured" },
  hero: { eyebrow: "NOW BOOKING", headline_parts: ["Beautifully", "painted", "interiors"],
    subcopy: "Professional painting for Brentwood.", cta_primary: "Get a free estimate",
    cta_secondary: "Call (631) 334-4032" },
  services: [{ key: "interior-painting", name: "Interior Painting", short: "Crisp lines",
    long: "Full interior repaints.", bullets: ["Walls", "Trim"], image_query: "freshly painted interior wall" }],
  stats: [{ value: "20+", label: "Years experience" }],
  testimonials: [{ quote: "Great work", name: "M. R.", meta: "Interior · Brentwood", initials: "MR" }],
  faq: [{ q: "Do you offer free estimates?", a: "Yes." }],
  about: { story: "Family run since 2005.", why_us: ["No subcontractors"] },
  pages: { "index.html": { title: "Inside Out Painting", meta_description: "Painting in Brentwood" } },
  image_briefs: [{ slot_id: "hero-1", kind: "hero", query: "freshly painted living room", must_show: "clean interior", avoid: "people" }],
};

describe("contentModelSchema", () => {
  it("accepts a complete model", () => {
    expect(contentModelSchema.safeParse(valid).success).toBe(true);
  });
  it("rejects a model with no services (the site would be empty)", () => {
    expect(contentModelSchema.safeParse({ ...valid, services: [] }).success).toBe(false);
  });
  it("rejects a missing identity name", () => {
    const bad = { ...valid, identity: { ...valid.identity, name: "" } };
    expect(contentModelSchema.safeParse(bad).success).toBe(false);
  });
  it("requires each service to carry an image_query for slot building", () => {
    const bad = { ...valid, services: [{ ...valid.services[0], image_query: "" }] };
    expect(contentModelSchema.safeParse(bad).success).toBe(false);
  });
  it("emptyContentModel() is a valid starting shape for the editor", () => {
    expect(() => emptyContentModel("Acme")).not.toThrow();
    expect(emptyContentModel("Acme").identity.name).toBe("Acme");
  });
});
