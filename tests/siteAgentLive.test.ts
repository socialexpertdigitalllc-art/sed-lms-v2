// @vitest-environment node
/**
 * LIVE verification for the Ticket Agent (plan Task 14). Two gates, both
 * skipped by every normal test run:
 *
 *  - AGY_LIVE_TEST=1  — drives the REAL `agy` CLI in a scratch dir: one edit
 *    run plus a --conversation follow-up. Requires the operator's Antigravity
 *    consumer sign-in on this box, and burns real Pro-plan quota (one small
 *    run ≈ a couple of minutes).
 *
 *  - AGY_E2E_TEST=1   — the whole pipeline with REAL dependencies: throwaway
 *    DirectAdmin subdomain + lead + ticket + run row, the real
 *    processNextAgentRun (real agy, real fs workspace, real notify — which
 *    no-ops because every user ref on the throwaway rows is null), then the
 *    approve path's primitives (prepareSiteZip → snapshotSite →
 *    overrideLiveSite) and an HTTPS fetch proving the LIVE site serves the
 *    agent's edit. IT WRITES TO PRODUCTION (one clearly-marked lead/ticket,
 *    one sa-verify-* subdomain) and tears everything down in `finally`; a
 *    mid-run failure logs `[sa-live] CLEANUP FAILED` with every id.
 *
 * Precedent: tests/_task12LiveDeployVerify.test.ts.
 * First verified 2026-09-01 (see the run log in the plan's Task 14 notes).
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createClient } from "@supabase/supabase-js";
import { runAgy, listAgyModels } from "@/lib/site-agent/agy";
import { processNextAgentRun } from "@/lib/site-agent/worker";
import { fsWorkspace } from "@/lib/site-agent/workspaceFs";
import { notify } from "@/lib/notifications/notify";
import { AGENT_SITES_BUCKET, originalZipPath, resultZipPath } from "@/lib/site-agent/types";
import { zipFromMap } from "@/lib/template-engine/zip";
import { prepareSiteZip, overrideLiveSite } from "@/lib/site-studio/deploy/liveFiles";
import { snapshotSite, snapshotPrefix } from "@/lib/site-studio/deploy/snapshots";
import { ensureSubdomain } from "@/lib/site-studio/deploy/ensureSubdomain";
import {
  createSubdomain, subdomainExists, uploadZipAndExtract, deleteSubdomain,
} from "@/lib/template-engine/directadmin";

// load .env.local fully (vitest does not)
for (const line of readFileSync(".env.local", "utf8").split("\n")) {
  const m = line.match(/^([A-Z_][A-Z0-9_]*)=(.*)$/);
  if (m && m[2].trim()) process.env[m[1]] = m[2].trim();
}

const OLD_PHONE = "(555) 123-4567";
const NEW_PHONE = "(555) 987-6543";
const TICKET_PROMPT =
  `TICKET from the client: our phone number changed. Replace ${OLD_PHONE} with ${NEW_PHONE} ` +
  `everywhere on the site, including tel: links. Do not change anything else. Edit only files in the current directory.`;

const site = (phone: string): Record<string, Uint8Array> => ({
  "index.html": new TextEncoder().encode(
    `<!DOCTYPE html><html><head><title>SA verify</title></head><body>` +
      `<h1>SA verify</h1><p>Call us: <a href="tel:+15551234567">${phone}</a></p></body></html>`,
  ),
  "about.html": new TextEncoder().encode(`<html><body><p>Reach us at ${phone}.</p></body></html>`),
});

function randomSuffix(n: number): string {
  const chars = "abcdefghijklmnopqrstuvwxyz0123456789";
  let out = "";
  for (let i = 0; i < n; i++) out += chars[Math.floor(Math.random() * chars.length)];
  return out;
}

describe.skipIf(process.env.AGY_LIVE_TEST !== "1")("agy live driver", () => {
  it("edits a scratch site headlessly and applies a --conversation follow-up", { timeout: 600_000 }, async () => {
    const dir = await mkdtemp(join(tmpdir(), "sa-live-"));
    try {
      await writeFile(join(dir, "index.html"), `<html><body><p>Call ${OLD_PHONE}</p></body></html>`);

      const events: string[] = [];
      const first = await runAgy(
        { cwd: dir, prompt: TICKET_PROMPT, timeoutMs: 5 * 60_000 },
        (e) => events.push(e.kind),
      );
      expect(first.result?.status).toBe("SUCCESS");
      expect(first.conversationId).toBeTruthy();
      expect(events).toContain("init");
      expect(events).toContain("result");
      const afterFirst = await readFile(join(dir, "index.html"), "utf8");
      expect(afterFirst).toContain(NEW_PHONE);
      expect(afterFirst).not.toContain(OLD_PHONE);

      // The revise loop's mechanism: a follow-up in the SAME conversation.
      const second = await runAgy(
        {
          cwd: dir,
          prompt: "FOLLOW-UP from the developer: also add the line <p>Open Sundays</p> before </body>. Nothing else.",
          conversationId: first.conversationId,
          timeoutMs: 5 * 60_000,
        },
        () => {},
      );
      expect(second.result?.status).toBe("SUCCESS");
      const afterSecond = await readFile(join(dir, "index.html"), "utf8");
      expect(afterSecond).toContain("Open Sundays");
      expect(afterSecond).toContain(NEW_PHONE); // first edit survived
    } finally {
      await rm(dir, { recursive: true, force: true }).catch(() => {});
    }
  });
});

describe.skipIf(process.env.AGY_E2E_TEST !== "1")("ticket agent end-to-end (LIVE, writes prod)", () => {
  it("ticket → worker → review → deploy → the live site serves the edit → cleanup", { timeout: 900_000 }, async () => {
    const admin = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
      auth: { autoRefreshToken: false, persistSession: false },
    });
    const daDomain = process.env.DA_DOMAIN ?? "";
    expect(daDomain).toBeTruthy();

    const sub = `sa-verify-${randomSuffix(6)}`;
    const host = `${sub}.${daDomain}`;
    const runId = crypto.randomUUID();
    let leadId: string | null = null;
    let ticketId: string | null = null;
    let runInserted = false;
    let subCreated = false;
    console.log(`[sa-live] target ${host}, run ${runId}`);

    try {
      // ---- 1. stand up the "live site" (old content) on a throwaway subdomain ----
      const ensured = await ensureSubdomain({ subdomainExists, createSubdomain }, sub);
      expect(ensured.ok).toBe(true);
      subCreated = true;
      const oldZip = prepareSiteZip(zipFromMap(site(OLD_PHONE)));
      expect(oldZip.ok).toBe(true);
      if (!oldZip.ok) throw new Error("unreachable");
      const up = await uploadZipAndExtract(sub, oldZip.zip, "site.zip");
      expect(up.ok).toBe(true);

      // ---- 2. what the create route does: original.zip first, then the rows ----
      const upErr = (await admin.storage.from(AGENT_SITES_BUCKET)
        .upload(originalZipPath(runId), oldZip.zip, { upsert: true, contentType: "application/zip" })).error;
      expect(upErr).toBeNull();

      const lead = await admin.from("leads")
        .insert({ business_name: "[TEST] Ticket Agent verification — do not contact", status: "Closed" })
        .select("id").single();
      expect(lead.error).toBeNull();
      leadId = (lead.data as { id: string }).id;

      // All user refs null → notify() resolves zero recipients → no bells.
      const ticket = await admin.from("lead_tickets")
        .insert({
          lead_id: leadId, category: "Changes", signature: "Agent", priority: "Normal",
          status: "Assigned", title: `Update phone number to ${NEW_PHONE}`,
        })
        .select("id").single();
      expect(ticket.error).toBeNull();
      ticketId = (ticket.data as { id: string }).id;
      const item = await admin.from("ticket_items").insert({
        ticket_id: ticketId, sort: 0,
        body: `Replace ${OLD_PHONE} with ${NEW_PHONE} everywhere, including tel: links. Nothing else.`,
      });
      expect(item.error).toBeNull();

      const runIns = await admin.from("site_agent_runs")
        .insert({ id: runId, ticket_id: ticketId, lead_id: leadId, site_host: host })
        .select("id").single();
      expect(runIns.error).toBeNull();
      runInserted = true;

      // ---- 3. the worker, with every REAL dependency ----
      const outcome = await processNextAgentRun({
        admin, driver: runAgy, workspace: fsWorkspace, notify, listModels: () => listAgyModels(),
      });
      console.log("[sa-live] worker outcome:", JSON.stringify(outcome));
      expect(outcome).toMatchObject({ picked: true, runId, outcome: "review" });

      const { data: row } = await admin.from("site_agent_runs")
        .select("status, files, summary, conversation_id, error").eq("id", runId).single();
      expect(row?.status).toBe("review");
      const changed = Object.keys((row?.files as Record<string, unknown>) ?? {});
      console.log("[sa-live] changed files:", changed.join(", "), "| summary:", String(row?.summary).slice(0, 120));
      expect(changed.length).toBeGreaterThan(0);
      expect(changed).toContain("index.html");

      // ---- 4. the approve path's primitives ----
      const blob = await admin.storage.from(AGENT_SITES_BUCKET).download(resultZipPath(runId));
      expect(blob.error).toBeNull();
      const prepared = prepareSiteZip(new Uint8Array(await blob.data!.arrayBuffer()));
      expect(prepared.ok).toBe(true);
      if (!prepared.ok) throw new Error("unreachable");
      const snap = await snapshotSite(admin, host, new Date().toISOString());
      expect(snap.ok).toBe(true);
      const deployed = await overrideLiveSite(host, prepared.zip, prepared.files);
      expect(deployed).toMatchObject({ ok: true });

      // ---- 5. the LIVE site serves the agent's edit (cert can lag ~60s) ----
      let served: string | null = null;
      const deadline = Date.now() + 150_000;
      while (Date.now() < deadline) {
        try {
          const res = await fetch(`https://${host}/`, { redirect: "follow" });
          if (res.ok) {
            const body = await res.text();
            if (body.includes(NEW_PHONE)) { served = body; break; }
          }
        } catch { /* cert not issued yet */ }
        await new Promise((r) => setTimeout(r, 10_000));
      }
      expect(served, "live site never served the edited content").toBeTruthy();
      expect(served!).toContain(NEW_PHONE);
      expect(served!).not.toContain(OLD_PHONE);
      console.log(`[sa-live] VERIFIED: https://${host}/ serves the agent's edit`);
    } finally {
      // ---- teardown, FK-safe order; log everything if any step fails ----
      const failures: string[] = [];
      const attempt = async (label: string, fn: () => PromiseLike<unknown>) => {
        try { await fn(); } catch (e) { failures.push(`${label}: ${e instanceof Error ? e.message : e}`); }
      };
      if (subCreated) await attempt("deleteSubdomain", () => deleteSubdomain(sub));
      await attempt("agent-sites zips", () =>
        admin.storage.from(AGENT_SITES_BUCKET).remove([originalZipPath(runId), resultZipPath(runId)]));
      await attempt("snapshots", async () => {
        const { data } = await admin.storage.from("studio-sites").list(snapshotPrefix(host));
        const names = (data ?? []).map((f) => `${snapshotPrefix(host)}/${f.name}`);
        if (names.length) await admin.storage.from("studio-sites").remove(names);
      });
      if (ticketId) await attempt("activity_log", () =>
        admin.from("activity_log").delete().eq("entity_id", ticketId!));
      if (runInserted) await attempt("run row", () => admin.from("site_agent_runs").delete().eq("id", runId));
      if (ticketId) await attempt("ticket", () => admin.from("lead_tickets").delete().eq("id", ticketId!));
      if (leadId) await attempt("lead", () => admin.from("leads").delete().eq("id", leadId!));
      if (failures.length) {
        console.error(`[sa-live] CLEANUP FAILED for sub=${sub} run=${runId} ticket=${ticketId} lead=${leadId}:\n` +
          failures.join("\n"));
      } else {
        console.log("[sa-live] cleanup complete — no trace left");
      }
    }
  });
});
