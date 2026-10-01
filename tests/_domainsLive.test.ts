// @vitest-environment node
/**
 * LIVE verification of the domain system against the real accounts. Gated:
 * runs ONLY with LIVE_DOMAINS=1, skipped by every normal run.
 *   1. import the Cloudflare account's domains and the Hostinger portfolio
 *      (writes client_domains only — the operator asked for these imports);
 *   2. a purchase in Cloudflare's SANDBOX (no charge; the fake domain and its
 *      log rows are removed afterwards) through the real purchase + processor;
 *   3. read-only: the DNS planner run against a domain set up by hand must
 *      want NO changes, and the hosting server must serve it.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { createClient } from "@supabase/supabase-js";

const live = process.env.LIVE_DOMAINS === "1";

// Only when enabled: test files can share a worker process, and real
// credentials must never leak into the normal suite's environment.
if (live) {
  for (const line of readFileSync(".env.local", "utf8").split(/\r?\n/)) {
    const m = line.match(/^([A-Z_][A-Z0-9_]*)=(.*)$/);
    if (m && m[2].trim()) process.env[m[1]] = m[2].trim();
  }
}
const ADMIN_PROFILE = "70702ad6-9a4f-4920-83da-dccbd98f1b12"; // the shared "Admin" account

describe.skipIf(!live)("LIVE — client domains", () => {
  const admin = () =>
    createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
      auth: { autoRefreshToken: false, persistSession: false },
    });

  it("imports the Cloudflare domains — hand-made setups come in as connected", async () => {
    const { importCloudflareDomains } = await import("@/lib/domains/import");
    const r = await importCloudflareDomains(admin(), ADMIN_PROFILE);
    console.log("[live-domains] IMPORT:", JSON.stringify(r));
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.summary.total).toBeGreaterThan(0);
    const { data } = await admin().from("client_domains").select("domain, status, lead_id, auto_renew, expires_at").eq("registrar", "cloudflare");
    console.log("[live-domains] ROWS:", JSON.stringify(data));
    expect((data ?? []).length).toBe(r.summary.total);
  }, 180000);

  it("imports the Hostinger portfolio — sites already up come in as connected, company domains stay out", async () => {
    const { importHostingerDomains } = await import("@/lib/domains/import");
    const r = await importHostingerDomains(admin(), ADMIN_PROFILE);
    console.log("[live-domains] HOSTINGER IMPORT:", JSON.stringify(r));
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.summary.total).toBeGreaterThan(0);
    const { data } = await admin()
      .from("client_domains")
      .select("domain, status, lead_id, hosting_username, expires_at")
      .eq("registrar", "hostinger")
      .order("domain");
    console.log("[live-domains] HOSTINGER ROWS:", JSON.stringify(data));
    const names = (data ?? []).map((x) => x.domain as string);
    expect(names.length).toBeGreaterThanOrEqual(r.summary.added);
    const { isProtectedDomain } = await import("@/lib/site-studio/deploy/protected");
    expect(names.filter((d) => isProtectedDomain(d))).toEqual([]);
  }, 300000);

  it("full sync of both registrars (alerts muted) — expired domains in, Hostinger auto-renew known", async () => {
    const { importAllDomains } = await import("@/lib/domains/import");
    const { cloudflareConfigured } = await import("@/lib/cloudflare/client");
    const muted = (async () => {}) as never;
    const r = await importAllDomains(admin(), ADMIN_PROFILE, { cloudflare: cloudflareConfigured(), notify: muted });
    console.log("[live-domains] SYNC:", JSON.stringify(r));
    expect(r.ok).toBe(true);
    const { data } = await admin()
      .from("client_domains")
      .select("domain, registrar, status, registrar_status, auto_renew, renewal_cost_cents, next_billing_at, hostinger_subscription_id");
    const rows = (data ?? []) as Record<string, unknown>[];
    const tally = (k: string) => rows.reduce<Record<string, number>>((a, x) => ((a[String(x[k])] = (a[String(x[k])] ?? 0) + 1), a), {});
    console.log("[live-domains] registrar_status:", JSON.stringify(tally("registrar_status")), "auto_renew:", JSON.stringify(tally("auto_renew")));
    console.log("[live-domains] hostinger without subscription:", rows.filter((x) => x.registrar === "hostinger" && !x.hostinger_subscription_id).map((x) => x.domain));
    console.log("[live-domains] priced:", rows.filter((x) => typeof x.renewal_cost_cents === "number").length, "of", rows.length);
  }, 300000);

  it("health checks on a handful of real sites (read-only toward the sites)", async () => {
    const { healthSweep } = await import("@/lib/domains/health");
    const muted = (async () => {}) as never;
    const r = await healthSweep(admin(), { limit: 10, budgetMs: 120000, notify: muted });
    console.log("[live-domains] HEALTH:", JSON.stringify(r));
    const { data } = await admin()
      .from("client_domains")
      .select("domain, health_state, health")
      .not("health_state", "is", null)
      .limit(12);
    for (const x of (data ?? []) as { domain: string; health_state: string; health: { summary?: string; ssl?: { valid_to?: string } | null } }[]) {
      console.log(`[live-domains]   ${x.domain.padEnd(34)} ${x.health_state.padEnd(9)} ${x.health?.summary ?? ""} ${x.health?.ssl?.valid_to ? "ssl→" + x.health.ssl.valid_to.slice(0, 10) : ""}`);
    }
    expect(r.checked).toBeGreaterThan(0);
  }, 300000);

  it("a SANDBOX purchase runs the real purchase + processor and stops as unassigned (no lead)", async () => {
    process.env.CLOUDFLARE_REGISTRAR_SANDBOX = "1";
    try {
      const { checkDomains } = await import("@/lib/cloudflare/client");
      const { purchaseDomain } = await import("@/lib/domains/service");
      const { processDomains } = await import("@/lib/domains/processor");
      const { realPipelineDeps } = await import("@/lib/domains/deps");
      const db = admin();
      const name = `sed-lms-sandbox-${Date.now().toString(36)}.com`;
      const checked = await checkDomains([name]);
      const price = checked?.[0]?.pricing?.registration_cost;
      console.log("[live-domains] SANDBOX CHECK:", JSON.stringify(checked));
      expect(checked?.[0]?.registrable).toBe(true);
      const cents = Math.round(Number(price) * 100);

      // a wrong confirmed price must be refused before anything is bought
      const refused = await purchaseDomain(db, { domain: name, registrar: "cloudflare", leadId: null, expectedCents: cents + 1, actorId: ADMIN_PROFILE });
      expect(refused).toMatchObject({ ok: false, status: 409 });

      const bought = await purchaseDomain(db, { domain: name, registrar: "cloudflare", leadId: null, expectedCents: cents, actorId: ADMIN_PROFILE });
      console.log("[live-domains] SANDBOX PURCHASE:", JSON.stringify(bought.ok ? { status: bought.domain.status, steps: bought.domain.steps } : bought));
      expect(bought.ok).toBe(true);
      if (!bought.ok) return;

      let status = bought.domain.status as string;
      for (let i = 0; i < 20 && status === "purchasing"; i++) {
        await processDomains(realPipelineDeps(db), { onlyId: bought.domain.id, budgetMs: 60000 });
        const { data } = await db.from("client_domains").select("status, step, steps, last_error, next_run_at").eq("id", bought.domain.id).single();
        status = data?.status;
        console.log(`[live-domains] SANDBOX tick ${i}:`, JSON.stringify(data));
        if (status === "purchasing") {
          // force the next look now instead of waiting the scheduled seconds
          await db.from("client_domains").update({ next_run_at: new Date().toISOString() }).eq("id", bought.domain.id);
          await new Promise((r) => setTimeout(r, 3000));
        }
      }
      expect(status).toBe("unassigned");

      // clean up: the sandbox domain is not real
      await db.from("client_domains").delete().eq("id", bought.domain.id);
      await db.from("activity_log").delete().eq("action", "domain.purchased").contains("new_value", { domain: name });
    } finally {
      delete process.env.CLOUDFLARE_REGISTRAR_SANDBOX;
    }
  }, 300000);

  it("read-only: the planner wants NO change on a hand-made domain, and the server serves it", async () => {
    const { findZone, listDnsRecords } = await import("@/lib/cloudflare/client");
    const { planDns, planIsEmpty, clientSitesIp } = await import("@/lib/domains/dns");
    const { probeVhost } = await import("@/lib/domains/deps");
    const domain = "independentac.com";
    const zone = await findZone(domain);
    expect(zone && zone !== "error").toBeTruthy();
    if (!zone || zone === "error") return;
    const records = await listDnsRecords(zone.id);
    const plan = planDns(domain, clientSitesIp(), records ?? []);
    console.log("[live-domains] PLAN for", domain, JSON.stringify(plan));
    expect(planIsEmpty(plan)).toBe(true);
    expect(await probeVhost(clientSitesIp(), domain)).toBe(true);
    expect(await probeVhost(clientSitesIp(), "sed-lms-unknown-host-7731.com")).toBe(false);
  }, 120000);
});
