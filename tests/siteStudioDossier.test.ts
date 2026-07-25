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

  it("tolerates a lead with nothing but a name", () => {
    const bare = buildDossier({ id: "l2", business_name: "Solo" } as never);
    expect(bare.business_name).toBe("Solo");
    expect(bare.services).toEqual([]);
    expect(bare.phone).toBeUndefined();
    expect(bare.client_photos).toEqual([]);
  });
});

describe("normalisePhone", () => {
  it("builds a tel: href from any format, keeping display text untouched", () => {
    expect(normalisePhone("(303) 555-1234")).toEqual({ display: "(303) 555-1234", href: "tel:3035551234" });
    expect(normalisePhone("+1 303.555.1234")).toEqual({ display: "+1 303.555.1234", href: "tel:+13035551234" });
    expect(normalisePhone(null)).toBeNull();
  });
});
