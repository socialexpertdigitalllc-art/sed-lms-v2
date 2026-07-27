import { describe, it, expect } from "vitest";
import { leadCopyText } from "@/lib/leads/copyText";
import type { Lead } from "@/lib/leads/types";

function lead(overrides: Partial<Lead> = {}): Lead {
  return {
    id: "l1",
    status: "Ready",
    agent_id: null,
    business_name: "Acme Plumbing",
    business_phone: null,
    business_email: null,
    no_email: null,
    business_profile_link: null,
    website_link: null,
    logo_link: null,
    logo_via_sms: null,
    map_embed_link: null,
    site_type: null,
    platform: null,
    services: null,
    service_areas: null,
    has_service_areas: null,
    client_experience: null,
    num_webpages: null,
    specify_pages: null,
    color_scheme: null,
    color_same_as_logo: null,
    add_ons: null,
    price_quoted: null,
    yearly_price: null,
    follow_up_time: null,
    last_followup_status: null,
    no_pickup_streak: 0,
    direct_line_saved: null,
    fresh_or_followup: null,
    reference_link: null,
    design_reference_links: null,
    image_links: null,
    rating: null,
    comments: null,
    about_business: null,
    created_by: null,
    closed_by: null,
    created_at: "2026-07-01T00:00:00Z",
    updated_at: "2026-07-01T00:00:00Z",
    deleted_at: null,
    ...overrides,
  };
}

describe("leadCopyText", () => {
  it("renders every field in Label: value form", () => {
    const text = leadCopyText(
      lead({
        business_phone: "(252) 401-2775",
        business_email: "acme@example.com",
        business_profile_link: "https://maps.google.com/acme",
        logo_link: "https://cdn.example.com/logo.png",
        map_embed_link: "https://maps.google.com/embed?x=1",
        services: ["Plumbing", "Heating"],
        service_areas: ["Raleigh", "Durham"],
        specify_pages: ["Home", "About Us"],
        color_scheme: "#0D9488, #FFFFFF",
        client_experience: 5,
        image_links: ["https://img.example.com/1.jpg", "https://img.example.com/2.jpg"],
      })
    );
    expect(text).toBe(
      [
        "Business Name: Acme Plumbing",
        "Phone: (252) 401-2775",
        "Email: acme@example.com",
        "Profile Link: https://maps.google.com/acme",
        "Logo Link: https://cdn.example.com/logo.png",
        "Map Embed Link: https://maps.google.com/embed?x=1",
        "Services: Plumbing, Heating",
        "Service Areas: Raleigh, Durham",
        "Specify Pages: Home, About Us",
        "Color Scheme: #0D9488, #FFFFFF",
        "Client Experience (years): 5",
        "Image Links:",
        "https://img.example.com/1.jpg",
        "https://img.example.com/2.jpg",
      ].join("\n")
    );
  });

  it("skips empty, null, and whitespace-only fields", () => {
    const text = leadCopyText(
      lead({
        business_phone: "  ",
        services: [],
        service_areas: [" "],
        image_links: [],
      })
    );
    expect(text).toBe("Business Name: Acme Plumbing");
  });

  it("keeps only non-blank image links, one per line", () => {
    const text = leadCopyText(lead({ image_links: [" https://a.jpg ", "", "https://b.jpg"] }));
    expect(text).toBe(["Business Name: Acme Plumbing", "Image Links:", "https://a.jpg", "https://b.jpg"].join("\n"));
  });

  it("includes a zero-ish but real experience value", () => {
    expect(leadCopyText(lead({ client_experience: 12 }))).toContain("Client Experience (years): 12");
  });
});
