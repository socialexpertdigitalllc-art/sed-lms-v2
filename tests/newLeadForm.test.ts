import { describe, it, expect } from "vitest";
import {
  pageTotal,
  nonEmpty,
  validateNewLead,
  buildLeadPayload,
  emptyNewLead,
  type NewLeadFormState,
} from "@/lib/leads/newLeadForm";

function validState(): NewLeadFormState {
  return {
    ...emptyNewLead("Not Ready"),
    site_type: "Custom Website",
    business_name: "Acme Plumbing",
    business_phone: "(252) 401-2775",
    business_email: "acme@example.com",
    platform: "Google",
    business_profile_link: "https://maps.google.com/acme",
    has_service_areas: "No",
    services: ["Plumbing"],
    client_experience: "5",
    specify_pages: ["Home", "About Us", "Contact Us"],
    color_scheme: "#0D9488, #FFFFFF",
    follow_up_time: "2027-01-01T10:00",
    price_quoted: "500",
    comments: "Solid lead",
    rating: 8,
    fresh_or_followup: "Fresh",
  };
}

describe("pageTotal (weighted, as in the old form)", () => {
  it("counts plain pages as 1", () => {
    expect(pageTotal(["Home", "About Us"], 3, 2)).toBe(2);
  });
  it("Individual Service Pages counts as max(services,1)", () => {
    expect(pageTotal(["Home", "Individual Service Pages"], 3, 0)).toBe(4);
    expect(pageTotal(["Individual Service Pages"], 0, 0)).toBe(1);
  });
  it("Individual Service Area Pages counts as areas (0 allowed)", () => {
    expect(pageTotal(["Individual Service Area Pages"], 1, 2)).toBe(2);
    expect(pageTotal(["Individual Service Area Pages"], 1, 0)).toBe(0);
  });
});

describe("validateNewLead", () => {
  const now = new Date("2026-07-07T00:00:00");

  it("passes a fully valid state", () => {
    expect(validateNewLead(validState(), now)).toEqual({});
  });

  it("requires phone in exact format", () => {
    const e = validateNewLead({ ...validState(), business_phone: "2524012775" }, now);
    expect(e.business_phone).toBeTruthy();
  });

  it("requires other platform name when platform is Other", () => {
    const e = validateNewLead({ ...validState(), platform: "Other", other_platform: "" }, now);
    expect(e.other_platform).toBeTruthy();
  });

  it("requires at least one area when service areas is Yes", () => {
    const e = validateNewLead(
      { ...validState(), has_service_areas: "Yes", areas: ["  "] },
      now
    );
    expect(e.areas).toBeTruthy();
  });

  it("requires future follow-up time", () => {
    const e = validateNewLead({ ...validState(), follow_up_time: "2025-01-01T10:00" }, now);
    expect(e.follow_up_time).toBeTruthy();
  });

  it("requires custom price when price is Other", () => {
    const e = validateNewLead({ ...validState(), price_quoted: "Other", price_custom: "" }, now);
    expect(e.price_custom).toBeTruthy();
  });

  it("rejects a non-numeric custom price", () => {
    const e = validateNewLead(
      { ...validState(), price_quoted: "Other", price_custom: "abc" },
      now
    );
    expect(e.price_custom).toBeTruthy();
  });

  it("rejects an invalid follow-up date string", () => {
    const e = validateNewLead({ ...validState(), follow_up_time: "garbage" }, now);
    expect(e.follow_up_time).toBeTruthy();
  });

  it("requires https reference link for Redesign", () => {
    const e = validateNewLead(
      { ...validState(), site_type: "Redesign", reference_link: "not-a-url" },
      now
    );
    expect(e.reference_link).toBeTruthy();
  });

  it("requires rating and comments and fresh/follow-up", () => {
    const e = validateNewLead(
      { ...validState(), rating: 0, comments: " ", fresh_or_followup: "" },
      now
    );
    expect(e.rating).toBeTruthy();
    expect(e.comments).toBeTruthy();
    expect(e.fresh_or_followup).toBeTruthy();
  });
});

describe("buildLeadPayload", () => {
  it("maps platform Other to the custom name and derives num_webpages", () => {
    const p = buildLeadPayload({
      ...validState(),
      platform: "Other",
      other_platform: "Facebook",
      specify_pages: ["Home", "Individual Service Pages", "Contact Us"],
      services: ["A", "B"],
    });
    expect(p.platform).toBe("Facebook");
    expect(p.num_webpages).toBe(4); // Home 1 + ISP 2 + Contact 1
    expect(p.status).toBe("Not Ready");
  });

  it("uses custom price when Other, yearly defaults to None", () => {
    const p = buildLeadPayload({
      ...validState(),
      price_quoted: "Other",
      price_custom: "1200",
      yearly_price: "",
    });
    expect(p.price_quoted).toBe(1200);
    expect(p.yearly_price).toBe("None");
  });

  it("uses the custom yearly value when yearly is Other", () => {
    const p = buildLeadPayload({
      ...validState(),
      yearly_price: "Other",
      yearly_custom: "150",
    });
    expect(p.yearly_price).toBe("150");
  });

  it("replaces the Other page chip with its custom label and nulls reference when not Redesign", () => {
    const p = buildLeadPayload({
      ...validState(),
      specify_pages: ["Home", "Other", "Contact Us"],
      other_page: "FAQ",
      reference_link: "https://x.com",
    });
    expect(p.specify_pages).toContain("FAQ");
    expect(p.reference_link).toBeNull();
  });
});
