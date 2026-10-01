// @vitest-environment node
import { describe, it, expect, vi } from "vitest";

vi.mock("@/lib/notifications/notify", () => ({ notify: vi.fn(async () => {}) }));

import { checkDomainHealth, classifyHealth, dueForCheck, HEALTH_RECHECK_MS, HEALTH_STALE_MS, type SiteProbe } from "@/lib/domains/health";
import type { DomainHealth } from "@/lib/domains/types";

/**
 * Site health: one state per check, a streak, and an alert only when an outage
 * is CONFIRMED (two failed checks in a row) on a site that should be up.
 */

const now = new Date("2026-10-02T12:00:00Z");
const probe = (over: Partial<SiteProbe> = {}): SiteProbe => ({
  dns: { apex: ["76.13.203.71"], www: ["76.13.203.71"] },
  tls: { authorized: true, error: null, validTo: "2026-12-30T19:05:58.000Z", issuer: "Let's Encrypt" },
  http: { status: 200, finalUrl: "https://acme.com/", ms: 420 },
  httpError: null,
  ...over,
});

describe("classifyHealth", () => {
  it("answers over HTTPS with a valid certificate → up", () => {
    expect(classifyHealth(probe(), null, now)).toMatchObject({ state: "up", summary: "Up — answered in 420 ms", http_status: 200, ms: 420, consecutive_failures: 0, since: now.toISOString() });
  });

  it("points nowhere → no_dns; only at Hostinger's parking page → parked", () => {
    expect(classifyHealth(probe({ dns: { apex: [], www: [] } }), null, now)?.state).toBe("no_dns");
    expect(classifyHealth(probe({ dns: { apex: ["2.57.91.91"], www: ["2.57.91.91"] } }), null, now)?.state).toBe("parked");
  });

  it("nothing on 443, an error page or no HTTP answer → down", () => {
    expect(classifyHealth(probe({ tls: null }), null, now)).toMatchObject({ state: "down", summary: "Nothing answers on HTTPS" });
    expect(classifyHealth(probe({ http: { status: 403, finalUrl: "", ms: 90 } }), null, now)?.summary).toMatch(/403/);
    expect(classifyHealth(probe({ http: { status: 502, finalUrl: "", ms: 90 } }), null, now)?.summary).toMatch(/server is failing/);
    expect(classifyHealth(probe({ http: null, httpError: "timed out" }), null, now)).toMatchObject({ state: "down", summary: "The site didn't answer (timed out)" });
  });

  it("a bad certificate → ssl_error, in plain words", () => {
    expect(classifyHealth(probe({ tls: { authorized: false, error: "CERT_HAS_EXPIRED", validTo: null, issuer: null } }), null, now)).toMatchObject({
      state: "ssl_error",
      summary: "The SSL certificate has expired",
    });
    expect(classifyHealth(probe({ tls: { authorized: false, error: "ERR_TLS_CERT_ALTNAME_INVALID", validTo: null, issuer: null } }), null, now)?.summary).toBe(
      "The SSL certificate is for a different site",
    );
  });

  it("our own DNS lookup failing decides nothing", () => {
    expect(classifyHealth(probe({ dns: { apex: null, www: [] } }), null, now)).toBeNull();
  });

  it("counts failures in a row and keeps when the state began", () => {
    const first = classifyHealth(probe({ tls: null }), null, now)!;
    expect(first.consecutive_failures).toBe(1);
    const later = new Date(now.getTime() + 300_000);
    const second = classifyHealth(probe({ tls: null }), first, later)!;
    expect(second).toMatchObject({ consecutive_failures: 2, since: now.toISOString() });
    const back = classifyHealth(probe(), second, later)!;
    expect(back).toMatchObject({ state: "up", consecutive_failures: 0, since: later.toISOString() });
  });
});

type HealthRowT = Parameters<typeof dueForCheck>[0][number];
const hrow = (id: string, checkedAgoMs: number | null, failures = 0): HealthRowT => ({
  id,
  domain: `${id}.com`,
  status: "connected",
  registrar_status: "active",
  lead_id: null,
  health_state: checkedAgoMs === null ? null : failures ? "down" : "up",
  health: checkedAgoMs === null ? {} : ({ consecutive_failures: failures } as DomainHealth),
  health_checked_at: checkedAgoMs === null ? null : new Date(now.getTime() - checkedAgoMs).toISOString(),
});

describe("dueForCheck", () => {
  it("a confirmation re-check first, then never-checked, then the stalest; fresh ones wait", () => {
    const rows = [
      hrow("fresh", 60_000),
      hrow("stale", HEALTH_STALE_MS + 1000),
      hrow("never", null),
      hrow("failing", HEALTH_RECHECK_MS + 1000, 1),
      hrow("failing-too-soon", 60_000, 1),
    ];
    expect(dueForCheck(rows, now, 10).map((r) => r.id)).toEqual(["failing", "never", "stale"]);
    expect(dueForCheck(rows, now, 1).map((r) => r.id)).toEqual(["failing"]);
  });
});

describe("checkDomainHealth", () => {
  function fakeDb() {
    const writes: { table: string; op: string; value: unknown }[] = [];
    const admin = {
      from: (table: string) => ({
        update: (value: unknown) => ({ eq: async () => (writes.push({ table, op: "update", value }), { error: null }) }),
        insert: async (value: unknown) => (writes.push({ table, op: "insert", value }), { error: null }),
      }),
    };
    return { admin: admin as never, writes };
  }

  it("stores the result and its history row; alerts only on the SECOND failure in a row", async () => {
    const db = fakeDb();
    const notify = vi.fn(async () => {});
    const down = probe({ tls: null });
    const row = { ...hrow("site", HEALTH_STALE_MS + 1), health_state: null, health: {} } as HealthRowT;

    const first = await checkDomainHealth(db.admin, row, { probe: async () => down, notify, now });
    expect(first?.consecutive_failures).toBe(1);
    expect(notify).not.toHaveBeenCalled();
    expect(db.writes.map((w) => `${w.table}:${w.op}`)).toEqual(["client_domains:update", "client_domain_checks:insert"]);
    expect(db.writes[1].value).toMatchObject({ domain_id: "site", state: "down", error: "Nothing answers on HTTPS" });

    const second = await checkDomainHealth(db.admin, { ...row, health_state: "down", health: first! }, { probe: async () => down, notify, now: new Date(now.getTime() + 300_000) });
    expect(second?.consecutive_failures).toBe(2);
    expect(notify).toHaveBeenCalledTimes(1);
    expect(notify).toHaveBeenCalledWith("domain_site_down", expect.anything(), expect.objectContaining({ title: "Site down: site.com", targetUrl: "/domains/site" }));
  });

  it("no alert for a domain with no site to serve (unassigned) or an expired one", async () => {
    const db = fakeDb();
    const notify = vi.fn(async () => {});
    const failing = { consecutive_failures: 1, state: "down", since: now.toISOString() } as DomainHealth;
    for (const over of [{ status: "unassigned" as const }, { registrar_status: "expired" }]) {
      await checkDomainHealth(db.admin, { ...hrow("x", 1, 1), health: failing, ...over } as HealthRowT, { probe: async () => probe({ tls: null }), notify, now });
    }
    expect(notify).not.toHaveBeenCalled();
  });

  it("an inconclusive probe writes nothing", async () => {
    const db = fakeDb();
    const h = await checkDomainHealth(db.admin, hrow("x", null), { probe: async () => probe({ dns: { apex: null, www: null } }), now });
    expect(h).toBeNull();
    expect(db.writes).toEqual([]);
  });
});
