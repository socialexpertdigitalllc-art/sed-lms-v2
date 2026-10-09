import { describe, it, expect } from "vitest";
import { CalcError, evaluate } from "@/lib/assistant/calc";
import {
  addDays,
  localDateKey,
  localHour,
  localWeekKey,
  localWeekday,
  periodFor,
  previousPeriod,
  resolvePeriod,
  zonedMidnightMs,
} from "@/lib/assistant/dates";
import {
  breakdown,
  followUpTotals,
  groupFollowUps,
  leadTimezone,
  pickupPatterns,
  summarizeLeads,
  touchesBeforeClose,
  type FollowUpRow,
} from "@/lib/assistant/analytics";
import type { Lead } from "@/lib/leads/types";

const KHI = "Asia/Karachi"; // UTC+5, no DST
const NY = "America/New_York";

describe("dates in the company timezone", () => {
  it("finds local midnight, including across a DST change", () => {
    expect(new Date(zonedMidnightMs("2026-10-09", KHI)).toISOString()).toBe("2026-10-08T19:00:00.000Z");
    // New York leaves DST on 2026-11-01: midnight that day is still EDT (UTC-4).
    expect(new Date(zonedMidnightMs("2026-11-01", NY)).toISOString()).toBe("2026-11-01T04:00:00.000Z");
    expect(new Date(zonedMidnightMs("2026-11-02", NY)).toISOString()).toBe("2026-11-02T05:00:00.000Z");
  });

  it("files a 2am-Karachi event under the local date, not the UTC one", () => {
    const at = "2026-10-31T21:00:00Z"; // 02:00 on Nov 1st in Karachi
    expect(localDateKey(at, KHI)).toBe("2026-11-01");
    expect(localHour(at, KHI)).toBe(2);
    expect(localWeekday(at, KHI)).toBe("Sun");
    // Weeks start on Monday.
    expect(localWeekKey(at, KHI)).toBe("2026-10-26");
  });

  it("resolves open-ended periods against today", () => {
    const now = new Date("2026-10-09T10:00:00Z");
    expect(resolvePeriod({}, KHI, now, "all")).toBeNull();
    const last30 = resolvePeriod({}, KHI, now, 30)!;
    expect([last30.from, last30.to, last30.days]).toEqual(["2026-09-10", "2026-10-09", 30]);
    const fromOnly = resolvePeriod({ from: "2026-10-01" }, KHI, now)!;
    expect([fromOnly.from, fromOnly.to]).toEqual(["2026-10-01", "2026-10-09"]);
    // An ISO timestamp the model wrote instead of a date still works.
    expect(resolvePeriod({ from: "2026-10-01T00:00:00Z", to: "2026-10-05" }, KHI, now)!.days).toBe(5);
    expect(() => resolvePeriod({ from: "last week" }, KHI, now)).toThrow(/not a date/);
    expect(() => resolvePeriod({ from: "2026-10-05", to: "2026-10-01" }, KHI, now)).toThrow(/starts/);
  });

  it("builds the equal-length previous period", () => {
    const oct = periodFor("2026-10-01", "2026-10-31", KHI);
    const prev = previousPeriod(oct, KHI);
    expect([prev.from, prev.to, prev.days]).toEqual(["2026-08-31", "2026-09-30", 31]);
    expect(addDays("2026-03-01", -1)).toBe("2026-02-28");
  });
});

describe("calculate", () => {
  it("does arithmetic with the usual precedence", () => {
    expect(evaluate("2 + 3 * 4")).toBe(14);
    expect(evaluate("(2 + 3) * 4")).toBe(20);
    expect(evaluate("2 ^ 3 ^ 2")).toBe(512);
    expect(evaluate("-2 ^ 2")).toBe(-4);
    expect(evaluate("10 % 4")).toBe(2);
  });

  it("supports the functions an analyst reaches for", () => {
    expect(evaluate("round((48250 - 41200) / 41200 * 100, 1)")).toBe(17.1);
    expect(evaluate("avg(10, 20, 60)")).toBe(30);
    expect(evaluate("max(1, sum(2, 3), 4)")).toBe(5);
    expect(evaluate("sqrt(16) + abs(-2)")).toBe(6);
    expect(evaluate("round(pi, 2)")).toBe(3.14);
  });

  it("reads money the way a model writes it", () => {
    expect(evaluate("$48,250 * 0.37")).toBeCloseTo(17852.5, 6);
  });

  it("refuses anything that is not arithmetic", () => {
    expect(() => evaluate("process.exit()")).toThrow(CalcError);
    // Names resolve to OWN entries only — never up the prototype chain.
    expect(() => evaluate("constructor")).toThrow(/Unknown name/);
    expect(() => evaluate("constructor(1)")).toThrow(/Unknown function/);
    expect(() => evaluate("toString(1)")).toThrow(/Unknown function/);
    expect(() => evaluate("1 / 0")).toThrow(/Division by zero/);
    expect(() => evaluate("2 +")).toThrow(CalcError);
    expect(() => evaluate("(1 + 2")).toThrow(/Expected "\)"/);
    expect(() => evaluate("1; 2")).toThrow(CalcError);
    expect(() => evaluate("")).toThrow(/Empty/);
    expect(() => evaluate("9".repeat(600))).toThrow(/longer/);
  });
});

/* ------------------------------------------------------------ fixtures */

let n = 0;
function lead(over: Partial<Lead>): Lead {
  n++;
  return {
    id: `00000000-0000-0000-0000-${String(n).padStart(12, "0")}`,
    status: "Ready",
    agent_id: "agent-a",
    business_name: `Biz ${n}`,
    business_phone: "(512) 555-0100", // Texas → Central time
    business_email: null,
    no_email: null,
    business_profile_link: null,
    website_link: null,
    logo_link: null,
    logo_via_sms: null,
    map_embed_link: null,
    site_type: "Custom Website",
    platform: null,
    services: [],
    service_areas: [],
    has_service_areas: null,
    client_experience: null,
    num_webpages: null,
    specify_pages: [],
    color_scheme: null,
    color_same_as_logo: null,
    add_ons: [],
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
    design_reference_links: [],
    image_links: [],
    rating: null,
    comments: null,
    about_business: null,
    created_by: null,
    closed_by: null,
    created_at: "2026-10-01T10:00:00Z",
    updated_at: "2026-10-01T10:00:00Z",
    deleted_at: null,
    ...over,
  };
}

describe("lead analytics", () => {
  const now = new Date("2026-10-09T10:00:00Z");
  const leads: Lead[] = [
    lead({ status: "Closed", price_quoted: 1200, yearly_price: "300", closed_at: "2026-10-05T10:00:00Z", category: "Plumbing", rating: 8 }),
    lead({ status: "Closed", price_quoted: 800, yearly_price: "$200", closed_at: "2026-10-03T10:00:00Z", category: "Plumbing", rating: 6, agent_id: "agent-b" }),
    lead({ status: "Dropped", dropped_at: "2026-10-04T10:00:00Z", category: "Roofing" }),
    lead({ status: "Ready", price_quoted: 1500, follow_up_time: "2026-10-08T10:00:00Z", no_pickup_streak: 4 }), // overdue
    lead({ status: "Ready", price_quoted: 900, follow_up_time: "2026-10-09T15:00:00Z" }), // later today (Karachi)
    lead({ status: "Ready" }), // never scheduled
    lead({ status: "Not Ready", price_quoted: 600 }),
  ];

  it("summarises with the dashboard's definitions", () => {
    const s = summarizeLeads(leads, now, KHI);
    expect(s.total_leads).toBe(7);
    expect(s.outcomes).toMatchObject({ closed: 2, dropped: 1, open: 4 });
    expect(s.outcomes.win_rate_pct).toBe(28.6); // 2 of 7 — the dashboard's "Conversion rate"
    expect(s.outcomes.close_rate_pct).toBe(66.7); // 2 of 3 decided
    expect(s.revenue.closed_one_time).toBe(2000);
    expect(s.revenue.closed_recurring_yearly).toBe(500); // "$200" parsed from free text
    expect(s.revenue.quoted_on_ready_leads).toBe(2400);
    expect(s.revenue.quoted_on_all_open_leads).toBe(3000);
    expect(s.velocity.avg_days_to_close).toBe(3); // 4 days and 2 days
    expect(s.calling_queue).toMatchObject({ ready_leads: 3, overdue: 1, due_today: 1, no_follow_up_scheduled: 1, three_plus_no_pickups_in_a_row: 1 });
    // Uncategorised leads are a bucket of their own (and here the biggest one).
    expect(s.top_categories[0]).toMatchObject({ name: "(no category)", leads: 4 });
    expect(s.top_categories.find((c) => c.name === "Plumbing")).toEqual({ name: "Plumbing", leads: 2, closed: 2, close_rate_pct: 100 });
  });

  it("breaks down by a dimension and ranks the groups", () => {
    const names = (id: string | null) => (id === "agent-b" ? "Bea" : id ? "Ali" : "Unassigned");
    const rows = breakdown(leads, "agent", { tz: KHI, dateField: "created", agentName: names }, "closed_revenue");
    expect(rows.map((r) => [r.group, r.leads, r.closed, r.closed_revenue])).toEqual([
      ["Ali", 6, 1, 1200],
      ["Bea", 1, 1, 800],
    ]);
    const byDay = breakdown(leads, "day", { tz: KHI, dateField: "closed", agentName: names });
    expect(byDay.map((r) => r.group)).toEqual(["2026-10-03", "2026-10-05"]); // chronological; leads with no close date excluded
  });

  it("works out the lead's own timezone from its state", () => {
    expect(leadTimezone({ business_phone: "(512) 555-0100", custom_area: null })).toBe("America/Chicago");
    expect(leadTimezone({ business_phone: "(512) 555-0100", custom_area: "California" })).toBe("America/Los_Angeles");
    expect(leadTimezone({ business_phone: null, custom_area: null })).toBeNull();
  });
});

describe("follow-up analytics", () => {
  const texas = lead({ id: "lead-tx", business_phone: "(512) 555-0100" });
  const unknown = lead({ id: "lead-x", business_phone: null });
  const leadById = new Map([texas, unknown].map((l) => [l.id, l]));
  // 15:00Z is 10:00 in Texas (CDT, UTC-5) in October.
  const call = (at: string, status: string, leadId = "lead-tx", user = "agent-a"): FollowUpRow => ({
    lead_id: leadId,
    user_id: user,
    fu_status: status,
    created_at: at,
  });
  const calls = [
    ...Array.from({ length: 8 }, (_, i) => call(`2026-10-0${(i % 5) + 1}T15:00:00Z`, i < 6 ? "Pickup" : "No Pickup")),
    ...Array.from({ length: 8 }, (_, i) => call(`2026-10-0${(i % 5) + 1}T20:00:00Z`, i < 2 ? "Pickup" : "No Pickup")),
    call("2026-10-02T15:00:00Z", "Pickup", "lead-x"),
  ];
  const ctx = { tz: KHI, leadById, agentName: () => "Ali" };

  it("totals calls and pickups", () => {
    expect(followUpTotals(calls)).toEqual({ logged: 17, pickups: 9, no_pickups: 8, pickup_rate_pct: 52.9 });
  });

  it("groups by the hour at the lead and sets aside calls whose timezone is unknown", () => {
    const { rows, unplaced } = groupFollowUps(calls, "lead_local_hour", ctx);
    expect(rows).toEqual([
      { group: "10:00", logged: 8, pickups: 6, pickup_rate_pct: 75 },
      { group: "15:00", logged: 8, pickups: 2, pickup_rate_pct: 25 },
    ]);
    expect(unplaced).toBe(1);
  });

  it("ranks the best calling hours, ignoring thin buckets", () => {
    const p = pickupPatterns(calls, ctx, 8);
    expect(p.best_hours_at_lead.map((r) => r.group)).toEqual(["10:00", "15:00"]);
    expect(pickupPatterns(calls, ctx, 9).best_hours_at_lead).toEqual([]);
  });

  it("counts the calls a lead took before it closed", () => {
    const closed = lead({ id: "lead-c", status: "Closed", closed_at: "2026-10-05T00:00:00Z" });
    const history = [call("2026-10-01T15:00:00Z", "No Pickup", "lead-c"), call("2026-10-03T15:00:00Z", "Pickup", "lead-c"), call("2026-10-06T15:00:00Z", "Pickup", "lead-c")];
    expect(touchesBeforeClose([closed], history)).toEqual({
      closed_leads: 1,
      avg_calls_before_close: 2, // the call after closing does not count
      median_calls_before_close: 2,
      closed_with_no_logged_calls: 0,
    });
  });
});
