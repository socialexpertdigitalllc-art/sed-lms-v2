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

describe("validatePreLead", () => {
  it("passes a valid state", () => {
    expect(validatePreLead(valid())).toEqual({});
  });
  it("requires service_type only when Website", () => {
    expect(validatePreLead({ ...valid(), service_offered: "Website", service_type: "" }).service_type).toBeTruthy();
    expect(validatePreLead({ ...valid(), service_offered: "SEO", service_type: "" }).service_type).toBeUndefined();
  });
  it("requires exact phone format", () => {
    expect(validatePreLead({ ...valid(), phone_number: "123" }).phone_number).toBeTruthy();
  });
  it("validates email only when present", () => {
    expect(validatePreLead({ ...valid(), email: "bad" }).email).toBeTruthy();
    expect(validatePreLead({ ...valid(), email: "" }).email).toBeUndefined();
  });
  it("requires follow-up time and category and profile link", () => {
    const e = validatePreLead({ ...valid(), follow_up_time: "", lead_category: "", google_yelp_link: "" });
    expect(e.follow_up_time).toBeTruthy();
    expect(e.lead_category).toBeTruthy();
    expect(e.google_yelp_link).toBeTruthy();
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
