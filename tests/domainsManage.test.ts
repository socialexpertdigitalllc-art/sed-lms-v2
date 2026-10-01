// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from "vitest";

/**
 * Managing a domain from the dashboard. What must hold:
 *   - DNS edits translate exactly to each registrar's model (Hostinger
 *     replaces whole name+type sets and keeps MX priority inside the content);
 *     a stale edit is refused instead of clobbering a newer record;
 *   - what a registrar's API can't do (Cloudflare: renew, transfer code,
 *     nameservers) is refused WITH the page to do it on — never faked;
 *   - money and hand-over actions are logged.
 */

const cf = vi.hoisted(() => ({
  getRegistration: vi.fn(),
  updateRegistration: vi.fn(async () => ({ ok: true })),
  findZone: vi.fn(),
  listDnsRecords: vi.fn(),
  createDnsRecord: vi.fn(async () => ({ ok: true })),
  updateDnsRecord: vi.fn(async () => ({ ok: true })),
  deleteDnsRecord: vi.fn(async () => ({ ok: true })),
}));
const hg = vi.hoisted(() => ({
  getHostingerDomainDetails: vi.fn(),
  getHostingerForwarding: vi.fn(async () => null),
  getHostingerDomainMove: vi.fn(async () => null),
  setHostingerDomainLock: vi.fn(async () => ({ ok: true })),
  setHostingerPrivacy: vi.fn(async () => ({ ok: true })),
  setHostingerNameservers: vi.fn(async () => ({ ok: true })),
  getHostingerAuthCode: vi.fn(async () => ({ ok: true, code: "EPP-123" })),
  renewHostingerSubscription: vi.fn(async () => ({ ok: true, pending: false, orderStatus: "completed", totalCents: 2019 })),
  getHostingerZone: vi.fn(),
  putHostingerZone: vi.fn(async () => ({ ok: true })),
  deleteHostingerZoneRecords: vi.fn(async () => ({ ok: true })),
  resetHostingerZone: vi.fn(async () => ({ ok: true })),
  listHostingerDnsSnapshots: vi.fn(),
  restoreHostingerDnsSnapshot: vi.fn(async () => ({ ok: true })),
  setHostingerForwarding: vi.fn(async () => ({ ok: true })),
  deleteHostingerForwarding: vi.fn(async () => ({ ok: true })),
  startHostingerDomainMove: vi.fn(async () => ({ ok: true })),
  cancelHostingerDomainMove: vi.fn(async () => ({ ok: true })),
}));
vi.mock("@/lib/cloudflare/client", () => cf);
vi.mock("@/lib/hostinger/client", () => hg);

import {
  changeDns,
  cleanNameservers,
  cloudflareRows,
  hostingerContent,
  hostingerRows,
  planHostingerChange,
  renewNow,
  revealAuthCode,
  startMove,
  updateRegistrarSettings,
  validateDns,
} from "@/lib/domains/manage";
import type { HostingerZoneRecord } from "@/lib/hostinger/client";

function fakeDb() {
  const log: Record<string, unknown>[] = [];
  const updates: Record<string, unknown>[] = [];
  const admin = {
    from: (table: string) => ({
      insert: async (v: Record<string, unknown>) => (table === "activity_log" ? log.push(v) : null, { error: null }),
      update: (v: Record<string, unknown>) => ({ eq: async () => (updates.push(v), { error: null }) }),
    }),
  };
  return { admin: admin as never, log, updates };
}

const hostingerRow = { id: "d1", domain: "acme.com", registrar: "hostinger" as const, details: {}, cf_zone_id: null, hostinger_subscription_id: "sub-1", registrar_status: "active", renewal_cost_cents: 2019, currency: "USD" };
const cloudflareRow = { ...hostingerRow, id: "d2", registrar: "cloudflare" as const, cf_zone_id: "z1", hostinger_subscription_id: null };

const ZONE: HostingerZoneRecord[] = [
  { name: "@", type: "ALIAS", ttl: 300, records: [{ content: "acme.com.cdn.hstgr.net." }] },
  { name: "@", type: "MX", ttl: 14400, records: [{ content: "5 mx1.hostinger.com." }, { content: "10 mx2.hostinger.com." }] },
  { name: "@", type: "TXT", ttl: 300, records: [{ content: '"v=spf1 include:_spf.mail.hostinger.com ~all"' }] },
  { name: "www", type: "CNAME", ttl: 300, records: [{ content: "www.acme.com.cdn.hstgr.net." }] },
];

beforeEach(() => vi.clearAllMocks());

describe("Hostinger DNS model", () => {
  it("rows: MX priority split out of the content; one row per record", () => {
    const rows = hostingerRows(ZONE);
    expect(rows).toHaveLength(5);
    expect(rows.find((r) => r.content === "mx2.hostinger.com.")).toMatchObject({ type: "MX", name: "@", priority: 10, raw: "10 mx2.hostinger.com.", ttl: 14400, editable: true });
  });

  it("content: MX carries its priority; TXT is quoted (once)", () => {
    expect(hostingerContent({ type: "MX", content: "mx3.example.com.", priority: 20 })).toBe("20 mx3.example.com.");
    expect(hostingerContent({ type: "TXT", content: "google-site-verification=abc" })).toBe('"google-site-verification=abc"');
    expect(hostingerContent({ type: "TXT", content: '"already quoted"' })).toBe('"already quoted"');
  });

  it("adding to an existing set rewrites the whole set with the new record in it", () => {
    const plan = planHostingerChange(ZONE, null, { type: "MX", name: "@", content: "mx3.example.com.", ttl: 3600, priority: 20 });
    expect(plan).toEqual({
      put: [{ name: "@", type: "MX", ttl: 3600, records: [{ content: "5 mx1.hostinger.com." }, { content: "10 mx2.hostinger.com." }, { content: "20 mx3.example.com." }] }],
      remove: [],
    });
  });

  it("editing one record of a set keeps its siblings", () => {
    const mx2 = hostingerRows(ZONE).find((r) => r.content === "mx2.hostinger.com.")!;
    const plan = planHostingerChange(ZONE, mx2, { type: "MX", name: "@", content: "mx9.example.com.", ttl: 14400, priority: 10 });
    expect(plan.put).toEqual([{ name: "@", type: "MX", ttl: 14400, records: [{ content: "5 mx1.hostinger.com." }, { content: "10 mx9.example.com." }] }]);
  });

  it("deleting the last record of a set removes the set; moving a record touches both sets", () => {
    const www = hostingerRows(ZONE).find((r) => r.name === "www")!;
    expect(planHostingerChange(ZONE, www, null)).toEqual({ put: [], remove: [{ name: "www", type: "CNAME" }] });
    const moved = planHostingerChange(ZONE, www, { type: "CNAME", name: "shop", content: "shops.example.com.", ttl: 300 });
    expect(moved.remove).toEqual([{ name: "www", type: "CNAME" }]);
    expect(moved.put).toEqual([{ name: "shop", type: "CNAME", ttl: 300, records: [{ content: "shops.example.com." }] }]);
  });
});

describe("Cloudflare DNS model", () => {
  it("names become relative to the domain", () => {
    const rows = cloudflareRows(
      [
        { id: "r1", type: "A", name: "acme.com", content: "76.13.203.71", proxied: false, ttl: 1 },
        { id: "r2", type: "CNAME", name: "www.acme.com", content: "acme.com", proxied: false, ttl: 1 },
        { id: "r3", type: "MX", name: "acme.com", content: "mx.acme.com", ttl: 300, priority: 10 },
      ],
      "acme.com",
    );
    expect(rows.map((r) => [r.name, r.type, r.priority, r.proxied])).toEqual([
      ["@", "A", null, false],
      ["www", "CNAME", null, false],
      ["@", "MX", 10, null],
    ]);
  });
});

describe("validateDns", () => {
  const ok = { type: "A", name: "@", content: "76.13.203.71", ttl: 300 };
  it("accepts a sound record", () => expect(validateDns("hostinger", ok)).toBeNull());
  it("refuses what would break or can't exist", () => {
    expect(validateDns("hostinger", { ...ok, content: "not-an-ip" })).toMatch(/IPv4/);
    expect(validateDns("hostinger", { ...ok, name: "bad name!" })).toMatch(/Name/);
    expect(validateDns("hostinger", { ...ok, type: "CNAME", content: "x.example.com" })).toMatch(/ALIAS/);
    expect(validateDns("cloudflare", { ...ok, type: "ALIAS", content: "x.example.com" })).toMatch(/Hostinger only/);
    expect(validateDns("hostinger", { ...ok, type: "MX", content: "mx.example.com", priority: null })).toMatch(/priority/);
    expect(validateDns("hostinger", { ...ok, ttl: 5 })).toMatch(/TTL/);
    expect(validateDns("hostinger", { ...ok, type: "NS", content: "ns1.example.com" })).toMatch(/can't be edited/);
  });
  it("Cloudflare's automatic TTL (1) is allowed", () => expect(validateDns("cloudflare", { ...ok, ttl: 1 })).toBeNull());
});

describe("changeDns", () => {
  it("a record that changed since the page loaded is refused, not overwritten", async () => {
    hg.getHostingerZone.mockResolvedValue(ZONE);
    const stale = { ...hostingerRows(ZONE)[0], id: "ALIAS|@|old.example.com.", raw: "old.example.com." };
    const r = await changeDns(fakeDb().admin, hostingerRow, { original: stale, next: null }, "u1");
    expect(r).toMatchObject({ ok: false, status: 409 });
    expect(hg.putHostingerZone).not.toHaveBeenCalled();
    expect(hg.deleteHostingerZoneRecords).not.toHaveBeenCalled();
  });

  it("Hostinger: writes the planned sets and logs the change", async () => {
    hg.getHostingerZone.mockResolvedValue(ZONE);
    const db = fakeDb();
    const r = await changeDns(db.admin, hostingerRow, { original: null, next: { type: "TXT", name: "@", content: "google-site-verification=abc", ttl: 300 } }, "u1");
    expect(r).toEqual({ ok: true });
    expect(hg.putHostingerZone).toHaveBeenCalledWith("acme.com", [
      { name: "@", type: "TXT", ttl: 300, records: [{ content: '"v=spf1 include:_spf.mail.hostinger.com ~all"' }, { content: '"google-site-verification=abc"' }] },
    ]);
    expect(db.log[0]).toMatchObject({ action: "domain.dns_changed", new_value: expect.objectContaining({ change: "added" }) });
  });

  it("Cloudflare: creates with the full name, proxy off by default, MX priority", async () => {
    await changeDns(fakeDb().admin, cloudflareRow, { original: null, next: { type: "MX", name: "@", content: "mx.acme.com", ttl: 300, priority: 5 } }, "u1");
    expect(cf.createDnsRecord).toHaveBeenCalledWith("z1", { type: "MX", name: "acme.com", content: "mx.acme.com", ttl: 300, proxied: undefined, priority: 5 });
    await changeDns(fakeDb().admin, cloudflareRow, { original: null, next: { type: "A", name: "shop", content: "1.2.3.4", ttl: 1 } }, "u1");
    expect(cf.createDnsRecord).toHaveBeenLastCalledWith("z1", { type: "A", name: "shop.acme.com", content: "1.2.3.4", ttl: 1, proxied: false });
  });
});

describe("renewal and hand-over", () => {
  it("Hostinger renews the matched subscription and logs it", async () => {
    const db = fakeDb();
    const r = await renewNow(db.admin, hostingerRow, "u1");
    expect(r).toEqual({ ok: true, pending: false, totalCents: 2019 });
    expect(hg.renewHostingerSubscription).toHaveBeenCalledWith("sub-1");
    expect(db.log[0]).toMatchObject({ action: "domain.renewed" });
  });

  it("no matched subscription → refused, never a guess", async () => {
    const r = await renewNow(fakeDb().admin, { ...hostingerRow, hostinger_subscription_id: null }, "u1");
    expect(r).toMatchObject({ ok: false, status: 422 });
    expect(hg.renewHostingerSubscription).not.toHaveBeenCalled();
  });

  it("Cloudflare can't renew, give a transfer code or change nameservers over its API — refused with the page to do it on", async () => {
    for (const r of [
      await renewNow(fakeDb().admin, cloudflareRow, "u1"),
      await revealAuthCode(fakeDb().admin, cloudflareRow, "u1"),
      await startMove(fakeDb().admin, cloudflareRow, "client@example.com", "u1"),
    ]) {
      expect(r).toMatchObject({ ok: false, status: 422, link: expect.stringContaining("dash.cloudflare.com") });
    }
    expect(await updateRegistrarSettings(fakeDb().admin, cloudflareRow, { nameservers: ["ns1.x.com", "ns2.x.com"] }, "u1")).toMatchObject({ ok: false, status: 422 });
  });

  it("the transfer code is logged when viewed", async () => {
    const db = fakeDb();
    expect(await revealAuthCode(db.admin, hostingerRow, "u1")).toEqual({ ok: true, code: "EPP-123" });
    expect(db.log[0]).toMatchObject({ action: "domain.auth_code_viewed" });
  });

  it("a move needs a real email and records who it went to", async () => {
    expect(await startMove(fakeDb().admin, hostingerRow, "not-an-email", "u1")).toMatchObject({ ok: false, status: 400 });
    const db = fakeDb();
    expect(await startMove(db.admin, hostingerRow, " Client@Example.com ", "u1")).toEqual({ ok: true });
    expect(hg.startHostingerDomainMove).toHaveBeenCalledWith("acme.com", "client@example.com");
    expect(db.updates[0]).toMatchObject({ details: { move: { email: "client@example.com", status: "initiated" } } });
  });
});

describe("cleanNameservers", () => {
  it("2–4 distinct hostnames, normalized", () => {
    expect(cleanNameservers(["NS1.Example.com.", " ns2.example.com "])).toEqual(["ns1.example.com", "ns2.example.com"]);
    expect(cleanNameservers(["ns1.example.com"])).toBeNull();
    expect(cleanNameservers(["ns1.example.com", "ns1.example.com"])).toBeNull();
    expect(cleanNameservers(["ns1.example.com", "not a host"])).toBeNull();
  });
});
