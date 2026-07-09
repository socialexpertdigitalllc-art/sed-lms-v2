import { describe, it, expect } from "vitest";
import {
  computeKpis,
  byStatus,
  byAgent,
  freshVsFollowup,
} from "@/lib/leads/analytics";
import type { Lead } from "@/lib/leads/types";

function mk(p: Partial<Lead>): Lead {
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
    direct_line_saved: null,
    fresh_or_followup: null,
    reference_link: null,
    design_reference_links: null,
    image_links: null,
    rating: null,
    comments: null,
    created_by: null,
    closed_by: null,
    created_at: "2026-06-01T00:00:00Z",
    updated_at: "2026-06-01T00:00:00Z",
    deleted_at: null,
    ...p,
  };
}

describe("computeKpis", () => {
  const leads: Lead[] = [
    mk({ status: "Ready", price_quoted: 750, rating: 8, fresh_or_followup: "Fresh" }),
    mk({ status: "Ready", price_quoted: 500, rating: 6 }),
    mk({ status: "Closed", price_quoted: 1200, rating: 10, fresh_or_followup: "Follow Up" }),
    mk({ status: "Dropped" }),
    mk({ status: "Not Ready", fresh_or_followup: "Fresh" }),
  ];

  it("counts statuses", () => {
    const k = computeKpis(leads);
    expect(k.total).toBe(5);
    expect(k.ready).toBe(2);
    expect(k.closed).toBe(1);
    expect(k.dropped).toBe(1);
    expect(k.notReady).toBe(1);
  });

  it("sums quoted revenue for Ready leads only", () => {
    // Ready: 750 + 500 = 1250. The Closed lead's 1200 must NOT be counted.
    expect(computeKpis(leads).quotedRevenue).toBe(1250);
  });

  it("averages rating only over rated leads", () => {
    expect(computeKpis(leads).avgRating).toBe(8); // (8+6+10)/3
  });

  it("counts fresh leads", () => {
    expect(computeKpis(leads).freshCount).toBe(2);
  });
});

describe("aggregations", () => {
  it("byStatus returns ordered counts", () => {
    const out = byStatus([mk({ status: "Ready" }), mk({ status: "Ready" }), mk({ status: "Closed" })]);
    expect(out).toEqual([
      { name: "Ready", value: 2 },
      { name: "Closed", value: 1 },
    ]);
  });

  it("byAgent maps ids to names and labels missing as Unassigned", () => {
    const out = byAgent(
      [mk({ agent_id: "a1" }), mk({ agent_id: "a1" }), mk({ agent_id: null })],
      { a1: "Alex" }
    );
    expect(out).toContainEqual({ name: "Alex", value: 2 });
    expect(out).toContainEqual({ name: "Unassigned", value: 1 });
  });

  it("freshVsFollowup splits correctly", () => {
    const out = freshVsFollowup([
      mk({ fresh_or_followup: "Fresh" }),
      mk({ fresh_or_followup: "Follow Up" }),
      mk({ fresh_or_followup: "Fresh" }),
    ]);
    expect(out).toEqual({ fresh: 2, followUp: 1 });
  });
});

describe("Long Term status", () => {
  it("computeKpis counts Long Term leads", () => {
    const leads = [mk({ status: "Long Term" }), mk({ status: "Long Term" }), mk({ status: "Ready" })];
    const k = computeKpis(leads);
    expect(k.longTerm).toBe(2);
    expect(k.ready).toBe(1);
  });

  it("byStatus includes Long Term in order after Dropped", () => {
    const leads = [mk({ status: "Long Term" }), mk({ status: "Dropped" }), mk({ status: "Ready" })];
    expect(byStatus(leads)).toEqual([
      { name: "Ready", value: 1 },
      { name: "Dropped", value: 1 },
      { name: "Long Term", value: 1 },
    ]);
  });
});
