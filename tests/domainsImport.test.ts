// @vitest-environment node
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

/**
 * The sync keeps the dashboard in step with BOTH registrars. What must hold:
 *   - a NEW domain whose site is up (hosted on Hostinger, or live elsewhere) is
 *     `connected` and the pipeline never touches it; only a domain pointing
 *     nowhere is `unassigned`; the company's own domains stay out;
 *   - expired registrations come in too (to be renewed from the dashboard);
 *   - a KNOWN domain only gets registrar facts refreshed — only when they
 *     changed, never its status or lead, never a row under the other registrar,
 *     and an unknown fact (null) never erases a stored one;
 *   - a domain the registrar stops listing is marked `missing`, unless the
 *     listing looks short (then nothing is marked);
 *   - renewal reminders go out at 30 / 7 / 1 days for domains NOT set to renew,
 *     and once when a domain expires.
 */

const cf = vi.hoisted(() => ({ listRegistrations: vi.fn(), checkDomains: vi.fn(async () => []) }));
const hg = vi.hoisted(() => ({ listDomains: vi.fn(), listWebsites: vi.fn(), listSubscriptions: vi.fn(async () => []) }));
const dns = vi.hoisted(() => ({ dnsUse: vi.fn() }));
const notifications = vi.hoisted(() => ({ notify: vi.fn(async () => {}) }));
vi.mock("@/lib/cloudflare/client", () => cf);
vi.mock("@/lib/hostinger/client", () => hg);
vi.mock("@/lib/domains/dns", () => dns);
vi.mock("@/lib/notifications/notify", () => notifications);

import {
  factsPatch,
  hostingerOwned,
  importAllDomains,
  importCloudflareDomains,
  importHostingerDomains,
  renewalBucket,
  sendRenewalAlerts,
  type KnownFacts,
  type OwnedDomain,
} from "@/lib/domains/import";

type Rec = Record<string, unknown>;
let seq = 0;
function fakeDb(tables: Record<string, Rec[]>) {
  const writes: { table: string; op: string; patch?: Rec }[] = [];
  function q(table: string, op: "select" | "update" | "delete", patch?: Rec) {
    const filters: ((r: Rec) => boolean)[] = [];
    const run = () => {
      const rows = (tables[table] ??= []).filter((r) => filters.every((f) => f(r)));
      if (op === "update") for (const r of rows) Object.assign(r, patch);
      if (op === "delete") tables[table] = (tables[table] ?? []).filter((r) => !rows.includes(r));
      if (op !== "select") writes.push({ table, op, patch });
      return rows.map((r) => ({ ...r }));
    };
    const b: Rec = {
      eq: (k: string, v: unknown) => (filters.push((r) => r[k] === v), b),
      neq: (k: string, v: unknown) => (filters.push((r) => r[k] !== v), b),
      in: (k: string, vs: unknown[]) => (filters.push((r) => vs.includes(r[k])), b),
      // only the shape the sync uses: "col.ilike.%needle%,col.ilike.%other%"
      or: (expr: string) => {
        const parts = expr.split(",").map((p) => p.match(/^(\w+)\.ilike\.%(.*)%$/)!);
        filters.push((r) => parts.some(([, col, needle]) => String(r[col] ?? "").toLowerCase().includes(needle.toLowerCase())));
        return b;
      },
      select: () => b,
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
        if (!dup) all.push({ id: `row-${++seq}`, ...row });
        writes.push({ table, op: "insert", patch: row });
        const res = dup ? { data: null, error: { message: "duplicate key value violates unique constraint" } } : { data: null, error: null };
        return { then: (r: (v: unknown) => unknown) => Promise.resolve(res).then(r) };
      },
    }),
  };
  return { admin: admin as never, tables, writes };
}

const site = (domain: string, username = "u447231526") => ({ domain, username, root_directory: "", vhost_type: "", order_id: 1, is_enabled: true });
const owned = (domain: string, status = "active", expires_at: string | null = "2027-03-01T10:20:30Z") => ({
  id: ++seq,
  domain,
  type: "domain",
  status,
  expires_at,
  created_at: "2025-03-01T10:20:00Z",
});
const sub = (over: Rec) => ({
  id: `sub-${++seq}`,
  name: ".COM Domain",
  status: "active",
  is_auto_renewed: true,
  renewal_price: 2019,
  total_price: 2019,
  currency_code: "USD",
  created_at: "2025-12-15T22:00:00Z",
  expires_at: null,
  next_billing_at: null,
  ...over,
});

const ENV = { list: process.env.PROTECTED_DOMAINS, apex: process.env.DA_DOMAIN };
beforeEach(() => {
  vi.clearAllMocks();
  hg.listSubscriptions.mockResolvedValue([]);
  cf.checkDomains.mockResolvedValue([]);
  process.env.PROTECTED_DOMAINS = "socialexpertdigitalllc.com,sedsolutions.online";
  process.env.DA_DOMAIN = "dmviral.com";
});
afterEach(() => {
  process.env.PROTECTED_DOMAINS = ENV.list;
  process.env.DA_DOMAIN = ENV.apex;
});

describe("hostingerOwned", () => {
  it("brings expired registrations in too, and names in-flight ones pending", () => {
    const out = hostingerOwned([owned("Live.com"), owned("lapsed.com", "expired"), owned("ordered.com", "pending_setup")]);
    expect(out.map((o) => [o.domain, o.registrarStatus])).toEqual([
      ["live.com", "active"],
      ["lapsed.com", "expired"],
      ["ordered.com", "pending"],
    ]);
    expect(out[0]).toMatchObject({ registeredAt: "2025-03-01T10:20:00Z", expiresAt: "2027-03-01T10:20:30Z" });
  });

  it("a name listed twice (a plan's free domain, then registered for real) comes in once, with the real expiry", () => {
    // seen live 2026-10-02: carterfamilytowing.com as free_domain (no expiry) AND as a paid domain
    const free = { ...owned("twice.com", "active", null), type: "free_domain" };
    const paid = owned("twice.com", "active", "2026-12-17T21:08:22Z");
    for (const order of [[free, paid], [paid, free]]) {
      const out = hostingerOwned(order);
      expect(out).toHaveLength(1);
      expect(out[0]).toMatchObject({ domain: "twice.com", expiresAt: "2026-12-17T21:08:22Z" });
    }
  });

  it("reads auto-renew, price and next charge off the domain's matched subscription", () => {
    const out = hostingerOwned(
      [owned("renews.com"), owned("stops.com", "active", "2026-11-13T18:36:12Z")],
      [
        sub({ next_billing_at: "2027-02-02T10:20:30Z" }), // 27 days before renews.com's expiry, same second
        sub({ status: "non_renewing", is_auto_renewed: false, expires_at: "2026-11-13T18:36:12Z" }),
      ],
    );
    expect(out[0]).toMatchObject({ autoRenew: true, renewalCents: 2019, currency: "USD", nextBillingAt: "2027-02-02T10:20:30Z", details: { subscription_status: "active" } });
    expect(out[1]).toMatchObject({ autoRenew: false, nextBillingAt: null, details: { subscription_status: "non_renewing" } });
    expect(out[0].subscriptionId).toMatch(/^sub-/);
  });
});

describe("factsPatch", () => {
  const known: KnownFacts = {
    registrar_status: "active",
    auto_renew: true,
    expires_at: "2027-03-01T10:20:30+00:00",
    registered_at: "2025-03-01T10:20:00+00:00",
    next_billing_at: "2027-02-02T10:20:30+00:00",
    renewal_cost_cents: 2019,
    currency: "USD",
    hostinger_subscription_id: "sub-1",
    details: { subscription_status: "active", locked: true },
  };
  const d = (over: Partial<OwnedDomain> = {}): OwnedDomain => ({
    domain: "x.com",
    registrarStatus: "active",
    autoRenew: true,
    expiresAt: "2027-03-01T10:20:30Z",
    registeredAt: "2025-03-01T10:20:00Z",
    nextBillingAt: "2027-02-02T10:20:30Z",
    renewalCents: 2019,
    currency: "USD",
    subscriptionId: "sub-1",
    details: { locked: true, subscription_status: "active" },
    ...over,
  });

  it("nothing changed (same instants in another format, keys in another order) → no write at all", () => {
    expect(factsPatch(known, d())).toEqual({});
  });

  it("writes exactly what changed", () => {
    expect(factsPatch(known, d({ registrarStatus: "expired", autoRenew: false, nextBillingAt: null, details: { subscription_status: "cancelled" } }))).toEqual({
      registrar_status: "expired",
      auto_renew: false,
      next_billing_at: null,
      details: { subscription_status: "cancelled", locked: true },
    });
  });

  it("a fact the registrar doesn't report never erases a stored one", () => {
    expect(factsPatch(known, d({ autoRenew: null, nextBillingAt: null, renewalCents: null, currency: null, subscriptionId: null, details: {} }))).toEqual({});
  });
});

describe("importHostingerDomains", () => {
  it("hosted sites come in connected and linked to their lead; parked unassigned; live elsewhere connected; company domains left out", async () => {
    hg.listDomains.mockResolvedValue([owned("hosted.com"), owned("parked.com"), owned("elsewhere.com"), owned("sedsolutions.online"), owned("dmviral.com")]);
    hg.listWebsites.mockResolvedValue([site("hosted.com"), site("sedsolutions.online", "u461699018")]);
    dns.dnsUse.mockImplementation(async (domain: string) => (domain === "parked.com" ? "free" : "in_use"));
    const db = fakeDb({
      leads: [
        { id: "lead-1", website_link: "https://www.hosted.com/" },
        { id: "lead-2", website_link: "parked.com" },
      ],
      client_domains: [],
    });

    const r = await importHostingerDomains(db.admin, "admin-1");
    expect(r).toMatchObject({ ok: true, summary: { total: 3, added: 3, connected: 2, unassigned: 1, linked: 1, skipped: 0 } });

    const rows = Object.fromEntries(db.tables.client_domains.map((x) => [x.domain, x]));
    expect(Object.keys(rows).sort()).toEqual(["elsewhere.com", "hosted.com", "parked.com"]);
    expect(rows["hosted.com"]).toMatchObject({
      registrar: "hostinger",
      origin: "imported",
      status: "connected",
      lead_id: "lead-1",
      hosting_username: "u447231526",
      registrar_status: "active",
      expires_at: "2027-03-01T10:20:30Z",
      registered_at: "2025-03-01T10:20:00Z",
      created_by: "admin-1",
    });
    // no subscription matched → auto-renew unknown, not "off"
    expect(rows["hosted.com"]).not.toHaveProperty("auto_renew");
    // a free domain is never linked by the sync: linking starts the setup
    expect(rows["parked.com"]).toMatchObject({ status: "unassigned", lead_id: null });
    expect(rows["elsewhere.com"]).toMatchObject({ status: "connected", lead_id: null, hosting_username: null });
    // DNS is only asked about domains Hostinger doesn't host
    expect(dns.dnsUse.mock.calls.map((c) => c[0]).sort()).toEqual(["elsewhere.com", "parked.com"]);
    expect(db.tables.activity_log).toEqual([expect.objectContaining({ action: "domain.synced", new_value: expect.objectContaining({ registrar: "hostinger", added: 3 }) })]);
  });

  it("an expired registration comes in (to be renewed) with its state", async () => {
    hg.listDomains.mockResolvedValue([owned("lapsed.com", "expired", "2026-08-11T16:17:36Z")]);
    hg.listWebsites.mockResolvedValue([site("lapsed.com")]);
    const db = fakeDb({ leads: [], client_domains: [] });

    const r = await importHostingerDomains(db.admin, "admin-1");
    expect(r).toMatchObject({ ok: true, summary: { added: 1, expired: 1 } });
    expect(db.tables.client_domains[0]).toMatchObject({ domain: "lapsed.com", registrar_status: "expired", status: "connected" });
  });

  it("re-running writes only what changed — never status or lead — and leaves a Cloudflare row of the same name alone", async () => {
    hg.listDomains.mockResolvedValue([owned("mine.com", "active", "2028-01-01T00:00:00Z"), owned("same.com"), owned("moved.com")]);
    hg.listWebsites.mockResolvedValue([site("mine.com"), site("same.com"), site("moved.com")]);
    const db = fakeDb({
      leads: [],
      client_domains: [
        { id: "d1", domain: "mine.com", registrar: "hostinger", status: "live", lead_id: "lead-9", registrar_status: "active", auto_renew: true, expires_at: "2027-01-01T00:00:00Z", registered_at: null, details: {} },
        { id: "d2", domain: "same.com", registrar: "hostinger", status: "connected", lead_id: null, registrar_status: "active", auto_renew: null, expires_at: "2027-03-01T10:20:30+00:00", registered_at: "2025-03-01T10:20:00+00:00", details: {} },
        { id: "d3", domain: "moved.com", registrar: "cloudflare", status: "connected", lead_id: null, registrar_status: "active", auto_renew: true, expires_at: "2026-12-01T00:00:00Z", details: {} },
      ],
    });

    const r = await importHostingerDomains(db.admin, "admin-1");
    expect(r).toMatchObject({ ok: true, summary: { added: 0, refreshed: 1, skipped: 1 } });
    expect(db.tables.client_domains[0]).toMatchObject({ status: "live", lead_id: "lead-9", auto_renew: true, expires_at: "2028-01-01T00:00:00Z" });
    expect(db.tables.client_domains[2]).toMatchObject({ registrar: "cloudflare", expires_at: "2026-12-01T00:00:00Z" });
    // the only per-row write is mine.com's; same.com had nothing new
    const rowWrites = db.writes.filter((w) => w.table === "client_domains" && w.op === "update" && w.patch && !("synced_at" in w.patch) && !("registrar_status" in w.patch && w.patch.registrar_status === "missing"));
    expect(rowWrites).toHaveLength(1);
    expect(rowWrites[0].patch).toMatchObject({ expires_at: "2028-01-01T00:00:00Z", registered_at: "2025-03-01T10:20:00Z" });
  });

  it("a known domain the registrar stops listing is marked missing (not deleted); an in-flight purchase is left alone", async () => {
    hg.listDomains.mockResolvedValue([owned("kept.com")]);
    hg.listWebsites.mockResolvedValue([site("kept.com")]);
    const db = fakeDb({
      leads: [],
      client_domains: [
        { id: "d1", domain: "kept.com", registrar: "hostinger", status: "connected", registrar_status: "active", details: {} },
        { id: "d2", domain: "gone.com", registrar: "hostinger", status: "connected", registrar_status: "active", details: {} },
        { id: "d3", domain: "buying.com", registrar: "hostinger", status: "purchasing", registrar_status: null, details: {} },
      ],
    });
    const r = await importHostingerDomains(db.admin, "admin-1");
    expect(r).toMatchObject({ ok: true, summary: { missing: 1 } });
    expect(db.tables.client_domains.map((x) => [x.domain, x.registrar_status])).toEqual([
      ["kept.com", "active"],
      ["gone.com", "missing"],
      ["buying.com", null],
    ]);
  });

  it("a listing that suddenly lacks many known domains marks none of them (a short answer, not a mass transfer)", async () => {
    hg.listDomains.mockResolvedValue([owned("a.com")]);
    hg.listWebsites.mockResolvedValue([site("a.com")]);
    const known = ["a", "b", "c", "d", "e", "f", "g", "h"].map((n, i) => ({
      id: `d${i}`,
      domain: `${n}.com`,
      registrar: "hostinger",
      status: "connected",
      registrar_status: "active",
      details: {},
    }));
    const db = fakeDb({ leads: [], client_domains: known });
    const r = await importHostingerDomains(db.admin, "admin-1");
    expect(r).toMatchObject({ ok: true, summary: { missing: 0 } });
    expect(db.tables.client_domains.every((x) => x.registrar_status === "active")).toBe(true);
  });

  it("a domain whose DNS can't be read is skipped this time, not guessed", async () => {
    hg.listDomains.mockResolvedValue([owned("flaky.com")]);
    hg.listWebsites.mockResolvedValue([]);
    dns.dnsUse.mockResolvedValue(null);
    const db = fakeDb({ leads: [], client_domains: [] });

    const r = await importHostingerDomains(db.admin, "admin-1");
    expect(r).toMatchObject({ ok: true, summary: { added: 0, skipped: 1 } });
    expect(db.tables.client_domains).toEqual([]);
  });

  it("never links a lead that already has a working domain (one per lead)", async () => {
    hg.listDomains.mockResolvedValue([owned("second.com")]);
    hg.listWebsites.mockResolvedValue([site("second.com")]);
    const db = fakeDb({
      leads: [{ id: "lead-1", website_link: "https://second.com" }],
      client_domains: [{ id: "d1", domain: "first.com", registrar: "cloudflare", status: "live", lead_id: "lead-1", details: {} }],
    });

    const r = await importHostingerDomains(db.admin, "admin-1");
    expect(r).toMatchObject({ ok: true, summary: { added: 1, linked: 0 } });
    expect(db.tables.client_domains.find((x) => x.domain === "second.com")).toMatchObject({ status: "connected", lead_id: null });
  });

  it("an unreadable portfolio is an error, not an empty account", async () => {
    hg.listDomains.mockResolvedValue(null);
    const db = fakeDb({ leads: [], client_domains: [] });
    expect(await importHostingerDomains(db.admin, "admin-1")).toEqual({ ok: false, error: expect.stringMatching(/Hostinger/) });
    expect(db.tables.client_domains).toEqual([]);
  });
});

describe("importCloudflareDomains", () => {
  it("records auto-renew, lock and privacy, and Cloudflare's renewal price; a domain pointing nowhere is unassigned", async () => {
    cf.listRegistrations.mockResolvedValue([
      { domain_name: "CfOne.com", status: "active", auto_renew: false, expires_at: "2027-05-01T00:00:00Z", created_at: "2026-05-01T00:00:00Z", locked: true, privacy_mode: "redaction" },
    ]);
    cf.checkDomains.mockResolvedValue([{ name: "sed-lms-price-check-7f3k2q.com", registrable: true, pricing: { currency: "USD", registration_cost: "10.46", renewal_cost: "10.46" } }] as never);
    hg.listWebsites.mockResolvedValue([]);
    dns.dnsUse.mockResolvedValue("free");
    const db = fakeDb({ leads: [], client_domains: [] });

    const r = await importCloudflareDomains(db.admin, "admin-1");
    expect(r).toMatchObject({ ok: true, summary: { added: 1, unassigned: 1, autoRenewOff: ["cfone.com"] } });
    expect(db.tables.client_domains[0]).toMatchObject({
      domain: "cfone.com",
      registrar: "cloudflare",
      status: "unassigned",
      auto_renew: false,
      renewal_cost_cents: 1046,
      currency: "USD",
      next_billing_at: null, // not renewing → no charge coming
      details: { locked: true, privacy: true },
    });
  });

  it("a failed price lookup never fails the sync", async () => {
    cf.listRegistrations.mockResolvedValue([{ domain_name: "x.com", status: "active", auto_renew: true, expires_at: null }]);
    cf.checkDomains.mockRejectedValue(new Error("boom"));
    hg.listWebsites.mockResolvedValue([site("x.com")]);
    const db = fakeDb({ leads: [], client_domains: [] });
    expect(await importCloudflareDomains(db.admin, "admin-1")).toMatchObject({ ok: true, summary: { added: 1 } });
  });
});

describe("importAllDomains", () => {
  it("reads the website list once for both registrars", async () => {
    hg.listWebsites.mockResolvedValue([site("a.com"), site("b.com")]);
    hg.listDomains.mockResolvedValue([owned("a.com")]);
    cf.listRegistrations.mockResolvedValue([{ domain_name: "b.com", status: "active", auto_renew: true, expires_at: null }]);
    const db = fakeDb({ leads: [], client_domains: [] });

    const r = await importAllDomains(db.admin, "admin-1", { cloudflare: true, notify: vi.fn(async () => {}) });
    expect(r).toMatchObject({ ok: true, hostinger: { ok: true, summary: { added: 1 } }, cloudflare: { ok: true, summary: { added: 1 } } });
    expect(hg.listWebsites).toHaveBeenCalledTimes(1);
    expect(db.tables.client_domains.map((x) => [x.domain, x.registrar])).toEqual([
      ["a.com", "hostinger"],
      ["b.com", "cloudflare"],
    ]);
  });

  it("skips Cloudflare when it isn't configured", async () => {
    hg.listWebsites.mockResolvedValue([]);
    hg.listDomains.mockResolvedValue([]);
    const db = fakeDb({ leads: [], client_domains: [] });

    const r = await importAllDomains(db.admin, "admin-1", { cloudflare: false, notify: vi.fn(async () => {}) });
    expect(r).toMatchObject({ ok: true, cloudflare: null, hostinger: { ok: true } });
    expect(cf.listRegistrations).not.toHaveBeenCalled();
  });

  it("a domain that expires during this sync triggers one 'expired' alert", async () => {
    hg.listWebsites.mockResolvedValue([site("lapsing.com")]);
    hg.listDomains.mockResolvedValue([owned("lapsing.com", "expired", "2026-09-30T00:00:00Z")]);
    const db = fakeDb({
      leads: [],
      client_domains: [{ id: "d1", domain: "lapsing.com", registrar: "hostinger", status: "connected", lead_id: null, registrar_status: "active", auto_renew: false, expires_at: "2026-09-30T00:00:00Z", details: {} }],
    });
    const notify = vi.fn(async () => {});
    const r = await importAllDomains(db.admin, null, { cloudflare: false, notify, now: new Date("2026-10-02T00:00:00Z") });
    expect(r).toMatchObject({ ok: true, alerts: 1 });
    expect(notify).toHaveBeenCalledWith(
      "domain_renewal_due",
      expect.anything(),
      expect.objectContaining({ title: "Domain expired: lapsing.com", dedupKey: "domain_renewal_due:d1:expired:2026-09-30", targetUrl: "/domains/d1" }),
    );
  });
});

describe("renewal reminders", () => {
  const now = new Date("2026-10-02T00:00:00Z");

  it("buckets: 30, 7 and 1 day; nothing beyond 30 days or once past", () => {
    expect(renewalBucket("2026-10-25T00:00:00Z", now)).toBe("30d");
    expect(renewalBucket("2026-10-08T00:00:00Z", now)).toBe("7d");
    expect(renewalBucket("2026-10-02T20:00:00Z", now)).toBe("1d");
    expect(renewalBucket("2026-12-01T00:00:00Z", now)).toBeNull();
    expect(renewalBucket("2026-10-01T00:00:00Z", now)).toBeNull();
    expect(renewalBucket(null, now)).toBeNull();
  });

  it("only domains NOT set to renew are reminded, once per bucket", async () => {
    const db = fakeDb({
      client_domains: [
        { id: "a", domain: "off.com", lead_id: "lead-1", registrar: "hostinger", auto_renew: false, expires_at: "2026-10-08T00:00:00Z", registrar_status: "active", status: "connected" },
        { id: "b", domain: "on.com", lead_id: null, registrar: "cloudflare", auto_renew: true, expires_at: "2026-10-08T00:00:00Z", registrar_status: "active", status: "connected" },
        { id: "c", domain: "later.com", lead_id: null, registrar: "hostinger", auto_renew: false, expires_at: "2027-01-08T00:00:00Z", registrar_status: "active", status: "connected" },
        { id: "d", domain: "unknown.com", lead_id: null, registrar: "hostinger", auto_renew: null, expires_at: "2026-10-08T00:00:00Z", registrar_status: "active", status: "connected" },
      ],
    });
    const notify = vi.fn(async () => {});
    expect(await sendRenewalAlerts(db.admin, [], { notify, now })).toBe(1);
    expect(notify).toHaveBeenCalledWith(
      "domain_renewal_due",
      { leadId: "lead-1", lead: null },
      expect.objectContaining({ title: "off.com expires in 6 days", dedupKey: "domain_renewal_due:a:2026-10-08:7d", targetUrl: "/domains/a" }),
    );
  });
});
