import { lstat, readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { archiveDocroot, daConfigured, subFromWebsiteLink } from "@/lib/template-engine/directadmin";
import { getWebsite, hostingerConfigured } from "@/lib/hostinger/client";
import { zipFromMap } from "@/lib/template-engine/zip";
import { isProtectedDomain } from "./protected";

/**
 * "Download the latest website files" — a zip of what is LIVE on the hosting
 * right now, not the generator artifact. Two sources, mirroring how uploads
 * land (see deployments/[id]/upload):
 *   - staging subdomains ({sub}.DA_DOMAIN): DirectAdmin's download-archive API;
 *   - custom domains: the addon docroot read straight off the shared
 *     Hostinger filesystem (the same disk deployZipToDir writes to).
 * The staging check MUST come before the protected-domain check — DA_DOMAIN
 * is always in the protected list, so every staging subdomain would otherwise
 * read as protected and be refused.
 */

/** Cumulative uncompressed cap. Client sites upload as ≤60MB zips, so a
 *  docroot far past this is a wrong target (or junk), not a bigger site. */
const MAX_DIR_BYTES = 300 * 1024 * 1024;

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

/** Recursively zip a directory from the local filesystem. Symlinks are
 *  skipped (never follow a link out of the docroot); missing dir is an error. */
export async function zipDirFromDisk(
  dir: string,
): Promise<{ ok: true; zip: Uint8Array; files: number } | { ok: false; message: string }> {
  const map: Record<string, Uint8Array> = {};
  let total = 0;

  async function walk(abs: string, rel: string): Promise<string | null> {
    let entries;
    try {
      entries = await readdir(abs, { withFileTypes: true });
    } catch (e) {
      return `could not read ${abs}: ${e instanceof Error ? e.message : "fs error"}`;
    }
    for (const entry of entries) {
      const absChild = join(abs, entry.name);
      const relChild = rel ? `${rel}/${entry.name}` : entry.name;
      // dirent types are cheap but symlinks masquerade — lstat is the truth
      const stat = await lstat(absChild).catch(() => null);
      if (!stat || stat.isSymbolicLink()) continue;
      if (stat.isDirectory()) {
        const err = await walk(absChild, relChild);
        if (err) return err;
      } else if (stat.isFile()) {
        total += stat.size;
        if (total > MAX_DIR_BYTES) return `site files exceed ${Math.round(MAX_DIR_BYTES / 1024 / 1024)}MB`;
        map[relChild] = new Uint8Array(await readFile(absChild));
      }
    }
    return null;
  }

  const err = await walk(dir, "");
  if (err) return { ok: false, message: err };
  return { ok: true, zip: zipFromMap(map), files: Object.keys(map).length };
}

export type LiveSiteZip =
  | { ok: true; zip: Uint8Array; host: string; source: "staging" | "custom" }
  | { ok: false; status: 403 | 422 | 502; error: string };

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
    const zipped = await zipDirFromDisk(site.root_directory);
    if (!zipped.ok) {
      return { ok: false, status: 502, error: `Could not read the files of ${candidate}: ${zipped.message}` };
    }
    return { ok: true, zip: zipped.zip, host: candidate, source: "custom" };
  }
  return {
    ok: false,
    status: 422,
    error: `${host} is not hosted on the company hosting, so its files cannot be downloaded here.`,
  };
}
