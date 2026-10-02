// lib/domains/pipeline.ts — one step of connecting a client domain. Each step
// looks at the world, does at most one bounded thing, and says what happens
// next: move on (done), look again later (wait), give up (fail), park until
// the lead has a site (waiting_for_site), or finished (live). Steps are
// idempotent — re-running one after a crash or a retry is always safe.
import type { SupabaseClient } from "@supabase/supabase-js";
import type * as Cf from "@/lib/cloudflare/client";
import type * as Hg from "@/lib/hostinger/client";
import type { goLiveOnDomain, findOrTrackStaging, recordSiteOnDomain } from "@/lib/site-studio/deploy/golive";
import { siteHostFrom } from "@/lib/site-studio/deploy/liveFiles";
import { clientSitesIp, planDns, planIsEmpty } from "./dns";
import type { ClientDomainRow, StepKey } from "./types";

export type StepOutcome =
  | { kind: "done"; detail: string; patch?: Partial<ClientDomainRow> }
  | { kind: "wait"; detail: string; retryInMs: number; patch?: Partial<ClientDomainRow> }
  | { kind: "fail"; detail: string; purchaseFailed?: boolean }
  | { kind: "waiting_for_site"; detail: string }
  | { kind: "live"; detail: string };

export interface PipelineDeps {
  admin: SupabaseClient;
  cf: Pick<
    typeof Cf,
    | "getRegistrationStatus"
    | "getRegistration"
    | "setAutoRenew"
    | "findZone"
    | "createZone"
    | "listDnsRecords"
    | "createDnsRecord"
    | "updateDnsRecord"
    | "deleteDnsRecord"
  >;
  hostinger: Pick<
    typeof Hg,
    | "getWebsite"
    | "ensureWebsite"
    | "verifyDomainOwnership"
    | "ensureSsl"
    | "isStaticWebsite"
    | "websiteTypeLabel"
    | "getHostingerPortfolioDomain"
    | "completeHostingerDomainSetup"
    | "enableHostingerAutoRenew"
  >;
  goLive: typeof goLiveOnDomain;
  /** The lead's staging site — tracked, or found through the lead's dmviral link. */
  findStaging: typeof findOrTrackStaging;
  /** Does the domain's website already hold a site (a homepage in its folder)?
   *  null = Hostinger couldn't be read — never taken for "empty". */
  siteOnDomain: (domain: string) => Promise<boolean | null>;
  /** Record a site already on the domain as the lead's (link, log, notify). */
  recordLive: typeof recordSiteOnDomain;
  /** Does the hosting server at `ip` serve `domain`? null = could not tell. */
  probeVhost: (ip: string, domain: string) => Promise<boolean | null>;
  /** Public A records of a domain (DNS-over-HTTPS); null = lookup failed. */
  resolvesTo: (domain: string) => Promise<string[] | null>;
  /** Cloudflare registrar sandbox: registrations are simulated, so no step
   *  past registration may touch real DNS / hosting for a fake domain. */
  sandbox?: boolean;
}

const SEC = 1000;
const MIN = 60 * SEC;

const done = (detail: string, patch?: Partial<ClientDomainRow>): StepOutcome => ({ kind: "done", detail, patch });
const wait = (detail: string, retryInMs: number, patch?: Partial<ClientDomainRow>): StepOutcome => ({
  kind: "wait",
  detail,
  retryInMs,
  patch,
});
const fail = (detail: string, purchaseFailed = false): StepOutcome => ({ kind: "fail", detail, purchaseFailed });

/** How many "look again later" rounds a step gets before it is given up. */
export const MAX_POLLS: Record<StepKey, number> = {
  registration: 400, // Cloudflare: seconds; Hostinger payment processing: up to ~a day
  zone: 10,
  hosting: 90, // setup (minutes) + an ownership TXT round if Hostinger asks for one
  dns: 30,
  ssl: 150, // certificate issuance waits for DNS — up to ~2.5h
  site: 40, // a transfer still settling
};

export async function runStep(row: ClientDomainRow, step: StepKey, deps: PipelineDeps): Promise<StepOutcome> {
  if (deps.sandbox && step !== "registration") {
    return fail("Test mode (Cloudflare sandbox): the domain isn't real, so DNS, hosting and SSL are skipped");
  }
  switch (step) {
    case "registration":
      return row.registrar === "cloudflare" ? cfRegistration(row, deps) : hostingerRegistration(row, deps);
    case "zone":
      return zoneStep(row, deps);
    case "hosting":
      return hostingStep(row, deps);
    case "dns":
      return row.registrar === "cloudflare" ? cfDnsStep(row, deps) : hostingerDnsStep(row, deps);
    case "ssl":
      return sslStep(row, deps);
    case "site":
      return siteStep(row, deps);
  }
}

// ---------------------------------------------------------------------------

async function cfRegistration(row: ClientDomainRow, deps: PipelineDeps): Promise<StepOutcome> {
  if (row.origin === "imported") return done("Already registered on Cloudflare");
  const wf = await deps.cf.getRegistrationStatus(row.domain);
  if (!wf) return wait("Waiting for Cloudflare to confirm the registration", 30 * SEC);
  const why = wf.error?.message ? `: ${wf.error.message}` : "";
  switch (wf.state) {
    case "succeeded": {
      const reg = wf.context?.registration ?? (await deps.cf.getRegistration(row.domain));
      let autoRenew = reg?.auto_renew ?? null;
      // The API can't renew and auto-renew defaults to off — make sure it's on.
      if (autoRenew === false) {
        const set = await deps.cf.setAutoRenew(row.domain, true);
        if (set.ok) autoRenew = true;
      }
      return done("Registered on Cloudflare", { expires_at: reg?.expires_at ?? null, auto_renew: autoRenew });
    }
    case "failed":
      return fail(`Cloudflare could not register the domain${why}`, true);
    case "action_required":
    case "blocked":
      return fail(`Cloudflare needs an action in its dashboard before the registration can finish${why}`);
    default:
      return wait(`Cloudflare is processing the registration (${wf.state.replace(/_/g, " ")})`, 20 * SEC);
  }
}

async function hostingerRegistration(row: ClientDomainRow, deps: PipelineDeps): Promise<StepOutcome> {
  if (row.origin === "imported") return done("Already registered on Hostinger");
  const p = await deps.hostinger.getHostingerPortfolioDomain(row.domain);
  if (!p) return wait("Waiting for Hostinger to confirm the order (payment processing)", 5 * MIN);
  switch (p.status) {
    case "active": {
      let autoRenew: boolean | null = null;
      if (row.hostinger_subscription_id) {
        const r = await deps.hostinger.enableHostingerAutoRenew(row.hostinger_subscription_id);
        if (r.ok) autoRenew = true;
      }
      return done("Registered on Hostinger", autoRenew === null ? undefined : { auto_renew: autoRenew });
    }
    case "pending_setup": {
      const r = await deps.hostinger.completeHostingerDomainSetup(row.domain);
      return wait(r.ok ? "Completing the registration on Hostinger" : `Hostinger setup: ${r.message ?? "retrying"}`, MIN);
    }
    case "requested":
    case "pending_verification":
      return wait(`Hostinger: registration ${p.status.replace(/_/g, " ")}`, 2 * MIN);
    default:
      return fail(`Hostinger reports the domain as ${p.status.replace(/_/g, " ")}`, p.status === "failed");
  }
}

async function zoneStep(row: ClientDomainRow, deps: PipelineDeps): Promise<StepOutcome> {
  const z = await deps.cf.findZone(row.domain);
  if (z === "error") return wait("Could not reach Cloudflare", 30 * SEC);
  if (z) return done(`Cloudflare zone ${z.status}`, { cf_zone_id: z.id });
  const created = await deps.cf.createZone(row.domain);
  return created.ok
    ? done("Cloudflare zone created", { cf_zone_id: created.zone.id })
    : fail(`Could not create the Cloudflare DNS zone: ${created.message}`);
}

async function hostingStep(row: ClientDomainRow, deps: PipelineDeps): Promise<StepOutcome> {
  const { hostinger } = deps;
  const existing = await hostinger.getWebsite(row.domain);
  if (existing && !hostinger.isStaticWebsite(existing)) {
    return fail(`${row.domain} already hosts a ${hostinger.websiteTypeLabel(existing.website_type)} site on Hostinger — it would be erased`);
  }
  if (!existing && row.registrar === "cloudflare") {
    // Hostinger only hosts an outside domain it can use; a TXT round is needed
    // only when another Hostinger customer has the domain.
    const own = await hostinger.verifyDomainOwnership(row.domain);
    if (!own) return wait("Could not reach Hostinger", 30 * SEC);
    if (!own.accessible) {
      if (!own.txt) return fail(`Hostinger says ${row.domain} is already used by a website on another account`);
      if (!row.cf_zone_id) return fail("No Cloudflare zone to add Hostinger's verification record to");
      const recs = await deps.cf.listDnsRecords(row.cf_zone_id);
      if (!recs) return wait("Could not read the DNS zone", 30 * SEC);
      const has = recs.some((r) => r.type === "TXT" && r.content.replace(/^"|"$/g, "") === own.txt);
      if (!has) {
        const added = await deps.cf.createDnsRecord(row.cf_zone_id, { type: "TXT", name: row.domain, content: own.txt });
        if (!added.ok) return fail(`Could not add Hostinger's verification record: ${added.message}`);
      }
      return wait("Proving ownership to Hostinger (verification TXT record added)", MIN);
    }
  }
  const ensured = await hostinger.ensureWebsite(row.domain, { waitMs: 0 });
  if (ensured.ok) {
    return done(ensured.created ? "Hosting created on Hostinger" : "Hosting ready on Hostinger", {
      hosting_username: ensured.website.username,
    });
  }
  return ensured.pending
    ? wait("Hostinger is setting up the hosting (usually 1–3 minutes)", 20 * SEC)
    : fail(`Could not set up hosting: ${ensured.message}`);
}

async function cfDnsStep(row: ClientDomainRow, deps: PipelineDeps): Promise<StepOutcome> {
  if (!row.cf_zone_id) return fail("No Cloudflare zone recorded for this domain");
  const ip = clientSitesIp();
  // Never point a domain at a server that doesn't host it yet.
  const served = await deps.probeVhost(ip, row.domain);
  if (served === null) return wait("Could not reach the hosting server", 30 * SEC);
  if (!served) return wait(`Waiting for the hosting server (${ip}) to serve ${row.domain}`, 30 * SEC);

  const records = await deps.cf.listDnsRecords(row.cf_zone_id);
  if (!records) return wait("Could not read the DNS zone", 30 * SEC);
  const plan = planDns(row.domain, ip, records);
  if (planIsEmpty(plan)) return done(`DNS already points at Hostinger (${ip})`);

  // removals first: a CNAME can't be created while A/AAAA records share its name
  for (const r of plan.remove) {
    const res = await deps.cf.deleteDnsRecord(row.cf_zone_id, r.id);
    if (!res.ok) return fail(`Could not remove the conflicting record ${r.what}: ${res.message}`);
  }
  for (const u of plan.update) {
    const res = await deps.cf.updateDnsRecord(row.cf_zone_id, u.id, u.rec);
    if (!res.ok) return fail(`Could not update ${u.from} to ${u.rec.type} ${u.rec.content}: ${res.message}`);
  }
  for (const c of plan.create) {
    const res = await deps.cf.createDnsRecord(row.cf_zone_id, c);
    if (!res.ok) return fail(`Could not create ${c.type} ${c.name}: ${res.message}`);
  }
  const changes = plan.create.length + plan.update.length + plan.remove.length;
  return done(`DNS pointed at Hostinger (${ip}) — ${changes} record change${changes === 1 ? "" : "s"}`);
}

async function hostingerDnsStep(row: ClientDomainRow, deps: PipelineDeps): Promise<StepOutcome> {
  // A Hostinger-registered domain uses Hostinger's nameservers, which point it
  // at the website as soon as the website exists — just confirm it resolves.
  const ips = await deps.resolvesTo(row.domain);
  if (ips === null) return wait("Could not look up the domain's DNS", 30 * SEC);
  if (ips.length > 0) return done(`DNS points at ${ips.join(", ")}`);
  return wait("Waiting for Hostinger's DNS to point the domain at the website", MIN);
}

async function sslStep(row: ClientDomainRow, deps: PipelineDeps): Promise<StepOutcome> {
  let username = row.hosting_username;
  if (!username) {
    const w = await deps.hostinger.getWebsite(row.domain);
    if (!w) return wait("Could not find the website on Hostinger", 30 * SEC);
    username = w.username;
  }
  const status = await deps.hostinger.ensureSsl({ domain: row.domain, username });
  if (status === "active") return done("Certificate active", { hosting_username: username });
  if (status === null) return wait("Could not read the SSL status", MIN, { hosting_username: username });
  // ensureSsl re-requests a certificate that is missing or failed
  return wait(`Certificate ${status.replace(/_/g, " ")} — Hostinger issues it once DNS has spread`, MIN, {
    hosting_username: username,
  });
}

async function siteStep(row: ClientDomainRow, deps: PipelineDeps): Promise<StepOutcome> {
  if (!row.lead_id) return fail("No lead is linked to this domain");
  const { data: lead } = await deps.admin.from("leads").select("website_link").eq("id", row.lead_id).maybeSingle();
  const current = siteHostFrom((lead as { website_link?: string | null } | null)?.website_link ?? "");
  if (current && current.replace(/^www\./, "") === row.domain) {
    return { kind: "live", detail: "The lead's website is live on this domain" };
  }
  const actorId = row.purchased_by ?? row.created_by;

  // A site already on the domain is the lead's site — uploaded by hand while
  // the client waited, or an earlier transfer. Record it; never overwrite it.
  const onDomain = await deps.siteOnDomain(row.domain);
  if (onDomain === null) return wait("Could not read the domain's files on Hostinger", MIN);
  if (onDomain) {
    await deps.recordLive({ admin: deps.admin, leadId: row.lead_id, domain: row.domain, actorId, how: "found_on_domain" });
    return {
      kind: "live",
      detail: "The site was already on the domain (uploaded by hand) — the lead's website link now points here; nothing was overwritten",
    };
  }

  const staging = await deps.findStaging(deps.admin, row.lead_id, actorId);
  if (!staging) {
    return {
      kind: "waiting_for_site",
      detail:
        "The domain is ready — the lead's site goes live here as soon as it has one: deploy it to a staging site (or put its dmviral link on the lead), or upload it to the domain",
    };
  }
  const r = await deps.goLive({
    admin: deps.admin,
    deploymentId: staging.id,
    domain: row.domain,
    actorId,
    leadId: row.lead_id,
  });
  if (r.ok) {
    return {
      kind: "live",
      detail: r.settled ? `Live at ${r.url}` : `Live at ${r.url} (Hostinger is still unpacking the files)`,
    };
  }
  if (r.pending) return wait(r.error, 30 * SEC);
  return fail(`Could not put the site live: ${r.error}`);
}
