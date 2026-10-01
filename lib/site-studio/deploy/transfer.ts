import type { SupabaseClient } from "@supabase/supabase-js";
import { archiveDocroot } from "@/lib/template-engine/directadmin";
import {
  deployZipToWebsite,
  ensureSsl,
  ensureWebsite,
  getWebsite,
  isStaticWebsite,
  listDomains,
  websiteTypeLabel,
  type HostingerWebsite,
} from "@/lib/hostinger/client";
import { isProtectedDomain } from "./protected";
import { snapshotSite } from "./snapshots";

/**
 * The hosting half of "transfer a staging site to the client's real domain",
 * shared by the deployments board (studio_deployments) and the v2 generation
 * route (template_generations) — each route only repoints its own rows.
 *
 *   1. the target must be ours: already a website on the hosting, or an active
 *      domain registered on the Hostinger account;
 *   2. a WordPress/Node site is refused — the archive deploy would erase it;
 *   3. the website is created if needed and its async setup awaited
 *      (still running → `pending`, nothing changed, safe to retry);
 *   4. the staging subdomain's CURRENT files are read (manual edits included);
 *   5. a target that already had a site is snapshotted first (restorable from
 *      the board's file history);
 *   6. the files are deployed over the Hostinger API and the deploy awaited —
 *      `settled: false` tells the caller to keep the staging copy;
 *   7. a free SSL certificate is requested when none is active.
 */

const HOSTNAME = /^(?=.{4,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z][a-z0-9-]{0,61}[a-z0-9]$/;

/** The operator's pick as a bare apex hostname, or why it can't be a target. */
export function normalizeTargetDomain(
  raw: unknown,
  daDomain: string,
): { ok: true; domain: string } | { ok: false; error: string } {
  if (typeof raw !== "string" || !raw.trim()) return { ok: false, error: "Pick a domain to transfer to" };
  const domain = raw
    .trim()
    .toLowerCase()
    .replace(/^[a-z][a-z0-9+.-]*:\/\//, "")
    .replace(/[/?#].*$/, "")
    .replace(/\.$/, "")
    .replace(/^www\./, "");
  if (!HOSTNAME.test(domain)) return { ok: false, error: `"${raw.trim()}" is not a domain name` };
  const da = daDomain.toLowerCase();
  if (da && (domain === da || domain.endsWith(`.${da}`))) {
    return { ok: false, error: `${domain} is a staging address — pick the client's own domain` };
  }
  if (isProtectedDomain(domain)) {
    return { ok: false, error: `${domain} is a protected company domain — sites can't be transferred onto it` };
  }
  return { ok: true, domain };
}

export type TransferStep = "target" | "hosting" | "read" | "deploy";

export type PushResult =
  | {
      ok: true;
      website: HostingerWebsite;
      /** The website was created by this transfer (it had no site before). */
      created: boolean;
      /** Hostinger finished unpacking the files within the wait. */
      settled: boolean;
      /** Storage path of the snapshot of what the domain served before. */
      snapshot: string | null;
      /** Set when the domain had a site but the snapshot could not be taken. */
      snapshotError: string | null;
      ssl: string | null;
    }
  | { ok: false; status: 409 | 422 | 502; step: TransferStep; error: string; pending?: boolean };

export async function pushStagingToDomain(input: {
  admin: SupabaseClient;
  sub: string;
  domain: string;
  nowIso: string;
}): Promise<PushResult> {
  const { admin, sub, domain, nowIso } = input;

  // 1–2. the target is ours and can take static files
  const existing = await getWebsite(domain);
  if (existing && !isStaticWebsite(existing)) {
    return {
      ok: false,
      status: 409,
      step: "target",
      error: `${domain} already hosts a ${websiteTypeLabel(existing.website_type)} site — transferring would erase it.`,
    };
  }
  if (!existing) {
    const owned = await listDomains();
    if (owned === null) {
      return { ok: false, status: 502, step: "target", error: "Could not reach Hostinger to check the domain — try again." };
    }
    const reg = owned.find((d) => d.domain.toLowerCase() === domain);
    if (!reg) {
      return {
        ok: false,
        status: 422,
        step: "target",
        error: `${domain} is neither registered on the Hostinger account nor hosted there — add it in Hostinger first.`,
      };
    }
    if ((reg.status ?? "").toLowerCase() !== "active") {
      return { ok: false, status: 422, step: "target", error: `${domain} is ${reg.status} on Hostinger, not active.` };
    }
  }

  // 3. hosting ready (created + setup finished)
  const site = await ensureWebsite(domain);
  if (!site.ok) {
    return {
      ok: false,
      status: site.pending ? 409 : 502,
      step: "hosting",
      error: site.pending ? site.message : `Could not set up hosting for ${domain}: ${site.message}`,
      pending: site.pending,
    };
  }
  if (!isStaticWebsite(site.website)) {
    return {
      ok: false,
      status: 409,
      step: "target",
      error: `${domain} hosts a ${websiteTypeLabel(site.website.website_type)} site — transferring would erase it.`,
    };
  }

  // 4. the staging site's current files
  const zip = await archiveDocroot(sub);
  if (!zip) {
    return { ok: false, status: 502, step: "read", error: "Could not read the current subdomain files to transfer." };
  }

  // 5. keep what the domain served before (restorable from the file history)
  let snapshot: string | null = null;
  let snapshotError: string | null = null;
  if (!site.created) {
    const snap = await snapshotSite(admin, `https://${domain}`, nowIso);
    if (snap.ok) snapshot = snap.path;
    else snapshotError = snap.message;
  }

  // 6. deploy + wait for Hostinger to unpack it
  const deployed = await deployZipToWebsite(site.website, zip);
  if (!deployed.ok) {
    return {
      ok: false,
      status: deployed.pending ? 409 : 502,
      step: "deploy",
      error: `Could not write the site to ${domain}: ${deployed.message}`,
      pending: deployed.pending,
    };
  }

  // 7. HTTPS (background on Hostinger; never fails the transfer)
  const ssl = await ensureSsl(site.website).catch(() => null);

  return { ok: true, website: site.website, created: site.created, settled: deployed.settled, snapshot, snapshotError, ssl };
}

/** Quick reachability probe — DNS/certificate provisioning is async, so a
 *  miss only means "not yet". */
export async function probeSite(domain: string): Promise<boolean> {
  for (const scheme of ["https", "http"] as const) {
    try {
      const res = await fetch(`${scheme}://${domain}/`, { signal: AbortSignal.timeout(4000) });
      if (res.ok || res.status === 301 || res.status === 308) return true;
    } catch {
      // provisioning
    }
  }
  return false;
}
