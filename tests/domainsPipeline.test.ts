// @vitest-environment node
import { describe, it, expect, vi } from "vitest";
import { runStep, type PipelineDeps } from "@/lib/domains/pipeline";
import type { ClientDomainRow } from "@/lib/domains/types";

/**
 * Each pipeline step against fake registrars/hosting. A step looks, does at
 * most one bounded thing, and says what next — and is safe to re-run.
 */

function row(over: Partial<ClientDomainRow> = {}): ClientDomainRow {
  return {
    id: "d1",
    domain: "acme.com",
    registrar: "cloudflare",
    origin: "purchased",
    lead_id: "lead-1",
    status: "setting_up",
    step: null,
    steps: {},
    last_error: null,
    next_run_at: null,
    claim_id: null,
    claimed_at: null,
    attempts: 0,
    cf_zone_id: "z1",
    hosting_username: "u447231526",
    hostinger_order_id: null,
    hostinger_subscription_id: null,
    registration_cost_cents: 1046,
    renewal_cost_cents: 1046,
    currency: "USD",
    auto_renew: true,
    expires_at: null,
    purchased_by: "user-1",
    purchased_at: null,
    created_by: "user-1",
    created_at: "2026-10-02T00:00:00Z",
    updated_at: "2026-10-02T00:00:00Z",
    ...over,
  };
}

const WEBSITE = { domain: "acme.com", username: "u447231526", root_directory: "/home/u/domains/acme.com/public_html", vhost_type: "addon", order_id: 1, is_enabled: true, website_type: "other" };

function deps(over: { cf?: Partial<PipelineDeps["cf"]>; hostinger?: Partial<PipelineDeps["hostinger"]> } & Partial<Omit<PipelineDeps, "cf" | "hostinger">> = {}): PipelineDeps {
  const lead = { website_link: null as string | null };
  const admin = {
    from: () => ({
      select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: lead, error: null }) }) }),
    }),
  } as unknown as PipelineDeps["admin"];
  return {
    admin,
    cf: {
      getRegistrationStatus: vi.fn(async () => null),
      getRegistration: vi.fn(async () => null),
      setAutoRenew: vi.fn(async () => ({ ok: true })),
      findZone: vi.fn(async () => ({ id: "z1", name: "acme.com", status: "active" })),
      createZone: vi.fn(async () => ({ ok: true as const, zone: { id: "z2", name: "acme.com", status: "pending" } })),
      listDnsRecords: vi.fn(async () => []),
      createDnsRecord: vi.fn(async () => ({ ok: true })),
      updateDnsRecord: vi.fn(async () => ({ ok: true })),
      deleteDnsRecord: vi.fn(async () => ({ ok: true })),
      ...over.cf,
    },
    hostinger: {
      getWebsite: vi.fn(async () => WEBSITE),
      ensureWebsite: vi.fn(async () => ({ ok: true as const, website: WEBSITE, created: false })),
      verifyDomainOwnership: vi.fn(async () => ({ accessible: true, txt: null })),
      ensureSsl: vi.fn(async () => "active"),
      isStaticWebsite: (w: { website_type?: string | null }) => !w.website_type || w.website_type === "other",
      websiteTypeLabel: (t: string | null | undefined) => (t === "wordpress" ? "WordPress" : "static"),
      getHostingerPortfolioDomain: vi.fn(async () => ({ status: "active" })),
      completeHostingerDomainSetup: vi.fn(async () => ({ ok: true })),
      enableHostingerAutoRenew: vi.fn(async () => ({ ok: true })),
      ...over.hostinger,
    } as PipelineDeps["hostinger"],
    goLive: over.goLive ?? (vi.fn(async () => ({ ok: true, url: "https://acme.com", settled: true })) as unknown as PipelineDeps["goLive"]),
    findStaging: over.findStaging ?? (vi.fn(async () => ({ id: "dep-1", url: "https://acmev1.dmviral.com" })) as unknown as PipelineDeps["findStaging"]),
    probeVhost: over.probeVhost ?? vi.fn(async () => true),
    resolvesTo: over.resolvesTo ?? vi.fn(async () => ["1.2.3.4"]),
  };
}

describe("registration (Cloudflare)", () => {
  it("an imported domain is already registered", async () => {
    expect(await runStep(row({ origin: "imported" }), "registration", deps())).toMatchObject({ kind: "done" });
  });

  it("succeeded: records expiry and switches auto-renew ON when Cloudflare left it off", async () => {
    const d = deps({
      cf: {
        getRegistrationStatus: vi.fn(async () => ({
          state: "succeeded",
          completed: true,
          context: { registration: { domain_name: "acme.com", status: "active", auto_renew: false, expires_at: "2027-10-02T00:00:00Z" } },
        })),
      },
    });
    const out = await runStep(row(), "registration", d);
    expect(out).toMatchObject({ kind: "done", patch: { expires_at: "2027-10-02T00:00:00Z", auto_renew: true } });
    expect(d.cf.setAutoRenew).toHaveBeenCalledWith("acme.com", true);
  });

  it("in progress: look again shortly", async () => {
    const d = deps({ cf: { getRegistrationStatus: vi.fn(async () => ({ state: "in_progress", completed: false })) } });
    expect(await runStep(row(), "registration", d)).toMatchObject({ kind: "wait" });
  });

  it("failed: the purchase failed (nothing bought); action_required: a human must act", async () => {
    const failed = deps({ cf: { getRegistrationStatus: vi.fn(async () => ({ state: "failed", completed: true, error: { message: "registry said no" } })) } });
    expect(await runStep(row(), "registration", failed)).toMatchObject({ kind: "fail", purchaseFailed: true });
    const action = deps({ cf: { getRegistrationStatus: vi.fn(async () => ({ state: "action_required", completed: false })) } });
    expect(await runStep(row(), "registration", action)).toMatchObject({ kind: "fail", purchaseFailed: false });
  });
});

describe("registration (Hostinger)", () => {
  const hRow = row({ registrar: "hostinger", hostinger_subscription_id: "sub-1" });
  it("active: done, and auto-renew is switched on", async () => {
    const d = deps();
    expect(await runStep(hRow, "registration", d)).toMatchObject({ kind: "done", patch: { auto_renew: true } });
    expect(d.hostinger.enableHostingerAutoRenew).toHaveBeenCalledWith("sub-1");
  });
  it("paid but not set up: completes the setup (no new charge) and waits", async () => {
    const d = deps({ hostinger: { getHostingerPortfolioDomain: vi.fn(async () => ({ status: "pending_setup" })) } });
    expect(await runStep(hRow, "registration", d)).toMatchObject({ kind: "wait" });
    expect(d.hostinger.completeHostingerDomainSetup).toHaveBeenCalledWith("acme.com");
  });
  it("not in the portfolio yet (payment processing): waits", async () => {
    const d = deps({ hostinger: { getHostingerPortfolioDomain: vi.fn(async () => null) } });
    expect(await runStep(hRow, "registration", d)).toMatchObject({ kind: "wait" });
  });
});

describe("sandbox (test mode)", () => {
  it("a simulated domain never reaches real DNS or hosting", async () => {
    const d = { ...deps(), sandbox: true };
    for (const step of ["zone", "hosting", "dns", "ssl", "site"] as const) {
      expect(await runStep(row(), step, d)).toMatchObject({ kind: "fail" });
    }
    expect(d.cf.findZone).not.toHaveBeenCalled();
    expect(d.cf.createZone).not.toHaveBeenCalled();
    expect(d.hostinger.ensureWebsite).not.toHaveBeenCalled();
    expect(d.cf.createDnsRecord).not.toHaveBeenCalled();
  });
});

describe("zone", () => {
  it("finds the zone, creates a missing one, waits when Cloudflare can't be asked", async () => {
    expect(await runStep(row(), "zone", deps())).toMatchObject({ kind: "done", patch: { cf_zone_id: "z1" } });
    const missing = deps({ cf: { findZone: vi.fn(async () => null) } });
    expect(await runStep(row(), "zone", missing)).toMatchObject({ kind: "done", patch: { cf_zone_id: "z2" } });
    const down = deps({ cf: { findZone: vi.fn(async () => "error" as const) } });
    expect(await runStep(row(), "zone", down)).toMatchObject({ kind: "wait" });
  });
});

describe("hosting", () => {
  it("an existing static website is reused", async () => {
    expect(await runStep(row(), "hosting", deps())).toMatchObject({ kind: "done", patch: { hosting_username: "u447231526" } });
  });

  it("an existing WordPress website is never touched", async () => {
    const d = deps({ hostinger: { getWebsite: vi.fn(async () => ({ ...WEBSITE, website_type: "wordpress" })) } });
    expect(await runStep(row(), "hosting", d)).toMatchObject({ kind: "fail" });
    expect(d.hostinger.ensureWebsite).not.toHaveBeenCalled();
  });

  it("a new Cloudflare domain: ownership OK, then hosting is created", async () => {
    const d = deps({
      hostinger: {
        getWebsite: vi.fn(async () => null),
        ensureWebsite: vi.fn(async () => ({ ok: true as const, website: WEBSITE, created: true })),
      },
    });
    expect(await runStep(row(), "hosting", d)).toMatchObject({ kind: "done", detail: "Hosting created on Hostinger" });
    expect(d.hostinger.verifyDomainOwnership).toHaveBeenCalledWith("acme.com");
    expect(d.hostinger.ensureWebsite).toHaveBeenCalledWith("acme.com", { waitMs: 0 });
  });

  it("Hostinger asks for proof: the TXT record is added once, then it waits", async () => {
    const d = deps({
      hostinger: {
        getWebsite: vi.fn(async () => null),
        verifyDomainOwnership: vi.fn(async () => ({ accessible: false, txt: "acme.com=abc123" })),
      },
    });
    expect(await runStep(row(), "hosting", d)).toMatchObject({ kind: "wait" });
    expect(d.cf.createDnsRecord).toHaveBeenCalledWith("z1", { type: "TXT", name: "acme.com", content: "acme.com=abc123" });
    expect(d.hostinger.ensureWebsite).not.toHaveBeenCalled();

    const already = deps({
      hostinger: { getWebsite: vi.fn(async () => null), verifyDomainOwnership: vi.fn(async () => ({ accessible: false, txt: "acme.com=abc123" })) },
      cf: { listDnsRecords: vi.fn(async () => [{ id: "t", type: "TXT", name: "acme.com", content: '"acme.com=abc123"' }]) },
    });
    await runStep(row(), "hosting", already);
    expect(already.cf.createDnsRecord).not.toHaveBeenCalled();
  });

  it("in use on another account with no TXT offered: stops with a clear reason", async () => {
    const d = deps({ hostinger: { getWebsite: vi.fn(async () => null), verifyDomainOwnership: vi.fn(async () => ({ accessible: false, txt: null })) } });
    expect(await runStep(row(), "hosting", d)).toMatchObject({ kind: "fail" });
  });

  it("setup still running: waits", async () => {
    const d = deps({ hostinger: { ensureWebsite: vi.fn(async () => ({ ok: false as const, pending: true, message: "setting up" })) } });
    expect(await runStep(row(), "hosting", d)).toMatchObject({ kind: "wait" });
  });
});

describe("dns (Cloudflare)", () => {
  it("never writes records until the hosting server actually serves the domain", async () => {
    const d = deps({ probeVhost: vi.fn(async () => false) });
    expect(await runStep(row(), "dns", d)).toMatchObject({ kind: "wait" });
    expect(d.cf.listDnsRecords).not.toHaveBeenCalled();
    expect(d.cf.createDnsRecord).not.toHaveBeenCalled();
  });

  it("applies the plan — removals before creates — and reports the change count", async () => {
    const order: string[] = [];
    const d = deps({
      cf: {
        listDnsRecords: vi.fn(async () => [{ id: "w", type: "A", name: "www.acme.com", content: "3.3.3.3" }]),
        deleteDnsRecord: vi.fn(async () => (order.push("delete"), { ok: true })),
        createDnsRecord: vi.fn(async () => (order.push("create"), { ok: true })),
      },
    });
    const out = await runStep(row(), "dns", d);
    expect(out).toMatchObject({ kind: "done" });
    expect(order).toEqual(["delete", "create", "create"]); // www A out, then apex A + www CNAME
  });

  it("already pointed: done without writing", async () => {
    const d = deps({
      cf: {
        listDnsRecords: vi.fn(async () => [
          { id: "a", type: "A", name: "acme.com", content: "76.13.203.71", proxied: false },
          { id: "c", type: "CNAME", name: "www.acme.com", content: "acme.com", proxied: false },
        ]),
      },
    });
    expect(await runStep(row(), "dns", d)).toMatchObject({ kind: "done" });
    expect(d.cf.createDnsRecord).not.toHaveBeenCalled();
  });
});

describe("dns (Hostinger) + ssl", () => {
  it("a Hostinger domain is done once it resolves", async () => {
    expect(await runStep(row({ registrar: "hostinger" }), "dns", deps())).toMatchObject({ kind: "done" });
    const none = deps({ resolvesTo: vi.fn(async () => []) });
    expect(await runStep(row({ registrar: "hostinger" }), "dns", none)).toMatchObject({ kind: "wait" });
  });
  it("ssl: active is done, anything else waits (ensureSsl re-requests a failed certificate)", async () => {
    expect(await runStep(row(), "ssl", deps())).toMatchObject({ kind: "done" });
    const installing = deps({ hostinger: { ensureSsl: vi.fn(async () => "installing") } });
    expect(await runStep(row(), "ssl", installing)).toMatchObject({ kind: "wait" });
  });
});

describe("site", () => {
  it("no staging site yet: parks until the lead's site is deployed", async () => {
    const d = deps({ findStaging: vi.fn(async () => null) as unknown as PipelineDeps["findStaging"] });
    expect(await runStep(row(), "site", d)).toMatchObject({ kind: "waiting_for_site" });
  });

  it("a staging site: goes live on the domain through the shared transfer", async () => {
    const d = deps();
    expect(await runStep(row(), "site", d)).toMatchObject({ kind: "live" });
    expect(d.goLive).toHaveBeenCalledWith(expect.objectContaining({ deploymentId: "dep-1", domain: "acme.com", actorId: "user-1" }));
  });

  it("the transfer is still settling: waits; a real failure stops", async () => {
    const pending = deps({ goLive: vi.fn(async () => ({ ok: false, status: 409, error: "still setting up", pending: true })) as unknown as PipelineDeps["goLive"] });
    expect(await runStep(row(), "site", pending)).toMatchObject({ kind: "wait" });
    const broken = deps({ goLive: vi.fn(async () => ({ ok: false, status: 502, error: "boom" })) as unknown as PipelineDeps["goLive"] });
    expect(await runStep(row(), "site", broken)).toMatchObject({ kind: "fail" });
  });
});
