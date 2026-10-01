// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from "vitest";

/**
 * Buying spends real money, non-refundable. The guarantees pinned here:
 *   - the domain row is reserved BEFORE anything is checked or bought, so a
 *     double click / second admin can never buy the same name twice;
 *   - the server re-checks the price and refuses unless it is EXACTLY what
 *     the buyer confirmed — and then never calls the registrar;
 *   - anything that fails before the registrar call releases the reservation.
 */

const cf = vi.hoisted(() => ({
  registrarSandbox: vi.fn(() => false),
  checkDomains: vi.fn(),
  registerDomain: vi.fn(),
  searchDomains: vi.fn(),
  setAutoRenew: vi.fn(),
}));
const hg = vi.hoisted(() => ({
  checkHostingerAvailability: vi.fn(),
  getHostingerDomainPrice: vi.fn(),
  purchaseHostingerDomain: vi.fn(),
  enableHostingerAutoRenew: vi.fn(),
}));
vi.mock("@/lib/cloudflare/client", () => cf);
vi.mock("@/lib/hostinger/client", () => hg);
// keep the transfer module (normalizeTargetDomain) away from DirectAdmin/Hostinger imports
vi.mock("@/lib/site-studio/deploy/snapshots", () => ({ snapshotSite: vi.fn() }));

import { purchaseDomain, assignDomain } from "@/lib/domains/service";

type Rec = Record<string, unknown>;
let seq = 0;
function fakeDb(tables: Record<string, Rec[]>) {
  const log: { table: string; op: string; data?: Rec }[] = [];
  function q(table: string, op: "select" | "update" | "delete", patch?: Rec) {
    const filters: ((r: Rec) => boolean)[] = [];
    const run = () => {
      const all = (tables[table] ??= []);
      const rows = all.filter((r) => filters.every((f) => f(r)));
      if (op === "update") for (const r of rows) Object.assign(r, patch);
      if (op === "delete") tables[table] = all.filter((r) => !rows.includes(r));
      if (op !== "select") log.push({ table, op, data: patch });
      return rows.map((r) => ({ ...r }));
    };
    const b: Rec = {
      eq: (k: string, v: unknown) => (filters.push((r) => r[k] === v), b),
      neq: (k: string, v: unknown) => (filters.push((r) => r[k] !== v), b),
      in: (k: string, vs: unknown[]) => (filters.push((r) => vs.includes(r[k])), b),
      select: () => b,
      order: () => b,
      maybeSingle: async () => ({ data: run()[0] ?? null, error: null }),
      single: async () => {
        const d = run()[0];
        return { data: d ?? null, error: d ? null : { message: "no rows" } };
      },
      then: (res: (v: unknown) => unknown, rej?: (e: unknown) => unknown) => Promise.resolve({ data: run(), error: null }).then(res, rej),
    };
    return b;
  }
  const admin = {
    from: (table: string) => ({
      select: () => q(table, "select"),
      update: (patch: Rec) => q(table, "update", patch),
      delete: () => q(table, "delete"),
      insert: (row: Rec) => {
        const all = (tables[table] ??= []);
        const dup = table === "client_domains" && all.some((r) => r.domain === row.domain);
        const created = { id: `row-${++seq}`, ...row };
        if (!dup) all.push(created);
        log.push({ table, op: "insert", data: row });
        const res = dup ? { data: null, error: { message: "duplicate key value violates unique constraint" } } : { data: { ...created }, error: null };
        return { select: () => ({ single: async () => res }), then: (r: (v: unknown) => unknown) => Promise.resolve(res).then(r) };
      },
    }),
  };
  return { admin: admin as never, tables, log };
}

const offer = (over: Rec = {}) => ({
  name: "acme.com",
  registrable: true,
  tier: "standard",
  pricing: { currency: "USD", registration_cost: "10.46", renewal_cost: "10.46" },
  ...over,
});

beforeEach(() => {
  for (const m of [...Object.values(cf), ...Object.values(hg)]) m.mockReset();
  process.env.DA_DOMAIN = "dmviral.com";
  process.env.PROTECTED_DOMAINS = "sedlms.com";
});

const buy = (db: ReturnType<typeof fakeDb>, over: Rec = {}) =>
  purchaseDomain(db.admin, { domain: "acme.com", registrar: "cloudflare", leadId: "lead-1", expectedCents: 1046, actorId: "admin-1", ...over } as never);

describe("purchaseDomain — Cloudflare", () => {
  const leads = () => [{ id: "lead-1", website_link: null }];

  it("price confirmed: reserves, re-checks, buys ONCE, records the price, stays 'purchasing'", async () => {
    const db = fakeDb({ leads: leads(), client_domains: [] });
    cf.checkDomains.mockResolvedValue([offer()]);
    cf.registerDomain.mockResolvedValue({ ok: true, workflow: { state: "in_progress", completed: false } });
    const r = await buy(db);
    expect(r.ok).toBe(true);
    expect(cf.registerDomain).toHaveBeenCalledTimes(1);
    expect(cf.registerDomain).toHaveBeenCalledWith("acme.com");
    const row = db.tables.client_domains[0];
    expect(row).toMatchObject({ domain: "acme.com", status: "purchasing", registration_cost_cents: 1046, lead_id: "lead-1", purchased_by: "admin-1" });
    expect(db.log.some((l) => l.table === "activity_log" && (l.data as Rec).action === "domain.purchased")).toBe(true);
  });

  it("price moved since the buyer confirmed: refuses, never buys, releases the reservation", async () => {
    const db = fakeDb({ leads: leads(), client_domains: [] });
    cf.checkDomains.mockResolvedValue([offer({ pricing: { currency: "USD", registration_cost: "12.00", renewal_cost: "12.00" } })]);
    const r = await buy(db);
    expect(r).toMatchObject({ ok: false, status: 409 });
    expect(!r.ok && r.error).toMatch(/\$12\.00/);
    expect(cf.registerDomain).not.toHaveBeenCalled();
    expect(db.tables.client_domains).toHaveLength(0);
  });

  it("taken or premium: refuses, never buys", async () => {
    for (const o of [offer({ registrable: false, reason: "domain_unavailable" }), offer({ tier: "premium" })]) {
      const db = fakeDb({ leads: leads(), client_domains: [] });
      cf.checkDomains.mockResolvedValue([o]);
      const r = await buy(db);
      expect(r.ok).toBe(false);
      expect(db.tables.client_domains).toHaveLength(0);
    }
    expect(cf.registerDomain).not.toHaveBeenCalled();
  });

  it("a name we already own (or are buying) is refused before anything is checked", async () => {
    const db = fakeDb({ leads: leads(), client_domains: [{ id: "x", domain: "acme.com", status: "purchasing" }] });
    const r = await buy(db);
    expect(r).toMatchObject({ ok: false, status: 409 });
    expect(cf.checkDomains).not.toHaveBeenCalled();
    expect(cf.registerDomain).not.toHaveBeenCalled();
  });

  it("an earlier FAILED purchase of the same name can be retried", async () => {
    const db = fakeDb({ leads: leads(), client_domains: [{ id: "x", domain: "acme.com", status: "failed" }] });
    cf.checkDomains.mockResolvedValue([offer()]);
    cf.registerDomain.mockResolvedValue({ ok: true, workflow: { state: "in_progress", completed: false } });
    expect((await buy(db)).ok).toBe(true);
    expect(db.tables.client_domains).toEqual([expect.objectContaining({ id: "x", status: "purchasing" })]);
  });

  it("Cloudflare's clear refusal (4xx) releases the reservation; an unclear answer keeps it for the processor to ask", async () => {
    const db1 = fakeDb({ leads: leads(), client_domains: [] });
    cf.checkDomains.mockResolvedValue([offer()]);
    cf.registerDomain.mockResolvedValue({ ok: false, status: 400, message: "contact missing" });
    expect(await buy(db1)).toMatchObject({ ok: false });
    expect(db1.tables.client_domains).toHaveLength(0);

    const db2 = fakeDb({ leads: leads(), client_domains: [] });
    cf.registerDomain.mockResolvedValue({ ok: false, status: 0, message: "socket hang up" });
    expect((await buy(db2)).ok).toBe(true);
    expect(db2.tables.client_domains[0]).toMatchObject({ status: "purchasing" });
  });

  it("a lead that already has a domain can't get a second one", async () => {
    const db = fakeDb({ leads: leads(), client_domains: [{ id: "y", domain: "other.com", lead_id: "lead-1", status: "live" }] });
    expect(await buy(db)).toMatchObject({ ok: false, status: 409 });
    expect(cf.checkDomains).not.toHaveBeenCalled();
  });

  it("staging and company domains are never bought", async () => {
    for (const domain of ["foo.dmviral.com", "sedlms.com"]) {
      const db = fakeDb({ leads: leads(), client_domains: [] });
      expect(await buy(db, { domain })).toMatchObject({ ok: false, status: 422 });
    }
    expect(cf.checkDomains).not.toHaveBeenCalled();
  });
});

describe("purchaseDomain — Hostinger", () => {
  it("orders the catalog item at the confirmed price and records the order", async () => {
    const db = fakeDb({ leads: [{ id: "lead-1" }], client_domains: [] });
    hg.checkHostingerAvailability.mockResolvedValue({ available: true, restriction: null });
    hg.getHostingerDomainPrice.mockResolvedValue({ itemId: "hostingercom-domain-com-usd-1y", firstCents: 999, renewCents: 1999, currency: "USD" });
    hg.purchaseHostingerDomain.mockResolvedValue({ ok: true, registered: false, orderStatus: "payment_initiated", orderId: 77, subscriptionId: "sub-1" });
    const r = await buy(db, { registrar: "hostinger", expectedCents: 999 });
    expect(r.ok).toBe(true);
    expect(hg.purchaseHostingerDomain).toHaveBeenCalledWith("acme.com", "hostingercom-domain-com-usd-1y");
    expect(db.tables.client_domains[0]).toMatchObject({ registrar: "hostinger", hostinger_order_id: 77, hostinger_subscription_id: "sub-1", renewal_cost_cents: 1999 });
  });
});

describe("assignDomain", () => {
  it("linking an unassigned domain starts the automatic setup", async () => {
    const db = fakeDb({ leads: [{ id: "lead-1", website_link: null }], client_domains: [{ id: "d1", domain: "acme.com", status: "unassigned", lead_id: null, steps: {} }] });
    const r = await assignDomain(db.admin, "d1", "lead-1", "admin-1");
    expect(r).toMatchObject({ ok: true, kick: true });
    expect(db.tables.client_domains[0]).toMatchObject({ lead_id: "lead-1", status: "setting_up", step: null });
  });

  it("linking a domain set up by hand only links it (and fills an empty website link)", async () => {
    const lead = { id: "lead-1", website_link: null as string | null };
    const db = fakeDb({ leads: [lead], client_domains: [{ id: "d1", domain: "acme.com", status: "connected", lead_id: null }] });
    const r = await assignDomain(db.admin, "d1", "lead-1", "admin-1");
    expect(r).toMatchObject({ ok: true, kick: false });
    expect(db.tables.client_domains[0]).toMatchObject({ status: "connected", lead_id: "lead-1" });
    expect(db.tables.leads[0].website_link).toBe("https://acme.com");
  });

  it("a lead keeps one domain", async () => {
    const db = fakeDb({
      leads: [{ id: "lead-1" }],
      client_domains: [
        { id: "d1", domain: "acme.com", status: "unassigned", lead_id: null },
        { id: "d2", domain: "other.com", status: "live", lead_id: "lead-1" },
      ],
    });
    expect(await assignDomain(db.admin, "d1", "lead-1", "admin-1")).toMatchObject({ ok: false, status: 409 });
  });

  it("unlinking stops an active setup (the running worker's claim is cleared)", async () => {
    const db = fakeDb({ leads: [], client_domains: [{ id: "d1", domain: "acme.com", status: "setting_up", lead_id: "lead-1", claim_id: "w1" }] });
    expect((await assignDomain(db.admin, "d1", null, "admin-1")).ok).toBe(true);
    expect(db.tables.client_domains[0]).toMatchObject({ status: "unassigned", lead_id: null, claim_id: null });
  });
});
