import { describe, it, expect } from "vitest";
import { computeDomainAnalytics, type AnalyticsRow } from "@/lib/domains/analytics";
import type { DomainHealth } from "@/lib/domains/types";

/**
 * The analytics page's numbers: counts that agree with each other, money
 * that only counts what will really be charged, and an action list that puts
 * what breaks a client's site first.
 */

const now = new Date("2026-10-02T12:00:00Z");
const day = (n: number) => new Date(now.getTime() + n * 86_400_000).toISOString();
let n = 0;
const health = (state: DomainHealth["state"], summary = state): DomainHealth => ({
  state,
  summary,
  http_status: state === "up" ? 200 : null,
  final_url: null,
  ms: state === "up" ? 400 : null,
  ssl: { valid: state !== "ssl_error", valid_to: day(60), issuer: "R11", error: null },
  dns: { apex: ["1.2.3.4"], www: [] },
  consecutive_failures: state === "down" ? 2 : 0,
  since: day(-1),
});
const row = (over: Partial<AnalyticsRow> = {}): AnalyticsRow => ({
  id: `d${++n}`,
  domain: `site${n}.com`,
  registrar: "hostinger",
  origin: "imported",
  lead_id: null,
  status: "connected",
  step: null,
  steps: {},
  last_error: null,
  next_run_at: null,
  claim_id: null,
  claimed_at: null,
  attempts: 0,
  cf_zone_id: null,
  hosting_username: "u447231526",
  hostinger_order_id: null,
  hostinger_subscription_id: "s",
  registration_cost_cents: null,
  renewal_cost_cents: 2019,
  currency: "USD",
  auto_renew: true,
  expires_at: day(200),
  purchased_by: null,
  purchased_at: null,
  created_by: null,
  created_at: "2026-10-01T00:00:00Z",
  updated_at: "2026-10-01T00:00:00Z",
  registrar_status: "active",
  registered_at: "2025-06-15T00:00:00Z",
  next_billing_at: day(173),
  synced_at: null,
  details: {},
  health_state: "up",
  health: health("up"),
  health_checked_at: day(0),
  leads: null,
  ...over,
});

describe("computeDomainAnalytics", () => {
  const rows: AnalyticsRow[] = [
    row({ id: "ok", domain: "ok.com", lead_id: "lead-1", leads: { business_name: "OK Co" } }),
    row({ id: "lapsing", domain: "lapsing.com", auto_renew: false, expires_at: day(5), next_billing_at: null, lead_id: "lead-2", leads: { business_name: "Lapsing LLC" } }),
    row({ id: "cf", domain: "cf.com", registrar: "cloudflare", renewal_cost_cents: 1046, hostinger_subscription_id: null, expires_at: day(20), next_billing_at: day(20) }),
    row({ id: "expired", domain: "expired.com", registrar_status: "expired", auto_renew: false, expires_at: day(-12), health_state: "parked", health: health("parked") }),
    row({ id: "down", domain: "down.com", health_state: "down", health: health("down", "Nothing answers on HTTPS") }),
    row({ id: "gone", domain: "gone.com", registrar_status: "missing" }),
    row({ id: "failed", domain: "failed.com", status: "failed", origin: "purchased", registration_cost_cents: 1046 }),
    row({ id: "bought", domain: "bought.com", origin: "purchased", status: "live", registration_cost_cents: 1046, purchased_at: day(-3), steps: { site: { state: "done", at: day(-3 + 0.25) } } }),
  ];
  const a = computeDomainAnalytics(
    rows,
    [
      { domain_id: "ok", checks: 10, up: 10, counted: 10, avg_ms: 400, last_down_at: null },
      { domain_id: "down", checks: 10, up: 6, counted: 10, avg_ms: 800, last_down_at: day(-1) },
    ],
    [
      { day: "2026-10-01", up: 9, counted: 10, avg_ms: 500 },
      { day: "2026-10-02", up: 0, counted: 0, avg_ms: null },
    ],
    now,
  );

  it("counts what we own: failed purchases and departed domains are not ours", () => {
    expect(a.totals).toMatchObject({ domains: 6, hostinger: 5, cloudflare: 1, expired: 1, missing: 1, active: 5 });
    expect(a.totals).toMatchObject({ autoRenewOn: 4, autoRenewOff: 1, expiring7: 1, expiring30: 2, atRisk30: 1 });
    expect(a.totals).toMatchObject({ sitesDown: 1, parked: 1, linked: 2, unlinked: 4 });
  });

  it("money counts only renewals that will happen; savings compare like with like", () => {
    // renewing & priced: ok, cf, down, bought (lapsing won't renew; expired isn't active)
    expect(a.money.annualRenewalCents).toBe(2019 + 1046 + 2019 + 2019);
    expect(a.money.annualAllCents).toBe(a.money.annualRenewalCents + 2019);
    expect(a.money.next30Cents).toBe(1046); // only cf.com bills within 30 days
    expect(a.money.spentCents).toBe(1046); // the failed purchase charged nothing
    // 3 renewing Hostinger .com domains would each save 20.19 − 10.46
    expect(a.money.savings).toEqual({ domains: 3, cents: 3 * (2019 - 1046) });
  });

  it("KPIs", () => {
    expect(a.kpis.uptime30).toBe(80); // 16 up of 20 counted
    expect(a.kpis.avgResponseMs).toBe(Math.round((400 * 10 + 800 * 6) / 16));
    expect(a.kpis.autoRenewRate).toBe(80);
    expect(a.kpis.setupSuccessRate).toBe(100);
    expect(a.kpis.medianSetupHours).toBe(6);
  });

  it("the renewal calendar starts this month and splits by whether it renews", () => {
    expect(a.charts.renewalCalendar).toHaveLength(12);
    expect(a.charts.renewalCalendar[0]).toMatchObject({ month: "2026-10", renewing: 1, notRenewing: 1, cents: 1046 });
  });

  it("uptime per day; a day with no counted checks is a gap, not 0%", () => {
    expect(a.charts.uptimeDaily).toEqual([
      { day: "2026-10-01", uptime: 90, avgMs: 500 },
      { day: "2026-10-02", uptime: null, avgMs: null },
    ]);
  });

  it("action items: what breaks a client's site first, soonest first", () => {
    expect(a.lists.actionItems.map((i) => [i.domain, i.kind, i.severity])).toEqual([
      ["expired.com", "expired", 3], // its site was connected: a client is offline
      ["lapsing.com", "expiring", 3], // 5 days, auto-renew off
      ["down.com", "down", 3],
      ["gone.com", "missing", 1],
    ]);
    // cf.com expires in 20 days but renews by itself — nothing to do
    expect(a.lists.actionItems.find((i) => i.domain === "cf.com")).toBeUndefined();
    expect(a.lists.actionItems.find((i) => i.domain === "down.com")?.detail).toBe("Nothing answers on HTTPS");
  });

  it("least reliable sites", () => {
    expect(a.lists.worstUptime).toEqual([{ id: "down", domain: "down.com", uptime: 60, downChecks: 4, lastDownAt: day(-1) }]);
  });
});
