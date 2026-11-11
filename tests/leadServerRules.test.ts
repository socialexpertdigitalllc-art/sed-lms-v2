import { describe, it, expect } from "vitest";
import { buildLeadPayload, emptyNewLead, validateNewLead, type NewLeadFormState } from "@/lib/leads/newLeadForm";
import { leadPayloadErrors, leadPayloadMessage } from "@/lib/leads/serverRules";

/**
 * The New Lead form's rules, enforced by POST /api/leads itself. The promise
 * that matters most: a lead the FORM accepts is always accepted by the
 * server (the form is the main way leads arrive) — and a lead that skips the
 * form is held to the same rules.
 */

const NOW = new Date("2026-10-14T10:00:00Z");

function validForm(over: Partial<NewLeadFormState> = {}): NewLeadFormState {
  return {
    ...emptyNewLead("Not Ready"),
    site_type: "Custom Website",
    business_name: "Jumbo's Pizza",
    category: "Pizza Restaurant",
    business_phone: "(252) 401-2775",
    business_email: "owner@jumbos.com",
    platform: "Google",
    business_profile_link: "https://maps.app.goo.gl/abc",
    has_service_areas: "Yes",
    areas: ["Austin", "Round Rock"],
    services: ["Pizza", "Catering"],
    client_experience: "12",
    specify_pages: ["Home", "About Us", "Contact Us"],
    color_scheme: "#1e40af, #ffffff",
    follow_up_time: "2026-10-15T10:00",
    price_quoted: "500",
    comments: "Owner wants a new site before the holidays.",
    rating: 8,
    fresh_or_followup: "Fresh",
    ...over,
  };
}

describe("server-side New Lead rules", () => {
  it("accepts every lead the form accepts", () => {
    const forms = [
      validForm(),
      validForm({ no_email: true, business_email: "" }),
      validForm({ has_service_areas: "No", areas: [] }),
      validForm({ platform: "Other", other_platform: "Angi" }),
      validForm({ site_type: "Redesign", reference_link: "https://old.jumbos.com" }),
      validForm({ price_quoted: "Other", price_custom: "1200" }),
      validForm({ specify_pages: ["Home", "Individual Service Pages"] }),
    ];
    for (const f of forms) {
      expect(validateNewLead(f, NOW)).toEqual({});
      expect(leadPayloadErrors(buildLeadPayload(f, { userId: "u1" }), NOW)).toEqual({});
    }
  });

  it("refuses a lead missing what the form requires, naming each field", () => {
    const p = buildLeadPayload(validForm(), { userId: "u1" }) as Record<string, unknown>;
    const missing: [string, unknown][] = [
      ["business_name", ""],
      ["category", "  "],
      ["business_phone", "252"],
      ["business_email", "not-an-email"],
      ["site_type", null],
      ["platform", null],
      ["business_profile_link", null],
      ["has_service_areas", null],
      ["services", null],
      ["client_experience", null],
      ["color_scheme", "#1e40af"],
      ["follow_up_time", "2026-10-01T10:00:00Z"],
      ["price_quoted", null],
      ["comments", "  "],
      ["rating", null],
      ["fresh_or_followup", null],
      ["closed_by", null],
    ];
    for (const [field, value] of missing) {
      const errors = leadPayloadErrors({ ...p, [field]: value }, NOW);
      expect(Object.keys(errors), field).toContain(field === "services" ? "services" : field);
    }
    expect(Object.keys(leadPayloadErrors({ ...p, has_service_areas: true, service_areas: [] }, NOW))).toContain("service_areas");
    expect(Object.keys(leadPayloadErrors({ ...p, num_webpages: 0, specify_pages: [] }, NOW))).toContain("specify_pages");
  });

  it("gives a few minutes' grace on the follow-up time (the request takes time to arrive)", () => {
    const p = buildLeadPayload(validForm(), { userId: "u1" }) as Record<string, unknown>;
    expect(leadPayloadErrors({ ...p, follow_up_time: new Date(NOW.getTime() - 60_000).toISOString() }, NOW)).toEqual({});
    expect(leadPayloadErrors({ ...p, follow_up_time: new Date(NOW.getTime() - 10 * 60_000).toISOString() }, NOW)).toHaveProperty("follow_up_time");
  });

  it("says the first few problems in one sentence", () => {
    expect(leadPayloadMessage({ a: "One.", b: "Two." })).toBe("One. Two.");
    expect(leadPayloadMessage({ a: "1.", b: "2.", c: "3.", d: "4.", e: "5." })).toBe("1. 2. 3. (and 2 more)");
    expect(leadPayloadMessage({})).toBe("");
  });
});

describe("server-side New Lead rules — category and developer instructions", () => {
  it("a lead without a category is not created", () => {
    const p = buildLeadPayload(validForm({ category: "" }), { userId: "u1" });
    expect(leadPayloadErrors(p, NOW).category).toMatch(/category/i);
  });

  it("instructions arrive as a list; an item over 50 words is refused", () => {
    const ok = buildLeadPayload(validForm({ developer_instructions: ["Sticky header", "Team photo on About"] }), { userId: "u1" });
    expect(leadPayloadErrors(ok, NOW)).toEqual({});
    const long = Array.from({ length: 21 }, (_, i) => `w${i}`).join(" ");
    const bad = buildLeadPayload(validForm({ developer_instructions: ["Fine", long] }), { userId: "u1" });
    expect(leadPayloadErrors(bad, NOW).developer_instructions).toMatch(/Instruction 2 is 21 words/);
  });
});

describe("server-side New Lead rules — No Platform and See Instructions", () => {
  it("No Platform: no platform or link needed", () => {
    const p = buildLeadPayload(validForm({ no_platform: true, platform: "", business_profile_link: "" }), { userId: "u1" });
    expect(leadPayloadErrors(p, NOW)).toEqual({});
    const without = { ...p, no_platform: false };
    expect(Object.keys(leadPayloadErrors(without, NOW))).toEqual(expect.arrayContaining(["platform", "business_profile_link"]));
  });

  it("See Instructions: no colours needed, but instructions are", () => {
    const ok = buildLeadPayload(validForm({ color_see_instructions: true, color_scheme: "", developer_instructions: ["Pastel blues"] }), { userId: "u1" });
    expect(leadPayloadErrors(ok, NOW)).toEqual({});
    const none = buildLeadPayload(validForm({ color_see_instructions: true, color_scheme: "", developer_instructions: [""] }), { userId: "u1" });
    expect(leadPayloadErrors(none, NOW).developer_instructions).toMatch(/colour ideas/);
  });
});
