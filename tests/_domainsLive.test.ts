// @vitest-environment node
/**
 * LIVE verification of the domain system against the real accounts. Gated:
 * runs ONLY with LIVE_DOMAINS=1, skipped by every normal run.
 *   1. import the Cloudflare account's domains (writes client_domains only —
 *      the operator asked for this import);
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
