import { describe, it, expect } from "vitest";
import { createPreLeadSchema, followUpSchema } from "@/lib/preleads/schema";
import { computePreLeadKpis, categoryDistribution, followUpsDue } from "@/lib/preleads/analytics";
import type { PreLead } from "@/lib/preleads/types";

function mkP(p: Partial<PreLead>): PreLead {
  return {
    id: Math.random().toString(36).slice(2),
    agent_id: null,
    business_name: "Biz",
    phone_number: null,
    email: null,
    owner_name: null,
    google_yelp_link: null,
    areas: null,
    services: null,
    service_offered: null,
    service_type: null,
    pricing: null,
    lead_category: "Weak Lead",
    status: "Next follow up",
    follow_up_time: null,
    comments: null,
    created_at: "2026-06-01T00:00:00Z",
    updated_at: "2026-06-01T00:00:00Z",
    last_updated_by: null,
    deleted_at: null,
    ...p,
  };
}

describe("createPreLeadSchema", () => {
  it("requires business name + category + status", () => {
    expect(createPreLeadSchema.safeParse({ business_name: "", lead_category: "Strong Lead", status: "Next follow up" }).success).toBe(false);
  });
  it("rejects an unknown category", () => {
    expect(createPreLeadSchema.safeParse({ business_name: "Acme", lead_category: "Nope", status: "Next follow up" }).success).toBe(false);
  });
  it("coerces pricing and accepts valid input", () => {
    const r = createPreLeadSchema.safeParse({ business_name: "Acme", lead_category: "Strong Lead", status: "Next follow up", pricing: "300" });
    expect(r.success).toBe(true);
    if (r.success) expect(r.data.pricing).toBe(300);
  });
});

describe("followUpSchema", () => {
  it("accepts a status-only follow-up", () => {
    expect(followUpSchema.safeParse({ status: "Closed" }).success).toBe(true);
  });
});

describe("computePreLeadKpis", () => {
  const now = new Date("2026-06-15T12:00:00Z");
  const leads: PreLead[] = [
    mkP({ lead_category: "Strong Lead", status: "Next follow up", follow_up_time: "2026-06-15T18:00:00Z" }), // due 24h
    mkP({ status: "Closed" }),
    mkP({ status: "Dropped" }),
    mkP({ status: "Next follow up", follow_up_time: "2026-06-10T00:00:00Z" }), // past due
  ];

  it("counts categories and statuses", () => {
    const k = computePreLeadKpis(leads, now);
    expect(k.total).toBe(4);
    expect(k.strong).toBe(1);
    expect(k.closed).toBe(1);
    expect(k.dropped).toBe(1);
    expect(k.active).toBe(2);
  });
  it("computes due-in-24h and past-due", () => {
    const k = computePreLeadKpis(leads, now);
    expect(k.dueNext24h).toBe(1);
    expect(k.pastDue).toBe(1);
  });
  it("computes conversion rate", () => {
    expect(computePreLeadKpis(leads, now).conversionRate).toBe(25);
  });
});

describe("aggregations", () => {
  it("categoryDistribution returns canonical order", () => {
    const out = categoryDistribution([mkP({ lead_category: "Mockup" }), mkP({ lead_category: "Strong Lead" })]);
    expect(out[0].name).toBe("Strong Lead");
  });
  it("followUpsDue returns only active leads due within 24h", () => {
    const now = new Date("2026-06-15T12:00:00Z");
    const out = followUpsDue(
      [
        mkP({ status: "Next follow up", follow_up_time: "2026-06-15T20:00:00Z" }),
        mkP({ status: "Closed", follow_up_time: "2026-06-15T20:00:00Z" }),
      ],
      now
    );
    expect(out.length).toBe(1);
  });
});
