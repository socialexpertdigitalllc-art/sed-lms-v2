import { describe, it, expect } from "vitest";
import { buildDossier, normalisePhone } from "@/lib/site-studio/run/dossier";

const lead = {
  id: "l1", business_name: "Acme Plumbing", business_phone: "(303) 555-1234",
  business_email: "hi@acme.com", no_email: false, business_profile_link: "https://g.page/acme",
  logo_link: "https://cdn/logo.png", map_embed_link: "https://maps/embed?q=Denver",
  site_type: "Custom Website", services: ["Drain Cleaning", " Water Heaters "],
  service_areas: ["Denver", ""], client_experience: 12, specify_pages: ["Home", "About Us"],
  color_scheme: "navy #0a2540 and orange", about_business: "Family run since 2012.",
  image_links: ["https://cdn/shop.jpg"], design_reference_links: ["https://ref.example"],
  add_ons: [{ id: "a", label: "SEO Boost", price: 100 }],
  price_quoted: 1500, yearly_price: "300", rating: 8, comments: "keen buyer", platform: "cold call",
};

describe("buildDossier", () => {
  const d = buildDossier(lead as never);

  it("carries the client-facing facts", () => {
    expect(d.business_name).toBe("Acme Plumbing");
    expect(d.phone).toBe("(303) 555-1234");
    expect(d.email).toBe("hi@acme.com");
    expect(d.services).toEqual(["Drain Cleaning", "Water Heaters"]); // trimmed
    expect(d.service_areas).toEqual(["Denver"]);                      // empties dropped
    expect(d.years_experience).toBe(12);
    expect(d.about_business).toBe("Family run since 2012.");
    expect(d.add_ons).toEqual(["SEO Boost"]);                         // labels only
    expect(d.client_photos).toEqual(["https://cdn/shop.jpg"]);
  });

  it("NEVER carries commercial or internal fields", () => {
    const json = JSON.stringify(d);
    expect(json).not.toContain("1500");
    expect(json).not.toContain("300");
    expect(json).not.toContain("keen buyer");
    expect(json).not.toContain("cold call");
    expect(d).not.toHaveProperty("rating");
    expect(d).not.toHaveProperty("price_quoted");
  });

  it("treats a missing email as unknown, not as 'no email'", () => {
    expect(buildDossier({ ...lead, business_email: null } as never).email).toBeUndefined();
    expect(buildDossier({ ...lead, business_email: null } as never).no_email).toBe(false);
    expect(buildDossier({ ...lead, business_email: null, no_email: true } as never).no_email).toBe(true);
  });

  it("derives profile_embed from a Google business-profile link (g.page), keeping profile_link too", () => {
    expect(d.profile_link).toBe("https://g.page/acme");
    expect(d.profile_embed).toBe("https://g.page/acme");
  });

  it("tolerates a lead with nothing but a name", () => {
    const bare = buildDossier({ id: "l2", business_name: "Solo" } as never);
    expect(bare.business_name).toBe("Solo");
    expect(bare.services).toEqual([]);
    expect(bare.phone).toBeUndefined();
    expect(bare.client_photos).toEqual([]);
  });
});

describe("buildDossier: profile_embed (Phase 4c, Task 6)", () => {
  const base = { id: "l3", business_name: "Acme Plumbing" };

  it("recognizes a Maps place URL", () => {
    expect(buildDossier({ ...base, business_profile_link: "https://www.google.com/maps/place/Acme+Plumbing/@39.7,-104.9,15z" } as never).profile_embed)
      .toBe("https://www.google.com/maps/place/Acme+Plumbing/@39.7,-104.9,15z");
  });

  it("recognizes goo.gl/maps and maps.app.goo.gl short links", () => {
    expect(buildDossier({ ...base, business_profile_link: "https://goo.gl/maps/AbCd1234" } as never).profile_embed)
      .toBe("https://goo.gl/maps/AbCd1234");
    expect(buildDossier({ ...base, business_profile_link: "https://maps.app.goo.gl/AbCd1234" } as never).profile_embed)
      .toBe("https://maps.app.goo.gl/AbCd1234");
  });

  it("recognizes a business.google.com profile URL", () => {
    expect(buildDossier({ ...base, business_profile_link: "https://business.google.com/dashboard/l/123" } as never).profile_embed)
      .toBe("https://business.google.com/dashboard/l/123");
  });

  it("recognizes a maps.google.com URL", () => {
    expect(buildDossier({ ...base, business_profile_link: "https://maps.google.com/?cid=12345" } as never).profile_embed)
      .toBe("https://maps.google.com/?cid=12345");
  });

  it("is absent when the profile link is not a Google URL", () => {
    expect(buildDossier({ ...base, business_profile_link: "https://www.facebook.com/AcmePlumbing" } as never).profile_embed)
      .toBeUndefined();
    expect(buildDossier({ ...base, business_profile_link: "https://www.yelp.com/biz/acme-plumbing" } as never).profile_embed)
      .toBeUndefined();
  });

  it("is absent when there is no profile link at all", () => {
    expect(buildDossier({ ...base } as never).profile_embed).toBeUndefined();
  });

  it("does not treat a non-maps google.com URL (e.g. a Google Doc) as a profile", () => {
    expect(buildDossier({ ...base, business_profile_link: "https://docs.google.com/document/d/xyz" } as never).profile_embed)
      .toBeUndefined();
  });

  it("is unaffected by a malformed URL (fails safe, never throws)", () => {
    expect(() => buildDossier({ ...base, business_profile_link: "not a url" } as never)).not.toThrow();
    expect(buildDossier({ ...base, business_profile_link: "not a url" } as never).profile_embed).toBeUndefined();
  });

  it("profile_link always keeps the plain link regardless of provider", () => {
    expect(buildDossier({ ...base, business_profile_link: "https://www.facebook.com/AcmePlumbing" } as never).profile_link)
      .toBe("https://www.facebook.com/AcmePlumbing");
  });
});

describe("normalisePhone", () => {
  it("builds a tel: href from any format, keeping display text untouched", () => {
    expect(normalisePhone("(303) 555-1234")).toEqual({ display: "(303) 555-1234", href: "tel:3035551234" });
    expect(normalisePhone("+1 303.555.1234")).toEqual({ display: "+1 303.555.1234", href: "tel:+13035551234" });
    expect(normalisePhone(null)).toBeNull();
  });

  it("truncates at an extension marker for the href, but keeps it in display", () => {
    expect(normalisePhone("(303) 555-1234 ext 2")).toEqual({
      display: "(303) 555-1234 ext 2",
      href: "tel:3035551234",
    });
    expect(normalisePhone("303-555-1234 x99")).toEqual({
      display: "303-555-1234 x99",
      href: "tel:3035551234",
    });
    expect(normalisePhone("303-555-1234 #5")).toEqual({
      display: "303-555-1234 #5",
      href: "tel:3035551234",
    });
  });

  it("keeps the display text but withholds an href for a non-dialable number", () => {
    expect(normalisePhone("555-1234")).toEqual({ display: "555-1234", href: null });
    expect(normalisePhone("1234567")).toEqual({ display: "1234567", href: null });
    expect(normalisePhone("TBD 000-0000")).toEqual({ display: "TBD 000-0000", href: null });
  });

  it("accepts exactly 10 digits, 11 digits leading with 1, or international with a leading +", () => {
    expect(normalisePhone("(303) 555-1234")?.href).toBe("tel:3035551234");
    expect(normalisePhone("+44 20 7946 0958")).toEqual({
      display: "+44 20 7946 0958",
      href: "tel:+442079460958",
    });
  });
});
