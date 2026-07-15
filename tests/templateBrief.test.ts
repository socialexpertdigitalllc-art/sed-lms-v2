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
  });
  it("omits empty/null values rather than emitting nulls", () => {
    const b = buildBrief({ ...(lead as object), comments: null, logo_link: null } as never);
    expect(b.notes).toBeUndefined();
    expect(b.logo_link).toBeUndefined();
  });
  it("uses the logo as the colour source when color_same_as_logo", () => {
    const b = buildBrief({ ...(lead as object), color_same_as_logo: true } as never);
    expect(b.color_scheme).toBe("match the logo");
  });
  it("is JSON-serialisable and stable", () => {
    expect(() => JSON.stringify(buildBrief(lead))).not.toThrow();
  });
});
