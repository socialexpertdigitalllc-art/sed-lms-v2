import { describe, it, expect } from "vitest";
import {
  computeExtendedKpis,
  revenueByStatus,
  ticketStatusSplit,
  type FollowUpLite,
  type TicketLite,
} from "@/lib/dashboard/metrics";
import type { Lead } from "@/lib/leads/types";

// Mirrors tests/analytics.test.ts's mk() defaults object field-for-field so the
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

const now = new Date("2026-07-10T12:00:00Z");

describe("computeExtendedKpis", () => {
  it("computes revenue + deal metrics", () => {
    const leads: Lead[] = [
      lead({ status: "Closed", price_quoted: 900, yearly_price: "100" }),
      lead({ status: "Closed", price_quoted: 300, yearly_price: "None" }),
      lead({ status: "Ready", price_quoted: 500, yearly_price: "50" }),
      lead({ status: "Not Ready", price_quoted: null }),
    ];
    const k = computeExtendedKpis(leads, [], [], now);
    expect(k.closedRevenue).toBe(1200);
    expect(k.recurringRevenue).toBe(100); // Closed only; "None" skipped
    expect(k.avgDealSize).toBeCloseTo((900 + 300 + 500) / 3, 5);
    expect(k.conversionRate).toBeCloseTo(50, 5); // 2 of 4
  });

  it("is null-safe on empty inputs", () => {
    const k = computeExtendedKpis([], [], [], now);
    expect(k.avgDealSize).toBeNull();
    expect(k.pickupRate).toBeNull();
    expect(k.avgResolutionHours).toBeNull();
    expect(k.conversionRate).toBe(0);
  });

  it("counts newThisWeek and overdueFollowUps", () => {
    const leads: Lead[] = [
      lead({ created_at: "2026-07-08T00:00:00Z" }), // within 7d of now -> counts
      lead({ created_at: "2026-06-01T00:00:00Z" }), // older -> doesn't count
      lead({ status: "Ready", follow_up_time: "2026-07-09T00:00:00Z" }), // past -> overdue
      lead({ status: "Long Term", follow_up_time: "2026-08-01T00:00:00Z" }), // future -> not overdue
      lead({ status: "Closed", follow_up_time: "2026-07-01T00:00:00Z" }), // ineligible status -> not overdue
    ];
    const k = computeExtendedKpis(leads, [], [], now);
    expect(k.newThisWeek).toBe(1);
    expect(k.overdueFollowUps).toBe(1);
  });

  it("computes pickupRate and ticket metrics", () => {
    const followUps: FollowUpLite[] = [
      { fu_status: "Pickup" },
      { fu_status: "Pickup" },
      { fu_status: "Pickup" },
      { fu_status: "No Pickup" },
    ];
    const tickets: TicketLite[] = [
      { status: "Open", due_date: "2026-07-09T00:00:00Z", created_at: "2026-07-01T00:00:00Z", resolved_at: null }, // open + overdue
      { status: "Resolved", due_date: null, created_at: "2026-07-01T00:00:00Z", resolved_at: "2026-07-02T00:00:00Z" }, // resolved a day later -> 24h
      { status: "In Progress", due_date: "2026-08-01T00:00:00Z", created_at: "2026-07-01T00:00:00Z", resolved_at: null }, // due in future -> not overdue
    ];
    const k = computeExtendedKpis([], followUps, tickets, now);
    expect(k.pickupRate).toBeCloseTo(75, 5);
    expect(k.openTickets).toBe(2);
    expect(k.overdueTickets).toBe(1);
    expect(k.avgResolutionHours).toBeCloseTo(24, 5);
  });
});

describe("revenueByStatus", () => {
  it("sums price_quoted per status, only including statuses with priced leads", () => {
    const r = revenueByStatus([
      lead({ status: "Ready", price_quoted: 500 }),
      lead({ status: "Ready", price_quoted: 250 }),
      lead({ status: "Closed", price_quoted: 900 }),
      lead({ status: "Dropped", price_quoted: null }),
    ]);
    expect(r).toEqual(
      expect.arrayContaining([
        { name: "Ready", value: 750 },
        { name: "Closed", value: 900 },
      ])
    );
    expect(r.find((x) => x.name === "Dropped")).toBeUndefined();
  });
});

describe("ticketStatusSplit", () => {
  it("counts tickets per lifecycle status", () => {
    const r = ticketStatusSplit([{ status: "Open" }, { status: "Open" }, { status: "Resolved" }]);
    expect(r).toEqual(
      expect.arrayContaining([
        { name: "Open", value: 2 },
        { name: "Resolved", value: 1 },
      ])
    );
  });
});
