// @vitest-environment node
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

/**
 * Import brings the domains we already own into the dashboard — from the
 * Hostinger portfolio as well as the Cloudflare account. What must hold:
 *   - a domain whose site is up (hosted on Hostinger, or live elsewhere) is
 *     `connected` and the pipeline never touches it; only a domain pointing
 *     nowhere is `unassigned`;
 *   - expired portfolio entries and the company's own domains stay out;
 *   - re-running refreshes registrar facts only, never status/lead, and never
 *     a row listed under the other registrar.
 */

const cf = vi.hoisted(() => ({ listRegistrations: vi.fn() }));
const hg = vi.hoisted(() => ({ listDomains: vi.fn(), listWebsites: vi.fn() }));
const dns = vi.hoisted(() => ({ dnsUse: vi.fn() }));
vi.mock("@/lib/cloudflare/client", () => cf);
vi.mock("@/lib/hostinger/client", () => hg);
vi.mock("@/lib/domains/dns", () => dns);

import { importAllDomains, importCloudflareDomains, importHostingerDomains, hostingerOwned } from "@/lib/domains/import";

type Rec = Record<string, unknown>;
let seq = 0;
function fakeDb(tables: Record<string, Rec[]>) {
  function q(table: string, op: "select" | "update", patch?: Rec) {
    const filters: ((r: Rec) => boolean)[] = [];
    const run = () => {
      const rows = (tables[table] ??= []).filter((r) => filters.every((f) => f(r)));
      if (op === "update") for (const r of rows) Object.assign(r, patch);
      return rows.map((r) => ({ ...r }));
    };
    const b: Rec = {
      eq: (k: string, v: unknown) => (filters.push((r) => r[k] === v), b),
      neq: (k: string, v: unknown) => (filters.push((r) => r[k] !== v), b),
      in: (k: string, vs: unknown[]) => (filters.push((r) => vs.includes(r[k])), b),
      // only the shape import uses: "col.ilike.%needle%,col.ilike.%other%"
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
      insert: (row: Rec) => {
        const all = (tables[table] ??= []);
        const dup = table === "client_domains" && all.some((r) => r.domain === row.domain);
        if (!dup) all.push({ id: `row-${++seq}`, ...row });
        const res = dup ? { data: null, error: { message: "duplicate key value violates unique constraint" } } : { data: null, error: null };
        return { then: (r: (v: unknown) => unknown) => Promise.resolve(res).then(r) };
      },
    }),
  };
  return { admin: admin as never, tables };
}

const site = (domain: string, username = "u447231526") => ({ domain, username, root_directory: "", vhost_type: "", order_id: 1, is_enabled: true });
const owned = (domain: string, status = "active", expires_at: string | null = "2027-03-01T00:00:00Z") => ({ id: ++seq, domain, type: "domain", status, expires_at });

const ENV = { list: process.env.PROTECTED_DOMAINS, apex: process.env.DA_DOMAIN };
beforeEach(() => {
  vi.clearAllMocks();
  process.env.PROTECTED_DOMAINS = "socialexpertdigitalllc.com,sedsolutions.online";
  process.env.DA_DOMAIN = "dmviral.com";
});
afterEach(() => {
  process.env.PROTECTED_DOMAINS = ENV.list;
  process.env.DA_DOMAIN = ENV.apex;
});

describe("hostingerOwned", () => {
  it("keeps registered domains only — expired and not-yet-set-up entries stay out", () => {
    expect(hostingerOwned([owned("Live.com"), owned("lapsed.com", "expired"), owned("pending.com", "pending_setup")])).toEqual([
      { domain: "live.com", autoRenew: null, expiresAt: "2027-03-01T00:00:00Z" },
    ]);
  });

  it("a name listed twice (a plan's free domain, then registered for real) comes in once, with the real expiry", () => {
    // seen live 2026-10-02: carterfamilytowing.com as free_domain (no expiry) AND as a paid domain
    const free = { ...owned("twice.com", "active", null), type: "free_domain" };
    const paid = owned("twice.com", "active", "2026-12-17T21:08:22Z");
    for (const order of [[free, paid], [paid, free]]) {
      expect(hostingerOwned(order)).toEqual([{ domain: "twice.com", autoRenew: null, expiresAt: "2026-12-17T21:08:22Z" }]);
    }
  });
});

describe("importHostingerDomains", () => {
  it("hosted sites come in connected and linked to their lead; parked unassigned; live elsewhere connected; company domains left out", async () => {
    hg.listDomains.mockResolvedValue([
      owned("hosted.com"),
      owned("parked.com"),
      owned("elsewhere.com"),
      owned("lapsed.com", "expired"),
      owned("sedsolutions.online"),
      owned("dmviral.com"),
    ]);
    hg.listWebsites.mockResolvedValue([site("hosted.com"), site("sedsolutions.online", "u461699018")]);
    dns.dnsUse.mockImplementation(async (d: string) => (d === "parked.com" ? "free" : "in_use"));
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
      expires_at: "2027-03-01T00:00:00Z",
      created_by: "admin-1",
    });
    // Hostinger doesn't report auto-renew per domain — unknown, not "off"
    expect(rows["hosted.com"]).not.toHaveProperty("auto_renew");
    // a free domain is never linked by import: linking starts the setup
    expect(rows["parked.com"]).toMatchObject({ status: "unassigned", lead_id: null });
    expect(rows["elsewhere.com"]).toMatchObject({ status: "connected", lead_id: null, hosting_username: null });
    // DNS is only asked about domains Hostinger doesn't host
    expect(dns.dnsUse.mock.calls.map((c) => c[0]).sort()).toEqual(["elsewhere.com", "parked.com"]);
    expect(db.tables.activity_log).toEqual([expect.objectContaining({ action: "domain.imported", new_value: expect.objectContaining({ registrar: "hostinger", added: 3 }) })]);
  });

  it("re-running refreshes only the expiry — status, lead and auto-renew stay; a Cloudflare row of the same name is left alone", async () => {
    hg.listDomains.mockResolvedValue([owned("mine.com", "active", "2028-01-01T00:00:00Z"), owned("moved.com")]);
    hg.listWebsites.mockResolvedValue([site("mine.com"), site("moved.com")]);
    const db = fakeDb({
      leads: [],
      client_domains: [
        { id: "d1", domain: "mine.com", registrar: "hostinger", status: "live", lead_id: "lead-9", auto_renew: true, expires_at: "2027-01-01T00:00:00Z" },
        { id: "d2", domain: "moved.com", registrar: "cloudflare", status: "connected", lead_id: null, auto_renew: true, expires_at: "2026-12-01T00:00:00Z" },
      ],
    });

    const r = await importHostingerDomains(db.admin, "admin-1");
    expect(r).toMatchObject({ ok: true, summary: { added: 0, refreshed: 1, skipped: 1 } });
    expect(db.tables.client_domains[0]).toMatchObject({ status: "live", lead_id: "lead-9", auto_renew: true, expires_at: "2028-01-01T00:00:00Z" });
    expect(db.tables.client_domains[1]).toMatchObject({ registrar: "cloudflare", expires_at: "2026-12-01T00:00:00Z" });
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
      client_domains: [{ id: "d1", domain: "first.com", registrar: "cloudflare", status: "live", lead_id: "lead-1" }],
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
  it("records auto-renew and flags it when off; a domain pointing nowhere is unassigned", async () => {
    cf.listRegistrations.mockResolvedValue([{ domain_name: "CfOne.com", status: "active", auto_renew: false, expires_at: "2027-05-01T00:00:00Z" }]);
    hg.listWebsites.mockResolvedValue([]);
    dns.dnsUse.mockResolvedValue("free");
    const db = fakeDb({ leads: [], client_domains: [] });

    const r = await importCloudflareDomains(db.admin, "admin-1");
    expect(r).toMatchObject({ ok: true, summary: { added: 1, unassigned: 1, autoRenewOff: ["cfone.com"] } });
    expect(db.tables.client_domains[0]).toMatchObject({ domain: "cfone.com", registrar: "cloudflare", status: "unassigned", auto_renew: false });
  });
});

describe("importAllDomains", () => {
  it("reads the website list once for both registrars", async () => {
    hg.listWebsites.mockResolvedValue([site("a.com"), site("b.com")]);
    hg.listDomains.mockResolvedValue([owned("a.com")]);
    cf.listRegistrations.mockResolvedValue([{ domain_name: "b.com", status: "active", auto_renew: true, expires_at: null }]);
    const db = fakeDb({ leads: [], client_domains: [] });

    const r = await importAllDomains(db.admin, "admin-1", { cloudflare: true });
    expect(r).toMatchObject({ ok: true, hostinger: { ok: true, summary: { added: 1 } }, cloudflare: { ok: true, summary: { added: 1 } } });
    expect(hg.listWebsites).toHaveBeenCalledTimes(1);
    expect(db.tables.client_domains.map((x) => [x.domain, x.registrar])).toEqual([["a.com", "hostinger"], ["b.com", "cloudflare"]]);
  });

  it("skips Cloudflare when it isn't configured", async () => {
    hg.listWebsites.mockResolvedValue([]);
    hg.listDomains.mockResolvedValue([]);
    const db = fakeDb({ leads: [], client_domains: [] });

    const r = await importAllDomains(db.admin, "admin-1", { cloudflare: false });
    expect(r).toMatchObject({ ok: true, cloudflare: null, hostinger: { ok: true } });
    expect(cf.listRegistrations).not.toHaveBeenCalled();
  });
});
