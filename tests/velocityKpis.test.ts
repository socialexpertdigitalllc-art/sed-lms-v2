import { describe, it, expect } from "vitest";
import { computeVelocityKpis } from "@/lib/dashboard/metrics";
import type { Lead } from "@/lib/leads/types";

// Mirrors tests/dashboardMetrics.test.ts's lead() defaults object field-for-field so the
// full `Lead` interface is satisfied without resorting to a cast-chain.
function lead(p: Partial<Lead>): Lead {
  return {
    id: Math.random().toString(36).slice(2),
    status: "Not Ready",
    agent_id: null,
    business_name: "Biz",
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
    closed_at: null,
    dropped_at: null,
    first_touch_at: null,
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
    created_at: "2026-06-01T00:00:00Z",
    updated_at: "2026-06-01T00:00:00Z",
    deleted_at: null,
    ...p,
  };
}

describe("computeVelocityKpis", () => {
  it("scopes closes and drops by their OWN timestamps, not created_at", () => {
    const leads = [
      lead({ created_at: "2026-06-01T00:00:00Z", closed_at: "2026-07-10T00:00:00Z", status: "Closed" }),
      lead({ created_at: "2026-07-05T00:00:00Z", dropped_at: "2026-07-06T00:00:00Z", status: "Dropped" }),
      lead({ created_at: "2026-07-20T00:00:00Z", closed_at: "2026-08-02T00:00:00Z", status: "Closed" }), // closed in Aug
    ];
    const k = computeVelocityKpis(leads, "2026-07");
    expect(k.closedInPeriod).toBe(1);
    expect(k.droppedInPeriod).toBe(1);
    expect(k.avgTimeToCloseDays).toBeCloseTo(39, 0); // Jun 1 → Jul 10
    expect(k.dropRatio).toBeCloseTo(50, 5);
  });

  it("month '' means all-time", () => {
    const leads = [
      lead({ closed_at: "2026-07-10T00:00:00Z", created_at: "2026-07-01T00:00:00Z" }),
      lead({ closed_at: "2026-08-10T00:00:00Z", created_at: "2026-08-01T00:00:00Z" }),
    ];
    expect(computeVelocityKpis(leads, "").closedInPeriod).toBe(2);
  });

  it("first-touch averages over the ARRIVAL cohort and is null-safe", () => {
    const leads = [
      lead({ created_at: "2026-07-01T00:00:00Z", first_touch_at: "2026-07-01T06:00:00Z" }),
      lead({ created_at: "2026-07-02T00:00:00Z", first_touch_at: "2026-07-02T18:00:00Z" }),
      lead({ created_at: "2026-06-15T00:00:00Z", first_touch_at: "2026-07-01T00:00:00Z" }), // arrived in June — excluded
      lead({ created_at: "2026-07-03T00:00:00Z" }), // untouched — excluded
    ];
    const k = computeVelocityKpis(leads, "2026-07");
    expect(k.avgFirstTouchHours).toBeCloseTo(12, 5);
    expect(computeVelocityKpis([], "2026-07")).toEqual({
      closedInPeriod: 0, droppedInPeriod: 0, avgTimeToCloseDays: null, dropRatio: null, avgFirstTouchHours: null,
    });
  });
});
