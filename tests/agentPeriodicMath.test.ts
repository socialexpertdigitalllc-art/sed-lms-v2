import { describe, it, expect } from "vitest";
import {
  computeWindowMetrics,
  regionRows,
  windowFor,
  type ReportWindow,
} from "@/lib/reports/agentPeriodicMath";
import type { Lead } from "@/lib/leads/types";

// Mirrors tests/dashboardMetrics.test.ts's lead() defaults object field-for-field so the
// full `Lead` interface is satisfied without resorting to a cast-chain. Copied verbatim
// from tests/velocityKpis.test.ts (which copied it from dashboardMetrics).
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

const W: ReportWindow = windowFor("2026-07-01", "2026-07-31");
const NO_APPROX = new Set<string>();

describe("windowFor", () => {
  it("builds a half-open UTC window and an equal-length previous window", () => {
    expect(W.fromMs).toBe(Date.parse("2026-07-01T00:00:00Z"));
    expect(W.toExMs).toBe(Date.parse("2026-08-01T00:00:00Z"));
    expect(W.prev.toExMs).toBe(W.fromMs);
    expect(W.prev.toExMs - W.prev.fromMs).toBe(W.toExMs - W.fromMs);
  });
});

describe("computeWindowMetrics", () => {
  it("classifies arrivals, closes, drops, and fresh vs carry-over", () => {
    const leads = [
      lead({ id: "a", created_at: "2026-07-03T00:00:00Z", closed_at: "2026-07-10T00:00:00Z" }), // fresh close
      lead({ id: "b", created_at: "2026-05-01T00:00:00Z", closed_at: "2026-07-20T00:00:00Z" }), // carry-over close
      lead({ id: "c", created_at: "2026-07-04T00:00:00Z", dropped_at: "2026-07-05T00:00:00Z" }), // fast drop (1d)
      lead({ id: "d", created_at: "2026-06-01T00:00:00Z", dropped_at: "2026-07-15T00:00:00Z" }), // slow drop (44d)
      lead({ id: "e", created_at: "2026-07-28T00:00:00Z" }), // open
      lead({ id: "f", created_at: "2026-08-02T00:00:00Z" }), // next month — not arrived
    ];
    const m = computeWindowMetrics(leads, [], [], W, NO_APPROX);
    // a, c, e were created inside the window (arrived); b and d were created
    // before it and only close/drop inside it (carry-over), so arrived = 3.
    expect(m.arrived).toBe(3);
    expect(m.closedCount).toBe(2);
    expect(m.closedFresh).toBe(1);
    expect(m.closedCarryOver).toBe(1);
    expect(m.droppedCount).toBe(2);
    expect(m.fastDrops).toBe(1);
    expect(m.slowDrops).toBe(1);
    expect(m.closeRatio).toBeCloseTo(50, 5);
    expect(m.dropRatio).toBeCloseTo(50, 5);
    expect(m.avgDropDays).toBeCloseTo((1 + 44) / 2, 5);
    expect(m.medianDropDays).toBeCloseTo(22.5, 5);
  });

  it("computes avg AND median close days plus distribution buckets", () => {
    const leads = [
      lead({ created_at: "2026-07-01T00:00:00Z", closed_at: "2026-07-02T00:00:00Z" }), // 1d
      lead({ created_at: "2026-07-01T00:00:00Z", closed_at: "2026-07-06T00:00:00Z" }), // 5d
      lead({ created_at: "2026-05-01T00:00:00Z", closed_at: "2026-07-10T00:00:00Z" }), // 70d
    ];
    const m = computeWindowMetrics(leads, [], [], W, NO_APPROX);
    expect(m.medianCloseDays).toBeCloseTo(5, 5);
    expect(m.avgCloseDays).toBeCloseTo((1 + 5 + 70) / 3, 5);
    expect(m.closeBuckets).toEqual({ le1: 1, le3: 0, le7: 1, le14: 0, le30: 0, gt30: 1 });
  });

  it("open-at-end aging uses period end, and excludes leads that exited before it", () => {
    const m = computeWindowMetrics(
      [
        lead({ created_at: "2026-07-29T00:00:00Z" }), // 3d old at end
        lead({ created_at: "2026-07-10T00:00:00Z" }), // 22d
        lead({ created_at: "2026-04-01T00:00:00Z" }), // 122d
        lead({ created_at: "2026-06-01T00:00:00Z", closed_at: "2026-07-20T00:00:00Z" }), // exited
      ],
      [], [], W, NO_APPROX
    );
    expect(m.openAtEnd).toBe(3);
    expect(m.openAging).toEqual({ d0_7: 1, d8_30: 1, d30p: 1 });
  });

  it("revenue counts only closed-in-window leads; ratios and averages are null-safe", () => {
    const m = computeWindowMetrics(
      [
        lead({ created_at: "2026-07-01T00:00:00Z", closed_at: "2026-07-05T00:00:00Z", price_quoted: 900, yearly_price: "120" }),
        lead({ created_at: "2026-07-01T00:00:00Z", price_quoted: 500 }), // open — excluded
      ],
      [{ user_id: "u", fu_status: "Pickup", created_at: "2026-07-02T00:00:00Z" }],
      [{ created_by: "u", sent_at: "2026-07-03T00:00:00Z" }],
      W, NO_APPROX
    );
    expect(m.closedRevenue).toBe(900);
    expect(m.recurringRevenue).toBe(120);
    expect(m.pickupRate).toBeCloseTo(100, 5);
    expect(m.contractsSent).toBe(1);
    expect(m.closesPerContract).toBeCloseTo(1, 5);
    expect(m.followUpsLogged).toBe(1);
    expect(m.avgDealSize).toBe(900);
    const empty = computeWindowMetrics([], [], [], W, NO_APPROX);
    expect(empty.closeRatio).toBeNull();
    expect(empty.avgCloseDays).toBeNull();
    expect(empty.pickupRate).toBeNull();
    expect(empty.closesPerContract).toBeNull();
  });

  it("flags approximate exits", () => {
    const m = computeWindowMetrics(
      [lead({ id: "x", created_at: "2026-01-01T00:00:00Z", closed_at: "2026-07-05T00:00:00Z" })],
      [], [], W, new Set(["x"])
    );
    expect(m.approxCount).toBe(1);
  });

  it("computes first-touch hours over the arrival cohort", () => {
    const m = computeWindowMetrics(
      [
        lead({ created_at: "2026-07-01T00:00:00Z", first_touch_at: "2026-07-01T06:00:00Z" }), // 6h
        lead({ created_at: "2026-07-02T00:00:00Z", first_touch_at: "2026-07-03T00:00:00Z" }), // 24h
        lead({ created_at: "2026-07-03T00:00:00Z" }), // untouched — excluded
        lead({ created_at: "2026-07-04T00:00:00Z", first_touch_at: "2026-07-03T00:00:00Z" }), // negative — filtered
      ],
      [], [], W, NO_APPROX
    );
    expect(m.avgFirstTouchHours).toBeCloseTo(15, 5);
    expect(m.medianFirstTouchHours).toBeCloseTo(15, 5);
  });
});

describe("regionRows", () => {
  it("groups closes/drops by phone-derived state with Unknown fallback", () => {
    const rows = regionRows(
      [
        lead({ business_phone: "(212) 555-0100", created_at: "2026-07-01T00:00:00Z", closed_at: "2026-07-04T00:00:00Z" }), // NY, 3d
        lead({ business_phone: "(212) 555-0111", created_at: "2026-07-01T00:00:00Z", dropped_at: "2026-07-02T00:00:00Z" }), // NY
        lead({ business_phone: null, created_at: "2026-07-01T00:00:00Z", closed_at: "2026-07-10T00:00:00Z" }), // Unknown
      ],
      W
    );
    const ny = rows.find((r) => r.region === "New York");
    expect(ny).toMatchObject({ closed: 1, dropped: 1 });
    expect(ny?.medianCloseDays).toBeCloseTo(3, 5);
    expect(rows.find((r) => r.region === "Unknown")?.closed).toBe(1);
  });
});
