import { describe, it, expect } from "vitest";
import {
  pageTotal,
  nonEmpty,
  validateNewLead,
  buildLeadPayload,
  emptyNewLead,
  type NewLeadFormState,
} from "@/lib/leads/newLeadForm";
import { createLeadSchema } from "@/lib/leads/schema";

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

const NOW = new Date("2026-07-07T00:00:00");

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

  it("rejects an invalid non-empty reference link for Redesign", () => {
    const e = validateNewLead(
      { ...validState(), site_type: "Redesign", reference_link: "not-a-url" },
      now
    );
    expect(e.reference_link).toBeTruthy();
  });

  it("allows an empty reference link for Redesign (optional field)", () => {
    const e = validateNewLead(
      { ...validState(), site_type: "Redesign", reference_link: "" },
      now
    );
    expect(e.reference_link).toBeFalsy();
  });

  it("allows a whitespace-only reference link for Redesign", () => {
    const e = validateNewLead(
      { ...validState(), site_type: "Redesign", reference_link: "   " },
      now
    );
    expect(e.reference_link).toBeFalsy();
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

  it("round-trips about_business, trimmed", () => {
    const p = buildLeadPayload({
      ...validState(),
      about_business: "  Family run since 1998, historic-home specialists.  ",
    });
    expect(p.about_business).toBe("Family run since 1998, historic-home specialists.");
  });

  it("nulls about_business when blank or whitespace-only", () => {
    expect(buildLeadPayload({ ...validState(), about_business: "" }).about_business).toBeNull();
    expect(buildLeadPayload({ ...validState(), about_business: "   " }).about_business).toBeNull();
  });

  it("does not require about_business", () => {
    // Optional by design: an otherwise-valid state with it empty must still pass.
    expect(validateNewLead({ ...validState(), about_business: "" }, NOW)).toEqual({});
  });
});

describe("polish-3: email / no_email", () => {
  it("requires a valid email when no_email is false", () => {
    const e = validateNewLead({ ...validState(), business_email: "", no_email: false }, NOW);
    expect(e.business_email).toBeTruthy();
  });

  it("does not require email when no_email is true", () => {
    const e = validateNewLead({ ...validState(), business_email: "", no_email: true }, NOW);
    expect(e.business_email).toBeFalsy();
  });
});

describe("color scheme is mandatory", () => {
  it("requires a colour scheme", () => {
    const e = validateNewLead({ ...validState(), color_scheme: "" }, NOW);
    expect(e.color_scheme).toBeTruthy();
  });

  it("still requires one when a logo was supplied", () => {
    const e = validateNewLead(
      { ...validState(), color_scheme: "", logo_link: "https://x.com/l.png" },
      NOW
    );
    expect(e.color_scheme).toBeTruthy();
  });

  it("still requires one when the logo is coming via SMS", () => {
    const e = validateNewLead(
      { ...validState(), color_scheme: "", logo_link: "", logo_via_sms: true },
      NOW
    );
    expect(e.color_scheme).toBeTruthy();
  });

  it("accepts an explicit scheme", () => {
    const e = validateNewLead({ ...validState(), color_scheme: "navy, gold" }, NOW);
    expect(e.color_scheme).toBeFalsy();
  });
});

describe("polish-3: design_reference_links validation", () => {
  it("accepts an empty design reference list", () => {
    const e = validateNewLead({ ...validState(), design_reference_links: [] }, NOW);
    expect(e.design_reference_links).toBeFalsy();
  });

  it("accepts up to 3 valid urls", () => {
    const e = validateNewLead(
      {
        ...validState(),
        design_reference_links: ["https://a.com", "https://b.com", "https://c.com"],
      },
      NOW
    );
    expect(e.design_reference_links).toBeFalsy();
  });

  it("rejects a non-url design reference link", () => {
    const e = validateNewLead(
      { ...validState(), design_reference_links: ["not-a-url"] },
      NOW
    );
    expect(e.design_reference_links).toBeTruthy();
  });

  it("ignores empty and whitespace-only design reference rows (look empty, are empty)", () => {
    const e = validateNewLead(
      { ...validState(), design_reference_links: ["", "   ", "https://ok.com"] },
      NOW
    );
    expect(e.design_reference_links).toBeFalsy();
  });
});

describe("form audit: worst-case submission (every optional skipped)", () => {
  // A state that fills ONLY what the UI marks required. This exact shape used to
  // reach the DB and die on the design_reference_links / add_ons not-null
  // constraints (relaxed in migration 0031) — pin the whole pipeline.
  function minimalState(): NewLeadFormState {
    return {
      ...emptyNewLead("Not Ready"),
      site_type: "Redesign", // exercises the optional reference_link branch too
      business_name: "Minimal Lead",
      business_phone: "(252) 401-2775",
      no_email: true, // email skipped
      platform: "Google",
      business_profile_link: "https://maps.google.com/x",
      has_service_areas: "No",
      services: ["Plumbing"],
      client_experience: "3",
      specify_pages: ["Home"],
      color_scheme: "blue",
      follow_up_time: "2027-01-01T10:00",
      price_quoted: "250",
      comments: "ok",
      rating: 5,
      fresh_or_followup: "Fresh",
    };
  }

  it("passes client validation with every optional empty", () => {
    expect(validateNewLead(minimalState(), NOW)).toEqual({});
  });

  it("builds a payload that createLeadSchema accepts, with nullable empties", () => {
    const payload = buildLeadPayload(minimalState());
    const parsed = createLeadSchema.parse(payload);
    expect(parsed.design_reference_links).toBeNull();
    expect(parsed.add_ons).toBeNull();
    expect(parsed.image_links).toBeNull();
    expect(parsed.service_areas).toBeNull();
    expect(parsed.reference_link).toBeNull();
    expect(parsed.business_email).toBeNull();
    expect(parsed.yearly_price).toBe("None");
  });
});

describe("polish-3: closed_by validation", () => {
  it("requires closed_by to be set", () => {
    const e = validateNewLead({ ...validState(), closed_by: "" }, NOW);
    expect(e.closed_by).toBeTruthy();
  });

  it("accepts the default 'self' value", () => {
    const e = validateNewLead({ ...validState(), closed_by: "self" }, NOW);
    expect(e.closed_by).toBeFalsy();
  });
});

describe("polish-3: buildLeadPayload flags", () => {
  it("nulls email and sets no_email true", () => {
    const p = buildLeadPayload({ ...validState(), business_email: "x@y.com", no_email: true });
    expect(p.business_email).toBeNull();
    expect(p.no_email).toBe(true);
  });

  it("keeps the trimmed email when no_email is false", () => {
    const p = buildLeadPayload({
      ...validState(),
      business_email: "  x@y.com  ",
      no_email: false,
    });
    expect(p.business_email).toBe("x@y.com");
    expect(p.no_email).toBe(false);
  });

  it("nulls logo_link when logo_via_sms is true", () => {
    const p = buildLeadPayload({
      ...validState(),
      logo_link: "https://x.com/l.png",
      logo_via_sms: true,
    });
    expect(p.logo_link).toBeNull();
    expect(p.logo_via_sms).toBe(true);
  });

  it("keeps logo_link when logo_via_sms is false", () => {
    const p = buildLeadPayload({
      ...validState(),
      logo_link: "https://x.com/l.png",
      logo_via_sms: false,
    });
    expect(p.logo_link).toBe("https://x.com/l.png");
  });

  it("always sends color_scheme with color_same_as_logo false", () => {
    const p = buildLeadPayload({
      ...validState(),
      color_scheme: "#fff",
      logo_link: "https://x.com/l.png",
    });
    expect(p.color_scheme).toBe("#fff");
    expect(p.color_same_as_logo).toBe(false);
  });

  it("carries design_reference_links and add_ons through", () => {
    const addOns = [{ id: "x", label: "Live Chat", price: 50 }];
    const p = buildLeadPayload({
      ...validState(),
      design_reference_links: ["https://a.com", "https://b.com"],
      add_ons: addOns,
    });
    expect(p.design_reference_links).toEqual(["https://a.com", "https://b.com"]);
    expect(p.add_ons).toEqual(addOns);
  });

  it("resolves closed_by 'self' to the current user id", () => {
    const p = buildLeadPayload({ ...validState(), closed_by: "self" }, { userId: "user-123" });
    expect(p.closed_by).toBe("user-123");
  });

  it("resolves closed_by 'self' to null when no userId is supplied", () => {
    const p = buildLeadPayload({ ...validState(), closed_by: "self" });
    expect(p.closed_by).toBeNull();
  });

  it("keeps an explicit closed_by uuid as-is, ignoring opts.userId", () => {
    const p = buildLeadPayload(
      { ...validState(), closed_by: "11111111-1111-4111-8111-111111111111" },
      { userId: "user-123" }
    );
    expect(p.closed_by).toBe("11111111-1111-4111-8111-111111111111");
  });
});
