// @vitest-environment node
/**
 * Live deploy verification for Site Studio (Phase 4a Task 12). Gated: runs
 * ONLY with TASK12_LIVE=1, and is skipped by every normal test run. Precedent:
 * tests/deployLiveManual.test.ts.
 *
 * Exercises the REAL deployRun service — subdomain resolution, the cross-lead
 * guard, studio_deployments bookkeeping, run-events + activity-log writes, and
 * the lead's website_link being set then cleared — against a throwaway lead, a
 * throwaway template and a fixture-rendered site, on a disposable ss-verify-*
 * subdomain, then tears everything down (the DirectAdmin subdomain plus every
 * row it created, in FK-safe order, from a `finally` block).
 *
 * IT WRITES TO PRODUCTION. It inserts one clearly-marked lead and deletes it
 * again; a failure mid-run logs `[task12] CLEANUP FAILED` with the subdomain
 * name and every row id so a human can finish the cleanup. Do not run it
 * casually — it exists because unit tests cannot prove that a real subdomain
 * serves our rendered output.
 *
 * Kept rather than deleted because it earned it: on its first run the
 * verification only LOGGED the fetch result without asserting it, so the test
 * reported "passed" while the site had never been confirmed to serve. Adding
 * the assertion then exposed a second bug (a normalized needle compared against
 * raw HTML). Both are fixed below, and the assertion is now load-bearing.
 *
 * Verified 2026-07-27: deployed the plumberpro fixture to
 * ss-verify-g2k26p.dmviral.com, fetched HTTPS 200 with matching content, tore
 * the subdomain down, and left prod at baseline (0 studio rows, 515 leads).
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { createClient } from "@supabase/supabase-js";
import { compileTemplate } from "@/lib/site-studio/compiler/compile";
import { fixtureZip } from "./helpers/siteStudioFixtures";
import { sampleContentDoc } from "@/lib/site-studio/sample";
import { renderSite } from "@/lib/site-studio/render/renderer";
import { zipFromMap } from "@/lib/site-studio/zip";
import { deployRun } from "@/lib/site-studio/deploy/deployRun";
import {
  daConfigured, createSubdomain, subdomainExists, clearDocroot,
  uploadZipAndExtract, docrootFor, deleteSubdomain,
} from "@/lib/template-engine/directadmin";

// load .env.local fully (vitest does not)
for (const line of readFileSync(".env.local", "utf8").split("\n")) {
  const m = line.match(/^([A-Z_][A-Z0-9_]*)=(.*)$/);
  if (m && m[2].trim()) process.env[m[1]] = m[2].trim();
}

const live = process.env.TASK12_LIVE === "1";
const SITES_BUCKET = "studio-sites";

function randomSuffix(n: number): string {
  const chars = "abcdefghijklmnopqrstuvwxyz0123456789";
  let out = "";
  for (let i = 0; i < n; i++) out += chars[Math.floor(Math.random() * chars.length)];
  return out;
}

describe.skipIf(!live)("TASK 12 — live deploy verification", () => {
  it("full deploy -> verify -> takedown -> cleanup, leaving no trace", async () => {
    const admin = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
      auth: { autoRefreshToken: false, persistSession: false },
    });

    const sub = `ss-verify-${randomSuffix(6)}`;
    const report: Record<string, unknown> = { sub };
    let leadId: string | null = null;
    let templateId: string | null = null;
    let runId: string | null = null;
    let zipUploaded = false;
    const zipPath = `verify/${sub}/site.zip`;

    try {
      // ---- 1. compile + render the fixture, zip it ----
      const { template, ok: compileOk } = compileTemplate(fixtureZip("plumberpro"), "plumberpro");
      expect(compileOk).toBe(true);
      const doc = sampleContentDoc(template.manifest);
      const rendered = renderSite(template, doc);
      expect(rendered.ok).toBe(true);
      if (!rendered.ok) throw new Error("render failed: " + JSON.stringify(rendered.missing));
      const zipBytes = zipFromMap(rendered.files);

      // a distinctive, verbatim chunk of the ACTUAL rendered output — used
      // later to prove the live fetch served THIS content, not some default
      const indexHtml = new TextDecoder().decode(rendered.files["index.html"]);
      const bodyMatch = indexHtml.match(/<body[^>]*>([\s\S]{0,400})/);
      const needleRaw = (bodyMatch ? bodyMatch[1] : indexHtml).replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
      const needle = needleRaw.slice(0, 60);
      expect(needle.length).toBeGreaterThan(10);
      report.needle = needle;

      const upload = await admin.storage.from(SITES_BUCKET).upload(zipPath, zipBytes, {
        contentType: "application/zip",
        upsert: true,
      });
      expect(upload.error).toBeNull();
      zipUploaded = true;

      // ---- 2. throwaway lead (explicit authorization override) ----
      const { data: leadRow, error: leadInsErr } = await admin
        .from("leads")
        .insert({
          business_name: "[TEST] Site Studio verification — do not contact",
          status: "Closed",
        })
        .select("id")
        .single();
      expect(leadInsErr).toBeNull();
      leadId = (leadRow as { id: string }).id;
      report.leadId = leadId;
      console.log("[task12] created test lead:", leadId);

      // ---- throwaway template ----
      const { data: tplRow, error: tplInsErr } = await admin
        .from("studio_templates")
        .insert({
          name: `[TEST] ss-verify throwaway (${sub})`,
          status: "certified",
          version: 1,
          storage_prefix: `verify/${sub}/template`,
        })
        .select("id")
        .single();
      expect(tplInsErr).toBeNull();
      templateId = (tplRow as { id: string }).id;
      report.templateId = templateId;
      console.log("[task12] created throwaway studio_templates row:", templateId);

      // ---- studio_runs row, ready to deploy ----
      const { data: runRow, error: runInsErr } = await admin
        .from("studio_runs")
        .insert({
          lead_id: leadId,
          template_id: templateId,
          template_version: 1,
          status: "ready",
          zip_path: zipPath,
          site_slug: sub,
        })
        .select("id")
        .single();
      expect(runInsErr).toBeNull();
      runId = (runRow as { id: string }).id;
      report.runId = runId;
      console.log("[task12] created studio_runs row:", runId);

      // ---- 3. the REAL deploy path ----
      expect(daConfigured()).toBe(true);
      const outcome = await deployRun(
        admin,
        runId,
        { daConfigured, daDomain: process.env.DA_DOMAIN ?? "", createSubdomain, subdomainExists, clearDocroot, uploadZipAndExtract, docrootFor },
        null,
      );
      report.deployOutcome = outcome;
      console.log("[task12] deployRun outcome:", JSON.stringify(outcome));

      if (!outcome.ok) {
        await admin.from("studio_run_events").insert({
          run_id: runId, step: "deploy", level: "error", message: outcome.error,
        });
        throw new Error(`deployRun failed: ${outcome.error}`);
      }
      await admin.from("studio_run_events").insert({
        run_id: runId,
        step: "deploy",
        level: outcome.clearWarning ? "warn" : "info",
        message: `deployed to ${outcome.url}${outcome.reused ? " (redeploy, in place)" : ""}`,
        detail: { sub: outcome.sub, reused: outcome.reused, existed: outcome.existed, clearWarning: outcome.clearWarning ?? null },
      });
      expect(outcome.sub).toBe(sub);

      // confirm the lead's website_link was set by the real deploy path
      const { data: leadAfterDeploy } = await admin.from("leads").select("website_link").eq("id", leadId).single();
      report.leadWebsiteLinkAfterDeploy = leadAfterDeploy?.website_link ?? null;
      expect(leadAfterDeploy?.website_link).toBe(outcome.url);

      // ---- 4. ONE verification fetch (never a poll) ----
      // A brand-new subdomain needs DNS to propagate and its HTTPS cert lands
      // 30-60s after creation (directadmin.ts:1-23). The first run of this
      // script fetched seconds after deploy and got "fetch failed" (status 0 —
      // DNS, not HTTP). So: wait once, THEN fetch once. This is still not a
      // poll — the caveat warns against a long retry LOOP being cut off by the
      // proxy and reporting a false failure, and a single delayed check is
      // exactly what it recommends instead.
      const settleMs = 75_000;
      console.log(`[task12] waiting ${settleMs / 1000}s for DNS + cert before the single verification fetch`);
      await new Promise((r) => setTimeout(r, settleMs));

      let verify: { scheme: string; status: number; matched: boolean; snippet: string } | null = null;
      for (const scheme of ["https", "http"]) {
        try {
          const res = await fetch(`${scheme}://${sub}.${process.env.DA_DOMAIN}/`, { signal: AbortSignal.timeout(10000) });
          const text = await res.text();
          // Normalize the SERVED html the same way the needle was normalized
          // (strip tags, collapse whitespace) before comparing. The first
          // assertion-carrying run failed here: the needle was tag-stripped and
          // whitespace-collapsed while the served text was raw, so the two could
          // never match even though the site was serving our content correctly.
          const servedNorm = text.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
          verify = { scheme, status: res.status, matched: servedNorm.includes(needle), snippet: text.slice(0, 300) };
          if (verify.matched) break;
          // one short, single retry only if the first attempt didn't match —
          // never a poll loop
          if (scheme === "https") {
            await new Promise((r) => setTimeout(r, 5000));
          }
        } catch (e) {
          verify = { scheme, status: 0, matched: false, snippet: e instanceof Error ? e.message : "fetch error" };
        }
      }
      report.verify = verify;
      console.log("[task12] verification fetch:", JSON.stringify(verify));
      // ASSERT it — the first run of this script only logged the result, so the
      // test reported "passed" while the site was never actually confirmed to
      // serve. A verification that cannot fail verifies nothing.
      expect(verify, "no verification fetch was attempted").not.toBeNull();
      expect(
        verify?.matched,
        `deployed site did not serve our content: ${JSON.stringify(verify)}`,
      ).toBe(true);

      // ---- 5. takedown (mirrors app/api/site-studio/deployments/[id]/route.ts) ----
      const { data: deploymentRow, error: depFetchErr } = await admin
        .from("studio_deployments")
        .select("id, lead_id, subdomain, url, status")
        .eq("run_id", runId)
        .single();
      expect(depFetchErr).toBeNull();
      report.deploymentId = deploymentRow?.id;
      // narrow for the takedown block below: a missing row here means deployRun
      // reported success without writing its bookkeeping, which is itself a
      // failure worth stopping on rather than dereferencing past
      if (!deploymentRow) throw new Error("deployRun returned ok but wrote no studio_deployments row");

      const removed = await deleteSubdomain(sub);
      report.deleteSubdomainResult = removed;
      if (removed.error) {
        console.error("[task12] CLEANUP FAILED — delete subdomain manually:", sub, JSON.stringify(removed));
        throw new Error(`deleteSubdomain failed: ${removed.text || removed.details}`);
      }

      const now = new Date().toISOString();
      const { data: flipped, error: flipErr } = await admin
        .from("studio_deployments")
        .update({ status: "taken_down", taken_down_at: now, updated_at: now })
        .eq("id", deploymentRow.id)
        .neq("status", "taken_down")
        .select("id")
        .maybeSingle();
      expect(flipErr).toBeNull();
      expect(flipped).not.toBeNull();

      const { data: leadNow } = await admin.from("leads").select("website_link").eq("id", leadId).single();
      if (leadNow && leadNow.website_link === deploymentRow.url) {
        await admin.from("leads").update({ website_link: null }).eq("id", leadId);
      }
      await admin.from("activity_log").insert({
        user_id: null,
        action: "studio.deployment.taken_down",
        entity_type: "studio_deployment",
        entity_id: deploymentRow.id,
        new_value: { subdomain: sub, url: deploymentRow.url, lead_id: leadId },
      });

      // ---- 6. verify teardown ----
      const existsAfter = await subdomainExists(sub);
      report.subdomainExistsAfterTakedown = existsAfter;
      expect(existsAfter).toBe(false);

      const { data: depAfter } = await admin.from("studio_deployments").select("status").eq("id", deploymentRow.id).single();
      report.deploymentStatusAfter = depAfter?.status;
      expect(depAfter?.status).toBe("taken_down");
    } finally {
      // ---- 7. cleanup: deployments -> runs -> templates -> lead (last) ----
      const cleanup: Record<string, unknown> = {};
      if (runId) {
        const delDep = await admin.from("studio_deployments").delete().eq("run_id", runId).select("id");
        cleanup.deletedDeployments = delDep.data?.length ?? 0;
        if (delDep.error) console.error("[task12] CLEANUP FAILED deleting studio_deployments for run", runId, delDep.error.message);

        await admin.from("studio_run_events").delete().eq("run_id", runId);

        const delRun = await admin.from("studio_runs").delete().eq("id", runId).select("id");
        cleanup.deletedRun = delRun.data?.length ?? 0;
        if (delRun.error) console.error("[task12] CLEANUP FAILED deleting studio_runs row", runId, delRun.error.message);
      }
      if (templateId) {
        const delTpl = await admin.from("studio_templates").delete().eq("id", templateId).select("id");
        cleanup.deletedTemplate = delTpl.data?.length ?? 0;
        if (delTpl.error) console.error("[task12] CLEANUP FAILED deleting studio_templates row", templateId, delTpl.error.message);
      }
      if (leadId) {
        const delLead = await admin.from("leads").delete().eq("id", leadId).select("id");
        cleanup.deletedLead = delLead.data?.length ?? 0;
        if (delLead.error) console.error("[task12] CLEANUP FAILED deleting test lead", leadId, delLead.error.message);
      }
      if (zipUploaded) {
        const delZip = await admin.storage.from(SITES_BUCKET).remove([zipPath]);
        cleanup.deletedZip = !delZip.error;
        if (delZip.error) console.error("[task12] cleanup: could not remove zip", zipPath, delZip.error.message);
      }
      // in case deploy/verify threw before takedown ran, make sure the
      // subdomain never survives this test
      const stillExists = await subdomainExists(sub);
      cleanup.subdomainStillExistsAtEnd = stillExists;
      if (stillExists) {
        const del = await deleteSubdomain(sub);
        cleanup.finalDeleteSubdomainResult = del;
        if (del.error) console.error("[task12] CLEANUP FAILED — delete subdomain manually:", sub, JSON.stringify(del));
      }
      console.log("[task12] CLEANUP SUMMARY:", JSON.stringify(cleanup));
      console.log("[task12] FULL REPORT:", JSON.stringify(report, null, 2));
    }
  }, 300000);
});
