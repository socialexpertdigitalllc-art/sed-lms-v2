// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from "vitest";
import { readFileSync } from "node:fs";

/**
 * When a lead turns Ready, the LMS checks whether the business's exact name
 * is free as a .com and keeps the answer on the lead's Domain card — so sales
 * knows before the domain conversation with the customer.
 */

const cf = vi.hoisted(() => ({
  cloudflareConfigured: vi.fn(() => true),
  registrarSandbox: vi.fn(() => false),
  checkDomains: vi.fn(),
  registerDomain: vi.fn(),
  searchDomains: vi.fn(),
  setAutoRenew: vi.fn(),
}));
const hg = vi.hoisted(() => ({
  hostingerConfigured: vi.fn(() => true),
  checkHostingerAvailability: vi.fn(),
  getHostingerDomainPrice: vi.fn(),
  purchaseHostingerDomain: vi.fn(),
  enableHostingerAutoRenew: vi.fn(),
  disableHostingerAutoRenew: vi.fn(),
}));
vi.mock("@/lib/cloudflare/client", () => cf);
vi.mock("@/lib/hostinger/client", () => hg);
vi.mock("@/lib/site-studio/deploy/golive", () => ({ findOrTrackStaging: vi.fn(), goLiveOnDomain: vi.fn(), recordSiteOnDomain: vi.fn() }));
vi.mock("@/lib/site-studio/deploy/snapshots", () => ({ snapshotSite: vi.fn() }));

import { checkExactDomains, type DomainOffer } from "@/lib/domains/service";
import { checkLeadDomains, dueLeadChecks, leadDomainCheckSweep, leadExactDomain, LEAD_CHECK_RETRY_MS, LEAD_CHECK_STALE_MS, type LeadDomainCheck } from "@/lib/domains/leadCheck";
import { exactSummary, exactVerdict } from "@/components/domains/ExactNameCheck";
import { CHECKS_PER_WINDOW, resetDomainChecks, takeDomainCheck } from "@/lib/domains/checkRate";

const now = new Date("2026-10-21T12:00:00Z");
const offer = (domain: string, over: Partial<DomainOffer> = {}): DomainOffer => ({
  domain,
  registrar: "cloudflare",
  available: true,
  reason: null,
  registrationCents: 1044,
  renewalCents: 1044,
  currency: "USD",
  ...over,
});

/** A Supabase stand-in: each table answers with what the test set, and writes are recorded. */
function fakeAdmin(tables: Record<string, { data?: unknown; error?: unknown }> = {}) {
  const upserts: { table: string; rows: unknown; opts: unknown }[] = [];
  const admin = {
    from(table: string) {
      const result = { data: tables[table]?.data ?? null, error: tables[table]?.error ?? null };
      const b: Record<string, unknown> = {};
      for (const m of ["select", "eq", "is", "in", "order"]) b[m] = () => b;
      b.maybeSingle = async () => result;
      b.upsert = async (rows: unknown, opts: unknown) => (upserts.push({ table, rows, opts }), { error: tables[`${table}:upsert`]?.error ?? null });
      b.then = (res: (v: unknown) => unknown, rej?: (e: unknown) => unknown) => Promise.resolve(result).then(res, rej);
      return b;
    },
  };
  return { admin: admin as never, upserts };
}

describe("leadExactDomain", () => {
  it("the business name as one word, always on .com", () => {
    expect(leadExactDomain("ABC Construction")).toBe("abcconstruction.com");
    expect(leadExactDomain("Mr. Fix It LLC")).toBe("mrfixitllc.com");
    expect(leadExactDomain("J&K Remodeling")).toBe("jkremodeling.com");
    expect(leadExactDomain("acme.net")).toBe("acme.com"); // the exact NAME, on .com
  });

  it("nothing usable → null", () => {
    expect(leadExactDomain("")).toBeNull();
    expect(leadExactDomain(null)).toBeNull();
    expect(leadExactDomain("&&& !!!")).toBeNull();
  });
});

describe("checkExactDomains", () => {
  beforeEach(() => vi.clearAllMocks());

  it("Cloudflare: 20 names per call, keyed by name; a premium name is not available", async () => {
    const names = Array.from({ length: 25 }, (_, i) => `n${i}.com`);
    cf.checkDomains.mockImplementation(async (ds: string[]) => ds.map((name) => ({ name, registrable: name !== "n3.com", tier: name === "n4.com" ? "premium" : undefined, reason: name === "n3.com" ? "domain_unavailable" : undefined, pricing: { currency: "USD", registration_cost: "10.44", renewal_cost: "10.44" } })));
    const out = await checkExactDomains(names, "cloudflare");
    expect(cf.checkDomains).toHaveBeenCalledTimes(2);
    expect(cf.checkDomains.mock.calls[0][0]).toHaveLength(20);
    expect(out?.size).toBe(25);
    expect(out?.get("n0.com")).toMatchObject({ available: true, registrationCents: 1044 });
    expect(out?.get("n3.com")).toMatchObject({ available: false, reason: "Taken" });
    expect(out?.get("n4.com")).toMatchObject({ available: false, reason: expect.stringMatching(/Premium/) });
  });

  it("Cloudflare unreachable → null; Hostinger one name at a time", async () => {
    cf.checkDomains.mockResolvedValue(null);
    expect(await checkExactDomains(["a.com"], "cloudflare")).toBeNull();
    hg.checkHostingerAvailability.mockResolvedValue({ available: false, restriction: null });
    hg.getHostingerDomainPrice.mockResolvedValue({ itemId: "x", firstCents: 999, renewCents: 1599, currency: "USD" });
    const out = await checkExactDomains(["a.com", "b.com"], "hostinger");
    expect(hg.checkHostingerAvailability).toHaveBeenCalledTimes(2);
    expect(out?.get("a.com")).toMatchObject({ available: false, reason: "Taken" });
  });
});

describe("checkLeadDomains", () => {
  it("stores one row per lead, replacing the last; a name the registrar didn't answer is stored as unknown", async () => {
    const { admin, upserts } = fakeAdmin();
    const check = vi.fn(async () => new Map([["abcconstruction.com", offer("abcconstruction.com")]]));
    const rows = await checkLeadDomains(
      admin,
      [
        { id: "L1", business_name: "ABC Construction" },
        { id: "L2", business_name: "Zed Roofing" },
        { id: "L3", business_name: "!!!" },
      ],
      { check, registrar: "cloudflare", now },
    );
    expect(check).toHaveBeenCalledWith(["abcconstruction.com", "zedroofing.com"], "cloudflare");
    expect(upserts[0]).toMatchObject({ table: "lead_domain_checks", opts: { onConflict: "lead_id" } });
    expect(rows).toEqual([
      expect.objectContaining({ lead_id: "L1", domain: "abcconstruction.com", available: true, registration_cents: 1044, error: null, checked_at: now.toISOString() }),
      expect.objectContaining({ lead_id: "L2", domain: "zedroofing.com", available: null, error: expect.stringMatching(/no answer/) }),
    ]);
  });

  it("no registrar configured, or no usable names → nothing checked", async () => {
    const { admin, upserts } = fakeAdmin();
    const check = vi.fn();
    expect(await checkLeadDomains(admin, [{ id: "L1", business_name: "ABC" }], { check, registrar: null })).toEqual([]);
    expect(await checkLeadDomains(admin, [{ id: "L1", business_name: "" }], { check, registrar: "cloudflare" })).toEqual([]);
    expect(check).not.toHaveBeenCalled();
    expect(upserts).toEqual([]);
  });
});

describe("dueLeadChecks", () => {
  const ago = (ms: number) => new Date(now.getTime() - ms).toISOString();
  const c = (lead_id: string, domain: string, available: boolean | null, age: number) => ({ lead_id, domain, available, checked_at: ago(age) });

  it("never checked first, then renamed, a failed check due for a retry, then week-old answers; fresh ones wait", () => {
    const leads = [
      { id: "fresh", business_name: "Fresh Co" },
      { id: "stale", business_name: "Stale Co" },
      { id: "failed", business_name: "Failed Co" },
      { id: "failed-recent", business_name: "Recent Co" },
      { id: "renamed", business_name: "New Name" },
      { id: "never", business_name: "Never Co" },
      { id: "unusable", business_name: "!!!" },
    ];
    const checks = [
      c("fresh", "freshco.com", true, 60_000),
      c("stale", "staleco.com", false, LEAD_CHECK_STALE_MS + 1),
      c("failed", "failedco.com", null, LEAD_CHECK_RETRY_MS + 1),
      c("failed-recent", "recentco.com", null, 60_000),
      c("renamed", "oldname.com", true, 60_000),
    ];
    expect(dueLeadChecks(leads, checks, now, 10).map((l) => l.id)).toEqual(["renamed", "never", "failed", "stale"]);
    expect(dueLeadChecks(leads, checks, now, 1).map((l) => l.id)).toEqual(["renamed"]);
  });
});

describe("leadDomainCheckSweep", () => {
  it("checks the Ready leads that are due", async () => {
    const { admin, upserts } = fakeAdmin({
      leads: { data: [{ id: "L1", business_name: "ABC Construction" }, { id: "L2", business_name: "Done Co" }] },
      lead_domain_checks: { data: [{ lead_id: "L2", domain: "doneco.com", available: true, checked_at: now.toISOString() }] },
    });
    const check = vi.fn(async () => new Map([["abcconstruction.com", offer("abcconstruction.com", { available: false, reason: "Taken" })]]));
    expect(await leadDomainCheckSweep(admin, { check, registrar: "cloudflare", now })).toEqual({ checked: 1 });
    expect(check).toHaveBeenCalledWith(["abcconstruction.com"], "cloudflare");
    expect((upserts[0].rows as LeadDomainCheck[])[0]).toMatchObject({ lead_id: "L1", available: false, reason: "Taken" });
  });

  it("before migration 0091 (no table) it quietly does nothing", async () => {
    const { admin } = fakeAdmin({ leads: { data: [{ id: "L1", business_name: "ABC" }] }, lead_domain_checks: { error: { message: "relation does not exist" } } });
    const check = vi.fn();
    expect(await leadDomainCheckSweep(admin, { check, registrar: "cloudflare", now })).toEqual({ checked: 0 });
    expect(check).not.toHaveBeenCalled();
  });
});

describe("the card's words", () => {
  const row = (over: Partial<LeadDomainCheck>): LeadDomainCheck => ({
    lead_id: "L1",
    domain: "abc.com",
    available: true,
    reason: null,
    registration_cents: 1044,
    renewal_cents: 1044,
    currency: "USD",
    registrar: "cloudflare",
    error: null,
    checked_at: now.toISOString(),
    ...over,
  });

  it("available, taken, premium, unknown", () => {
    expect(exactVerdict(row({}))).toEqual({ label: "Available", tone: "ready" });
    expect(exactVerdict(row({ available: false, reason: "Taken" }))).toEqual({ label: "Taken", tone: "dropped" });
    expect(exactVerdict(row({ available: false, reason: "Premium price — buy in the Cloudflare dashboard" }))).toEqual({ label: "Premium", tone: "notready" });
    expect(exactVerdict(row({ available: null }))).toEqual({ label: "Couldn't check", tone: "neutral" });
    expect(exactVerdict(null).label).toBe("Not checked");
  });

  it("the collapsed card's summary names the answer, never a stale one", () => {
    expect(exactSummary("abc.com", row({}))).toBe("abc.com available");
    expect(exactSummary("abc.com", row({ available: false, reason: "Taken" }))).toBe("abc.com taken");
    expect(exactSummary("new.com", row({}))).toBeNull(); // checked under an older business name
    expect(exactSummary("abc.com", row({ available: null }))).toBeNull();
  });
});

describe("the per-person brake on checks", () => {
  it("allows CHECKS_PER_WINDOW in five minutes, then refuses until they age out", () => {
    resetDomainChecks();
    const t = now.getTime();
    for (let i = 0; i < CHECKS_PER_WINDOW; i++) expect(takeDomainCheck("u1", t)).toBe(true);
    expect(takeDomainCheck("u1", t)).toBe(false);
    expect(takeDomainCheck("u2", t)).toBe(true); // per person
    expect(takeDomainCheck("u1", t + 5 * 60_000)).toBe(true);
  });
});

describe("wiring", () => {
  it("every way a lead turns Ready starts the check: one lead, a follow-up, a bulk change", () => {
    const patch = readFileSync("app/api/leads/[id]/route.ts", "utf8");
    expect(patch).toMatch(/newStatus === "Ready"\) \{\s+\/\/[^\n]*\n[^\n]*\n\s+kickLeadDomainChecks\(\[id\]\)/);
    expect(readFileSync("app/api/leads/[id]/follow-ups/route.ts", "utf8")).toMatch(/statusChange === "Ready"\) \{\s+kickLeadDomainChecks\(\[id\]\)/);
    expect(readFileSync("app/api/leads/bulk/route.ts", "utf8")).toMatch(/if \(value === "Ready"\) kickLeadDomainChecks\(changed\.map/);
  });

  it("the 15-minute domains sweep catches the rest (imports, new Ready leads, renamed ones)", () => {
    expect(readFileSync("app/api/domains/sweep/route.ts", "utf8")).toMatch(/leadDomainCheckSweep\(admin\)/);
  });
});
