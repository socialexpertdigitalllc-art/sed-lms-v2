// @vitest-environment node
import { describe, it, expect, vi } from "vitest";
import { processDomains, SITE_RECHECK_MS } from "@/lib/domains/processor";
import { MAX_POLLS, type PipelineDeps } from "@/lib/domains/pipeline";
import type { ClientDomainRow } from "@/lib/domains/types";

/**
 * The processor: claims due rows (never two workers on one domain), chains
 * steps while they finish, schedules waits, stops loudly on failures, and
 * backs off when an operator changes the row mid-run.
 */

type Rec = Record<string, unknown>;

/** Just enough PostgREST: select/update with eq/neq/in filters, order/limit no-ops. */
function fakeDb(tables: Record<string, Rec[]>) {
  const log: { table: string; op: string; patch?: Rec }[] = [];
  function builder(table: string, op: "select" | "update", patch?: Rec) {
    const filters: ((r: Rec) => boolean)[] = [];
    const run = () => {
      const rows = (tables[table] ??= []).filter((r) => filters.every((f) => f(r)));
      if (op === "update") {
        for (const r of rows) Object.assign(r, patch);
        log.push({ table, op, patch });
      }
      return rows.map((r) => ({ ...r }));
    };
    const b: Rec = {
      eq: (k: string, v: unknown) => (filters.push((r) => r[k] === v), b),
      neq: (k: string, v: unknown) => (filters.push((r) => r[k] !== v), b),
      in: (k: string, vs: unknown[]) => (filters.push((r) => vs.includes(r[k])), b),
      order: () => b,
      limit: () => b,
      select: () => b,
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
      select: () => builder(table, "select"),
      update: (patch: Rec) => builder(table, "update", patch),
      insert: async (r: Rec) => {
        (tables[table] ??= []).push(r);
        log.push({ table, op: "insert", patch: r });
        return { data: null, error: null };
      },
    }),
  };
  return { admin: admin as unknown as PipelineDeps["admin"], log, tables };
}

function domainRow(over: Partial<ClientDomainRow> = {}): ClientDomainRow {
  return {
    id: "d1", domain: "acme.com", registrar: "cloudflare", origin: "purchased", lead_id: "lead-1",
    status: "purchasing", step: "registration", steps: {}, last_error: null, next_run_at: null,
    claim_id: null, claimed_at: null, attempts: 0, cf_zone_id: null, hosting_username: null,
    hostinger_order_id: null, hostinger_subscription_id: null, registration_cost_cents: 1046,
    renewal_cost_cents: 1046, currency: "USD", auto_renew: true, expires_at: null,
    purchased_by: "user-1", purchased_at: null, created_by: "user-1",
    created_at: "2026-10-02T00:00:00Z", updated_at: "2026-10-02T00:00:00Z",
  registrar_status: "active", registered_at: null, next_billing_at: null, synced_at: null, details: {}, health_state: null, health: {}, health_checked_at: null, ...over,
  };
}

const WEBSITE = { domain: "acme.com", username: "u447231526", root_directory: "/x", vhost_type: "addon", order_id: 1, is_enabled: true, website_type: "other" };

function happyDeps(admin: PipelineDeps["admin"], over: Partial<PipelineDeps> = {}): PipelineDeps {
  return {
    admin,
    cf: {
      getRegistrationStatus: vi.fn(async () => ({ state: "succeeded", completed: true, context: { registration: { domain_name: "acme.com", status: "active", auto_renew: true, expires_at: "2027-10-02T00:00:00Z" } } })),
      getRegistration: vi.fn(async () => null),
      setAutoRenew: vi.fn(async () => ({ ok: true })),
      findZone: vi.fn(async () => ({ id: "z1", name: "acme.com", status: "active" })),
      createZone: vi.fn(),
      listDnsRecords: vi.fn(async () => []),
      createDnsRecord: vi.fn(async () => ({ ok: true })),
      updateDnsRecord: vi.fn(async () => ({ ok: true })),
      deleteDnsRecord: vi.fn(async () => ({ ok: true })),
    } as unknown as PipelineDeps["cf"],
    hostinger: {
      getWebsite: vi.fn(async () => null),
      ensureWebsite: vi.fn(async () => ({ ok: true, website: WEBSITE, created: true })),
      verifyDomainOwnership: vi.fn(async () => ({ accessible: true, txt: null })),
      ensureSsl: vi.fn(async () => "active"),
      isStaticWebsite: () => true,
      websiteTypeLabel: () => "static",
      getHostingerPortfolioDomain: vi.fn(),
      completeHostingerDomainSetup: vi.fn(),
      enableHostingerAutoRenew: vi.fn(),
    } as unknown as PipelineDeps["hostinger"],
    goLive: vi.fn(async () => ({ ok: true, url: "https://acme.com", settled: true })) as unknown as PipelineDeps["goLive"],
    findStaging: vi.fn(async () => ({ id: "dep-1", url: "https://acmev1.dmviral.com" })) as unknown as PipelineDeps["findStaging"],
    probeVhost: vi.fn(async () => true),
    resolvesTo: vi.fn(async () => ["76.13.203.71"]),
    ...over,
  };
}

const NOW = new Date("2026-10-02T12:00:00Z");
const opts = (notify = vi.fn(async () => {})) => ({ now: () => NOW, notify: notify as never });

describe("processDomains", () => {
  it("a just-bought domain goes all the way to live in one pass when nothing has to wait", async () => {
    const db = fakeDb({ client_domains: [domainRow() as unknown as Rec], leads: [{ id: "lead-1", website_link: null, agent_id: "a1", closed_by: null }] });
    const out = await processDomains(happyDeps(db.admin), opts());
    expect(out).toEqual([expect.objectContaining({ domain: "acme.com", status: "live" })]);
    const r = db.tables.client_domains[0] as unknown as ClientDomainRow;
    expect(r.status).toBe("live");
    expect(r.claim_id).toBeNull(); // claim released with the last write
    expect(Object.keys(r.steps)).toEqual(["registration", "zone", "hosting", "dns", "ssl", "site"]);
    expect(Object.values(r.steps).every((s) => s?.state === "done")).toBe(true);
    expect(r.cf_zone_id).toBe("z1");
    expect(r.expires_at).toBe("2027-10-02T00:00:00Z");
  });

  it("a domain bought for stock (no lead) stops after registration as unassigned — no DNS, no hosting", async () => {
    const db = fakeDb({ client_domains: [domainRow({ lead_id: null }) as unknown as Rec] });
    const d = happyDeps(db.admin);
    await processDomains(d, opts());
    const r = db.tables.client_domains[0] as unknown as ClientDomainRow;
    expect(r.status).toBe("unassigned");
    expect(r.steps.registration?.state).toBe("done");
    expect(d.cf.findZone).not.toHaveBeenCalled();
    expect(d.hostinger.ensureWebsite).not.toHaveBeenCalled();
  });

  it("a wait schedules the next look, counts the attempt, keeps the status, releases the claim", async () => {
    const db = fakeDb({ client_domains: [domainRow() as unknown as Rec] });
    const d = happyDeps(db.admin);
    (d.cf.getRegistrationStatus as ReturnType<typeof vi.fn>).mockResolvedValue({ state: "in_progress", completed: false });
    await processDomains(d, opts());
    const r = db.tables.client_domains[0] as unknown as ClientDomainRow;
    expect(r.status).toBe("purchasing");
    expect(r.step).toBe("registration");
    expect(r.attempts).toBe(1);
    expect(Date.parse(r.next_run_at as string)).toBeGreaterThan(NOW.getTime());
    expect(r.claim_id).toBeNull();
  });

  it("a failed step stops the domain as needs_attention and alerts", async () => {
    const db = fakeDb({ client_domains: [domainRow({ status: "setting_up", step: "dns", cf_zone_id: "z1" }) as unknown as Rec], leads: [{ id: "lead-1", agent_id: "a1", closed_by: null }] });
    const d = happyDeps(db.admin);
    (d.cf.createDnsRecord as ReturnType<typeof vi.fn>).mockResolvedValue({ ok: false, message: "zone locked" });
    const notify = vi.fn(async () => {});
    await processDomains(d, opts(notify));
    const r = db.tables.client_domains[0] as unknown as ClientDomainRow;
    expect(r.status).toBe("needs_attention");
    expect(r.last_error).toMatch(/zone locked/);
    expect(r.next_run_at).toBeNull();
    expect(notify).toHaveBeenCalledWith("domain_needs_attention", expect.objectContaining({ leadId: "lead-1" }), expect.objectContaining({ title: "Domain setup stopped: acme.com" }));
    expect(db.log.some((l) => l.table === "activity_log" && (l.patch as Rec).action === "domain.setup_stopped")).toBe(true);
  });

  it("a registration Cloudflare rejected marks the purchase failed (nothing bought)", async () => {
    const db = fakeDb({ client_domains: [domainRow() as unknown as Rec] });
    const d = happyDeps(db.admin);
    (d.cf.getRegistrationStatus as ReturnType<typeof vi.fn>).mockResolvedValue({ state: "failed", completed: true, error: { message: "registry refused" } });
    await processDomains(d, opts());
    expect((db.tables.client_domains[0] as unknown as ClientDomainRow).status).toBe("failed");
  });

  it("no site yet: parks as waiting_for_site and re-checks in ten minutes", async () => {
    const db = fakeDb({ client_domains: [domainRow({ status: "setting_up", step: "site" }) as unknown as Rec], leads: [{ id: "lead-1", website_link: null }] });
    const d = happyDeps(db.admin, { findStaging: vi.fn(async () => null) as unknown as PipelineDeps["findStaging"] });
    await processDomains(d, opts());
    const r = db.tables.client_domains[0] as unknown as ClientDomainRow;
    expect(r.status).toBe("waiting_for_site");
    expect(Date.parse(r.next_run_at as string)).toBe(NOW.getTime() + SITE_RECHECK_MS);
  });

  it("a step that keeps waiting past its budget is given up — loudly", async () => {
    const db = fakeDb({ client_domains: [domainRow({ status: "setting_up", step: "ssl", attempts: MAX_POLLS.ssl }) as unknown as Rec] });
    const d = happyDeps(db.admin);
    (d.hostinger.ensureSsl as ReturnType<typeof vi.fn>).mockResolvedValue("installing");
    await processDomains(d, opts());
    const r = db.tables.client_domains[0] as unknown as ClientDomainRow;
    expect(r.status).toBe("needs_attention");
    expect(r.last_error).toMatch(/Gave up/);
  });

  it("skips rows not due yet and rows another worker holds; retakes a stale claim", async () => {
    const future = new Date(NOW.getTime() + 60_000).toISOString();
    const fresh = new Date(NOW.getTime() - 60_000).toISOString();
    const stale = new Date(NOW.getTime() - 11 * 60_000).toISOString();
    const db = fakeDb({
      client_domains: [
        domainRow({ id: "later", domain: "later.com", next_run_at: future }) as unknown as Rec,
        domainRow({ id: "held", domain: "held.com", claim_id: "other", claimed_at: fresh }) as unknown as Rec,
        domainRow({ id: "orphan", domain: "orphan.com", claim_id: "dead", claimed_at: stale }) as unknown as Rec,
      ],
      leads: [{ id: "lead-1", website_link: null }],
    });
    const out = await processDomains(happyDeps(db.admin), opts());
    expect(out.map((o) => o.domain)).toEqual(["orphan.com"]);
  });

  it("stops quietly when an operator changed the row mid-run (claim lost)", async () => {
    const db = fakeDb({ client_domains: [domainRow({ status: "setting_up", step: "zone" }) as unknown as Rec] });
    const d = happyDeps(db.admin);
    (d.cf.findZone as ReturnType<typeof vi.fn>).mockImplementation(async () => {
      // the operator unlinks the domain while the step runs
      Object.assign(db.tables.client_domains[0], { claim_id: null, status: "unassigned", lead_id: null });
      return { id: "z1", name: "acme.com", status: "active" };
    });
    const out = await processDomains(d, opts());
    expect(out).toEqual([]);
    expect((db.tables.client_domains[0] as unknown as ClientDomainRow).status).toBe("unassigned");
    expect(d.hostinger.ensureWebsite).not.toHaveBeenCalled();
  });
});
