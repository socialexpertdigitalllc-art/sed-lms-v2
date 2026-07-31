import { describe, it, expect } from "vitest";
import type { Lead } from "@/lib/leads/types";
import type { ContractSnapshot } from "@/lib/contracts/types";
import {
  parsePrice,
  buildContractSnapshot,
  validateMergeFields,
  validateSnapshotFields,
  applyPriceOverrides,
  contractLines,
  formatUsd,
} from "@/lib/contracts/merge";

function lead(overrides: Partial<Lead> = {}): Lead {
  return {
    id: "l1", status: "Ready", agent_id: null, business_name: "Acme Plumbing",
    business_phone: "+1 555 111 2222", business_email: "owner@acme.test", no_email: false,
    business_profile_link: null, website_link: null, logo_link: null, logo_via_sms: null,
    map_embed_link: null, site_type: null, platform: null, services: null, service_areas: null,
    has_service_areas: null, client_experience: null, num_webpages: null, specify_pages: null,
    color_scheme: null, color_same_as_logo: null, add_ons: null, price_quoted: 1200,
    yearly_price: "300", follow_up_time: null, last_followup_status: null, no_pickup_streak: 0,
    closed_at: null, dropped_at: null, first_touch_at: null,
    direct_line_saved: null, fresh_or_followup: null, reference_link: null, design_reference_links: null,
    image_links: null, rating: null, comments: null, about_business: null, created_by: null, closed_by: null,
    created_at: "2026-07-18T00:00:00Z", updated_at: "2026-07-18T00:00:00Z", deleted_at: null,
    ...overrides,
  };
}

describe("parsePrice", () => {
  it("passes numbers through when positive", () => expect(parsePrice(1200)).toBe(1200));
  it("parses a numeric string, stripping symbols/commas", () => expect(parsePrice("$1,200.50")).toBe(1200.5));
  it("returns null for null, blank, zero, negative, or garbage", () => {
    expect(parsePrice(null)).toBeNull();
    expect(parsePrice("")).toBeNull();
    expect(parsePrice(0)).toBeNull();
    expect(parsePrice(-5)).toBeNull();
    expect(parsePrice("abc")).toBeNull();
  });
});

describe("buildContractSnapshot", () => {
  it("copies lead fields, coercing yearly_price string → number", () => {
    const s = buildContractSnapshot(lead(), { agentName: "Jordan", contractDate: "2026-07-18" });
    expect(s).toEqual({
      business_name: "Acme Plumbing", business_phone: "+1 555 111 2222", business_email: "owner@acme.test",
      one_time_price: 1200, yearly_price: 300, agent_name: "Jordan", contract_date: "2026-07-18",
    });
  });
  it("nulls prices that are missing/invalid", () => {
    const s = buildContractSnapshot(lead({ price_quoted: null, yearly_price: null }), { agentName: "J", contractDate: "2026-07-18" });
    expect(s.one_time_price).toBeNull();
    expect(s.yearly_price).toBeNull();
  });
});

describe("validateMergeFields", () => {
  it("passes a complete lead", () => expect(validateMergeFields(lead())).toEqual({ ok: true, missing: [] }));
  it("flags a blank business name", () => {
    expect(validateMergeFields(lead({ business_name: "  " })).missing).toContain("Business name");
  });
  it("flags a missing email (even when no_email is set — can't send without a recipient)", () => {
    const v = validateMergeFields(lead({ business_email: null, no_email: true }));
    expect(v.ok).toBe(false);
    expect(v.missing).toContain("Business email");
  });
  it("flags a missing one-time price", () => {
    expect(validateMergeFields(lead({ price_quoted: null })).missing).toContain("One-time price");
  });
});

describe("contractLines / formatUsd", () => {
  it("formats currency and dashes for null", () => {
    expect(formatUsd(1200)).toBe("$1,200.00");
    expect(formatUsd(null)).toBe("—");
  });
  it("produces labelled display lines with merged values", () => {
    const s = buildContractSnapshot(lead(), { agentName: "Jordan", contractDate: "2026-07-18" });
    const lines = contractLines(s);
    expect(lines.find((l) => l.label === "Business")?.value).toBe("Acme Plumbing");
    expect(lines.find((l) => l.label === "One-time price")?.value).toBe("$1,200.00");
    expect(lines.find((l) => l.label === "Yearly price")?.value).toBe("$300.00");
    expect(lines.find((l) => l.label === "Prepared by")?.value).toBe("Jordan");
  });
});

describe("applyPriceOverrides", () => {
  const base = () => buildContractSnapshot(lead(), { agentName: "Jordan", contractDate: "2026-07-18" });

  it("keeps the lead's values when no override is given", () => {
    const s = applyPriceOverrides(base(), {});
    expect(s.one_time_price).toBe(1200);
    expect(s.yearly_price).toBe(300);
  });
  it("keeps a value when only the other field is overridden", () => {
    const s = applyPriceOverrides(base(), { one_time_price: 900 });
    expect(s.one_time_price).toBe(900);
    expect(s.yearly_price).toBe(300);
  });
  it("honours an explicit null as 'no price'", () => {
    const s = applyPriceOverrides(base(), { yearly_price: null });
    expect(s.yearly_price).toBeNull();
  });
  it("treats a zero override as cleared, not as $0.00", () => {
    expect(applyPriceOverrides(base(), { yearly_price: 0 }).yearly_price).toBeNull();
  });
  it("leaves every non-price field untouched", () => {
    const s = applyPriceOverrides(base(), { one_time_price: 750 });
    expect(s.business_name).toBe("Acme Plumbing");
    expect(s.agent_name).toBe("Jordan");
    expect(s.contract_date).toBe("2026-07-18");
  });
});

describe("validateSnapshotFields", () => {
  const snap = (over: Partial<ContractSnapshot> = {}): ContractSnapshot => ({
    ...buildContractSnapshot(lead(), { agentName: "Jordan", contractDate: "2026-07-18" }),
    ...over,
  });

  it("passes a complete snapshot", () => expect(validateSnapshotFields(snap())).toEqual({ ok: true, missing: [] }));
  it("lets an override satisfy a lead with no quoted price", () => {
    const s = applyPriceOverrides(
      buildContractSnapshot(lead({ price_quoted: null }), { agentName: "Jordan", contractDate: "2026-07-18" }),
      { one_time_price: 500 }
    );
    expect(validateSnapshotFields(s)).toEqual({ ok: true, missing: [] });
  });
  it("still rejects when the final one-time price is missing", () => {
    const s = applyPriceOverrides(snap(), { one_time_price: null });
    expect(validateSnapshotFields(s).missing).toContain("One-time price");
  });
  it("flags a blank name or missing email", () => {
    expect(validateSnapshotFields(snap({ business_name: "  " })).missing).toContain("Business name");
    expect(validateSnapshotFields(snap({ business_email: null })).missing).toContain("Business email");
  });
});
