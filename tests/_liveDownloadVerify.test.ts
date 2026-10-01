// @vitest-environment node
/**
 * Live verification of the "download latest website files" path (v2.10.1),
 * precedent: _task12LiveDeployVerify.test.ts. Gated: runs ONLY with
 * LIVE_DL_VERIFY=1, skipped by every normal run.
 *
 * STRICTLY READ-ONLY against production: it selects a live row from the
 * deployments board's table, pulls the site's current files through the REAL
 * fetchLiveSiteZip (the exact function the download endpoint calls), and
 * proves the zip is the live site by matching a distinctive chunk of the
 * zip's index.html against what the site serves over the network right now.
 * No rows are written, nothing is uploaded, nothing needs cleanup.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { createClient } from "@supabase/supabase-js";
import { fetchLiveSiteZip } from "@/lib/site-studio/deploy/liveFiles";
import { isStaticWebsite, listDomains, listWebsites } from "@/lib/hostinger/client";
import { unzipToMap } from "@/lib/template-engine/zip";

const live = process.env.LIVE_DL_VERIFY === "1";

// load .env.local fully (vitest does not) — only when enabled: test files can
// share a worker process, and real credentials must not leak into the normal
// suite. (CRLF-safe: a Windows-saved .env.local leaves "\r" on every line,
// which the pattern's `.` cannot match — every variable silently failed.)
if (live) {
  for (const line of readFileSync(".env.local", "utf8").split(/\r?\n/)) {
    const m = line.match(/^([A-Z_][A-Z0-9_]*)=(.*)$/);
    if (m && m[2].trim()) process.env[m[1]] = m[2].trim();
  }
}

describe.skipIf(!live)("LIVE — download latest website files from the board", () => {
  it("zips a live staging site's CURRENT files, matching what it serves right now", async () => {
    const admin = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
      auth: { autoRefreshToken: false, persistSession: false },
    });
    const daDomain = process.env.DA_DOMAIN ?? "";
    expect(daDomain).not.toBe("");

    // a handful of live staging rows, newest first — exactly what the board lists
    const { data: rows, error } = await admin
      .from("studio_deployments")
      .select("id, subdomain, url, status, deployed_at")
      .eq("status", "live")
      .like("url", `%.${daDomain}%`)
      .order("deployed_at", { ascending: false })
      .limit(5);
    expect(error).toBeNull();
    expect(rows && rows.length, "no live staging deployments on the board to test against").toBeTruthy();

    const report: Record<string, unknown> = {};
    // first row whose site is actually reachable (a just-shuffled row can lag DNS)
    let picked: { url: string; servedHtml: string } | null = null;
    for (const row of rows ?? []) {
      try {
        const res = await fetch(`${row.url}/`, { signal: AbortSignal.timeout(10000) });
        if (res.ok) {
          picked = { url: row.url as string, servedHtml: await res.text() };
          report.row = { id: row.id, url: row.url, deployed_at: row.deployed_at };
          break;
        }
      } catch {
        // unreachable — try the next live row
      }
    }
    expect(picked, "none of the 5 newest live staging sites responded over HTTP").not.toBeNull();
    if (!picked) return;

    // ---- the REAL download path (what the endpoint runs when the icon is clicked)
    const result = await fetchLiveSiteZip(picked.url);
    report.resultOk = result.ok;
    if (!result.ok) throw new Error(`fetchLiveSiteZip failed: ${result.status} ${result.error}`);
    expect(result.source).toBe("staging");

    const files = unzipToMap(result.zip);
    const names = Object.keys(files);
    report.zipBytes = result.zip.length;
    report.fileCount = names.length;
    report.sampleFiles = names.slice(0, 10);
    expect(names.length).toBeGreaterThan(0);

    const indexName = names.find((n) => /^index\.html?$/i.test(n));
    expect(indexName, `zip has no index.html — got: ${names.slice(0, 20).join(", ")}`).toBeTruthy();

    // ---- freshness proof: a distinctive chunk of the ZIP's index.html must be
    // what the live site serves right now. Normalize BOTH full documents with
    // the SAME strip (task12's first failure was asymmetric normalization; this
    // test's first failure was a fixed-width window that cut a tag in half and
    // left raw HTML in the needle). A mid-document chunk is the needle — same
    // bytes must appear served.
    const norm = (h: string) => h.replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim();
    const zipNorm = norm(new TextDecoder().decode(files[indexName as string]));
    expect(zipNorm.length).toBeGreaterThan(80);
    const needle = zipNorm.slice(Math.floor(zipNorm.length / 2), Math.floor(zipNorm.length / 2) + 60);
    report.needle = needle;
    expect(needle.length).toBeGreaterThan(10);

    const servedNorm = norm(picked.servedHtml);
    report.matched = servedNorm.includes(needle);
    console.log("[live-dl] REPORT:", JSON.stringify(report, null, 2));
    expect(report.matched, "zip content does not match what the live site serves").toBe(true);
  }, 120000);

  it("zips a live CUSTOM-DOMAIN site (other hosting account) through the Hostinger file server", async () => {
    // The custom domains live on a different Linux account than the LMS — the
    // read must go over the API. Candidates: the board's tracked custom-domain
    // rows first (small sites), then any static website on the hosting.
    const admin = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
      auth: { autoRefreshToken: false, persistSession: false },
    });
    const daDomain = process.env.DA_DOMAIN ?? "";
    const { data: rows } = await admin
      .from("studio_deployments")
      .select("url")
      .eq("status", "live")
      .not("url", "like", `%.${daDomain}%`)
      .limit(5);
    const websites = (await listWebsites()) ?? [];
    const statics = websites.filter((w) => isStaticWebsite(w) && !w.domain.endsWith(".hostingersite.com"));
    const candidates = [
      ...(rows ?? []).map((r) => new URL(r.url as string).hostname),
      ...statics.map((w) => w.domain),
    ];
    expect(candidates.length, "no static custom-domain sites to test against").toBeGreaterThan(0);

    const report: Record<string, unknown> = {};
    let picked: { host: string; servedHtml: string } | null = null;
    for (const host of candidates.slice(0, 10)) {
      try {
        const res = await fetch(`https://${host}/`, { signal: AbortSignal.timeout(10000) });
        if (res.ok) {
          picked = { host, servedHtml: await res.text() };
          break;
        }
      } catch {
        // unreachable — next
      }
    }
    expect(picked, "none of the candidate custom domains responded over HTTPS").not.toBeNull();
    if (!picked) return;
    report.host = picked.host;
    report.account = websites.find((w) => w.domain === picked!.host)?.username;

    const result = await fetchLiveSiteZip(`https://${picked.host}`);
    if (!result.ok) throw new Error(`fetchLiveSiteZip failed: ${result.status} ${result.error}`);
    expect(result.source).toBe("custom");

    const files = unzipToMap(result.zip);
    const names = Object.keys(files);
    report.zipBytes = result.zip.length;
    report.fileCount = names.length;
    const indexName = names.find((n) => /^index\.html?$/i.test(n));
    expect(indexName, `zip has no index.html — got: ${names.slice(0, 20).join(", ")}`).toBeTruthy();

    const norm = (h: string) => h.replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim();
    const zipNorm = norm(new TextDecoder().decode(files[indexName as string]));
    const needle = zipNorm.slice(Math.floor(zipNorm.length / 2), Math.floor(zipNorm.length / 2) + 60);
    report.needle = needle;
    report.matched = norm(picked.servedHtml).includes(needle);
    console.log("[live-dl] CUSTOM REPORT:", JSON.stringify(report, null, 2));
    expect(report.matched, "zip content does not match what the custom domain serves").toBe(true);
  }, 300000);

  it("the domain list has no nameless entries and keeps the domains registered after the free-domain placeholder", async () => {
    const domains = await listDomains();
    expect(domains, "portfolio could not be read").not.toBeNull();
    expect(domains!.every((d) => typeof d.domain === "string" && d.domain.length > 0)).toBe(true);
    // the exact ownership check that used to throw on the null entry
    const last = domains![domains!.length - 1].domain;
    expect(domains!.some((d) => d.domain.toLowerCase() === last.toLowerCase())).toBe(true);
    console.log(`[live-dl] portfolio: ${domains!.length} named domains, last = ${last}`);
  }, 60000);
});
