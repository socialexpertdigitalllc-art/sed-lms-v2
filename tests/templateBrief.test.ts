import { describe, it, expect } from "vitest";
import { buildBrief } from "@/lib/template-engine/brief";

const lead = {
  id: "l1",
  business_name: "Inside Out Painting",
  business_phone: "(631) 334-4032",
  business_email: "hi@example.com",
  site_type: "Custom Website",
  services: ["Interior Painting", "Floor Install"],
  service_areas: ["Brentwood, NY"],
  client_experience: 20,
  comments: "Family run, very responsive",
  color_scheme: "navy and white",
  color_same_as_logo: false,
  logo_link: "https://x.com/logo.png",
  image_links: ["https://x.com/a.jpg", "https://x.com/b.jpg"],
  design_reference_links: ["https://ref.com/a", "https://ref.com/b"],
  no_email: false,
  rating: 9,
  add_ons: [{ id: "a1", label: "Live Chat", price: 50 }],
  num_webpages: 6,
  specify_pages: ["Home", "About Us"],
  business_profile_link: "https://maps.google.com/x",
  map_embed_link: "<iframe src='https://maps'></iframe>",
  reference_link: null,
} as never;

describe("buildBrief", () => {
  it("carries the rich fields v1 dropped", () => {
    const b = buildBrief(lead);
    expect(b.business_name).toBe("Inside Out Painting");
    expect(b.years_experience).toBe(20);
    expect(b.notes).toBe("Family run, very responsive");
    expect(b.color_scheme).toBe("navy and white");
    expect(b.logo_link).toBe("https://x.com/logo.png");
    expect(b.client_photos).toEqual(["https://x.com/a.jpg", "https://x.com/b.jpg"]);
    expect(b.service_areas).toEqual(["Brentwood, NY"]);
    expect(b.services).toEqual(["Interior Painting", "Floor Install"]);
    expect(b.design_references).toEqual(["https://ref.com/a", "https://ref.com/b"]);
    expect(b.no_email).toBe(false);
  });
  it("keeps no_email true so email CTAs can be rewritten to phone", () => {
    const b = buildBrief({ ...(lead as object), no_email: true } as never);
    expect(b.no_email).toBe(true);
  });
  it("defaults no_email to false when the lead never set it", () => {
    expect(buildBrief({ ...(lead as object), no_email: null } as never).no_email).toBe(false);
    expect(buildBrief({ ...(lead as object), no_email: undefined } as never).no_email).toBe(false);
  });
  it("defaults design_references to [] when the lead has none", () => {
    expect(
      buildBrief({ ...(lead as object), design_reference_links: null } as never).design_references
    ).toEqual([]);
    expect(
      buildBrief({ ...(lead as object), design_reference_links: undefined } as never)
        .design_references
    ).toEqual([]);
  });
  it("omits empty/null values rather than emitting nulls", () => {
    const b = buildBrief({ ...(lead as object), comments: null, logo_link: null } as never);
    expect(b.notes).toBeUndefined();
    expect(b.logo_link).toBeUndefined();
  });
  it("uses the logo as the colour source only when no colours were recorded", () => {
    const b = buildBrief({
      ...(lead as object),
      color_same_as_logo: true,
      color_scheme: null,
    } as never);
    expect(b.color_scheme).toBe("match the logo");
  });
  it("prefers an explicit colour scheme over the legacy same-as-logo flag", () => {
    const b = buildBrief({ ...(lead as object), color_same_as_logo: true } as never);
    expect(b.color_scheme).toBe("navy and white");
  });
  it("is JSON-serialisable and stable", () => {
    expect(() => JSON.stringify(buildBrief(lead))).not.toThrow();
  });
});
