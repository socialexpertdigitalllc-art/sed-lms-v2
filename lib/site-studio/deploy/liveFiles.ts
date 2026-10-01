import {
  archiveDocroot,
  clearDocroot,
  daConfigured,
  subFromWebsiteLink,
  uploadZipAndExtract,
} from "@/lib/template-engine/directadmin";
import {
  deployZipToWebsite,
  downloadWebsiteZip,
  getWebsite,
  hostingerConfigured,
  isStaticWebsite,
  websiteTypeLabel,
} from "@/lib/hostinger/client";
import { unzipToMap, zipFromMap } from "@/lib/template-engine/zip";
import { isProtectedDomain } from "./protected";

/**
 * "Download the latest website files" — a zip of what is LIVE on the hosting
 * right now, not the generator artifact. Two sources, mirroring how uploads
 * land (see deployments/[id]/upload):
 *   - staging subdomains ({sub}.DA_DOMAIN): DirectAdmin's download-archive API;
 *   - custom domains: the Hostinger API both ways — reads through the file
 *     server (downloadWebsiteZip), writes as an archive deploy
 *     (deployZipToWebsite). Never the local disk: the client sites live on a
 *     different hosting account than the LMS since the plan migration.
 * Only plain static websites are read or written: a WordPress/Node site is not
 * a folder of site files, and a static deploy would erase it.
 * The staging check MUST come before the protected-domain check — DA_DOMAIN
 * is always in the protected list, so every staging subdomain would otherwise
 * read as protected and be refused.
 */

/** Hostname out of a URL or bare host ("https://a.b/x", "a.b") — null when unparseable. */
export function siteHostFrom(input: string): string | null {
  const raw = (input ?? "").trim();
  if (!raw) return null;
  const withScheme = /^[a-z][a-z0-9+.-]*:\/\//i.test(raw) ? raw : `https://${raw}`;
  try {
    const host = new URL(withScheme).hostname.toLowerCase().replace(/\.$/, "");
    return host.includes(".") ? host : null;
  } catch {
    return null;
  }
}

/** Lookup candidates for the Hostinger website list: addon sites register the
 *  apex, but a lead's link may say www. */
export function hostCandidates(host: string): string[] {
  const apex = host.replace(/^www\./, "");
  return apex === host ? [host] : [host, apex];
}

/** Attachment filename: host (sanitized) + day, so repeat pulls sort by date. */
export function siteZipFilename(host: string, now: Date): string {
  const day = now.toISOString().slice(0, 10);
  return `${host.replace(/[^a-z0-9.-]/gi, "_")}-files-${day}.zip`;
}

/**
 * Normalize + sanity-check an uploaded site zip BEFORE it touches a live
 * docroot: strip a single shared root folder (a folder-zipped site would
 * otherwise land nested one level deep and break), reject zip-slip paths,
 * and require an index.html so a random archive can't wipe a working site.
 * Returns a re-zipped normalized archive.
 */
export function prepareSiteZip(
  bytes: Uint8Array,
): { ok: true; zip: Uint8Array; files: number } | { ok: false; message: string } {
  let map: Record<string, Uint8Array>;
  try {
    map = unzipToMap(bytes);
  } catch (e) {
    return { ok: false, message: e instanceof Error ? e.message : "not a readable zip" };
  }
  const names = Object.keys(map);
  if (names.length === 0) return { ok: false, message: "the zip is empty" };
  if (!names.some((n) => /^index\.html?$/i.test(n))) {
    return { ok: false, message: "the zip has no index.html at its root — this does not look like a website" };
  }
  return { ok: true, zip: zipFromMap(map), files: names.length };
}

export type LiveSiteZip =
  | { ok: true; zip: Uint8Array; host: string; source: "staging" | "custom" }
  | { ok: false; status: 403 | 409 | 422 | 502; error: string };

export type LiveSiteOverride =
  | {
      ok: true;
      host: string;
      source: "staging" | "custom";
      files: number;
      sub: string | null;
      /** False when Hostinger accepted the deploy but had not finished
       *  unpacking it when we stopped waiting (it normally completes). */
      settled: boolean;
    }
  | { ok: false; status: 403 | 409 | 422 | 502; error: string };

/** Why a custom-domain site's files can't be handled here, or null if they can. */
function nonStaticRefusal(site: { domain: string; website_type?: string | null }, verb: string): string | null {
  if (isStaticWebsite(site)) return null;
  return (
    `${site.domain} is a ${websiteTypeLabel(site.website_type)} site, not a folder of website files — ` +
    `it can't be ${verb} from the dashboard (manage it in Hostinger's hPanel).`
  );
}

/**
 * Replace a hosted site's live files with a (already prepareSiteZip'd) zip —
 * the write mirror of fetchLiveSiteZip, branching identically: staging
 * subdomains through DirectAdmin (clear + extract in place, same subdomain so
 * the lead's link stays valid), custom domains through the Hostinger API
 * archive deploy. Same ordering constraint: the staging check MUST precede
 * the protected-domain check.
 */
export async function overrideLiveSite(rawSite: string, zip: Uint8Array, files: number): Promise<LiveSiteOverride> {
  const host = siteHostFrom(rawSite);
  if (!host) return { ok: false, status: 422, error: "That is not a valid website address." };

  const daDomain = process.env.DA_DOMAIN ?? "";
  const sub = daDomain ? subFromWebsiteLink(`https://${host}`, daDomain) : null;
  if (sub) {
    if (!daConfigured()) return { ok: false, status: 422, error: "DirectAdmin is not configured." };
    const cleared = await clearDocroot(sub);
    if (!cleared.ok) console.warn(`[override] clearDocroot(${sub}) failed: ${cleared.message}`);
    const uploaded = await uploadZipAndExtract(sub, zip, "override.zip");
    if (!uploaded.ok && uploaded.failedStep !== "delete") {
      return {
        ok: false,
        status: 502,
        error: `Upload failed at ${uploaded.failedStep}: ${uploaded.message ?? "failed"}`,
      };
    }
    return { ok: true, host, source: "staging", files, sub, settled: true };
  }

  if (isProtectedDomain(host)) {
    return {
      ok: false,
      status: 403,
      error: `${host} is a protected company domain — its files cannot be overridden from the dashboard.`,
    };
  }
  if (!hostingerConfigured()) return { ok: false, status: 422, error: "Hostinger is not configured." };

  for (const candidate of hostCandidates(host)) {
    const site = await getWebsite(candidate);
    if (!site) continue;
    const refusal = nonStaticRefusal(site, "overwritten");
    if (refusal) return { ok: false, status: 422, error: refusal };
    // Over the API, not the disk: since the plan migration the custom domains
    // can live on a different hosting account than the LMS.
    const deployed = await deployZipToWebsite(site, zip);
    if (!deployed.ok) {
      return {
        ok: false,
        status: deployed.pending ? 409 : 502,
        error: `Could not write the site to ${candidate}: ${deployed.message ?? "deploy failed"}`,
      };
    }
    return { ok: true, host: candidate, source: "custom", files, sub: null, settled: deployed.settled };
  }
  return {
    ok: false,
    status: 422,
    error: `${host} is not hosted on the company hosting, so its files cannot be updated here.`,
  };
}

/** The live files of a hosted site as zip bytes, from whichever platform
 *  serves it. Never throws; failures carry the HTTP status a route should return. */
export async function fetchLiveSiteZip(rawSite: string): Promise<LiveSiteZip> {
  const host = siteHostFrom(rawSite);
  if (!host) return { ok: false, status: 422, error: "That is not a valid website address." };

  const daDomain = process.env.DA_DOMAIN ?? "";
  const sub = daDomain ? subFromWebsiteLink(`https://${host}`, daDomain) : null;
  if (sub) {
    if (!daConfigured()) return { ok: false, status: 422, error: "DirectAdmin is not configured." };
    const zip = await archiveDocroot(sub);
    if (!zip) return { ok: false, status: 502, error: `Could not read the live files of ${host} from the hosting.` };
    return { ok: true, zip, host, source: "staging" };
  }

  if (isProtectedDomain(host)) {
    return {
      ok: false,
      status: 403,
      error: `${host} is a protected company domain — its files cannot be downloaded from the dashboard.`,
    };
  }
  if (!hostingerConfigured()) return { ok: false, status: 422, error: "Hostinger is not configured." };

  for (const candidate of hostCandidates(host)) {
    const site = await getWebsite(candidate);
    if (!site) continue;
    const refusal = nonStaticRefusal(site, "downloaded or edited");
    if (refusal) return { ok: false, status: 422, error: refusal };
    const downloaded = await downloadWebsiteZip(site);
    if (!downloaded.ok) {
      return {
        ok: false,
        status: downloaded.pending ? 409 : 502,
        error: `Could not read the files of ${candidate}: ${downloaded.message}`,
      };
    }
    return { ok: true, zip: downloaded.zip, host: candidate, source: "custom" };
  }
  return {
    ok: false,
    status: 422,
    error: `${host} is not hosted on the company hosting, so its files cannot be downloaded here.`,
  };
}
