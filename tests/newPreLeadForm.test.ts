import { describe, it, expect } from "vitest";
import { validatePreLead, buildPreLeadPayload, emptyPreLead } from "@/lib/preleads/newPreLeadForm";

function valid() {
  return {
    ...emptyPreLead(),
    service_offered: "SEO",
    business_name: "Acme",
    phone_number: "(252) 401-2775",
    google_yelp_link: "https://maps.google.com/acme",
    follow_up_time: "2027-01-01T10:00",
    lead_category: "Strong Lead",
  };
}

const NOW = new Date("2026-07-07T00:00:00");

describe("validatePreLead", () => {
  it("passes a valid state", () => {
    expect(validatePreLead(valid(), NOW)).toEqual({});
  });
  it("requires service_type only when Website", () => {
    expect(validatePreLead({ ...valid(), service_offered: "Website", service_type: "" }, NOW).service_type).toBeTruthy();
    expect(validatePreLead({ ...valid(), service_offered: "SEO", service_type: "" }, NOW).service_type).toBeUndefined();
  });
  it("requires exact phone format", () => {
    expect(validatePreLead({ ...valid(), phone_number: "123" }, NOW).phone_number).toBeTruthy();
  });
  it("validates email only when present", () => {
    expect(validatePreLead({ ...valid(), email: "bad" }, NOW).email).toBeTruthy();
    expect(validatePreLead({ ...valid(), email: "" }, NOW).email).toBeUndefined();
  });
  it("requires follow-up time and category and profile link", () => {
    const e = validatePreLead({ ...valid(), follow_up_time: "", lead_category: "", google_yelp_link: "" }, NOW);
    expect(e.follow_up_time).toBeTruthy();
    expect(e.lead_category).toBeTruthy();
    expect(e.google_yelp_link).toBeTruthy();
  });
  it("rejects a past follow-up time", () => {
    expect(validatePreLead({ ...valid(), follow_up_time: "2025-01-01T10:00" }, NOW).follow_up_time).toBeTruthy();
  });
  it("accepts a future follow-up time", () => {
    expect(validatePreLead({ ...valid(), follow_up_time: "2027-01-01T10:00" }, NOW).follow_up_time).toBeUndefined();
  });
});

describe("buildPreLeadPayload", () => {
  it("splits comma lists, defaults status, nulls empties", () => {
    const p = buildPreLeadPayload({ ...valid(), services: "SEO, Ads,  ", areas: "Kinston, NC" });
    expect(p.status).toBe("Next follow up");
    expect(p.services).toEqual(["SEO", "Ads"]);
    expect(p.areas).toEqual(["Kinston", "NC"]);
    expect(p.email).toBeNull();
    expect(p.pricing).toBeNull();
  });
});
