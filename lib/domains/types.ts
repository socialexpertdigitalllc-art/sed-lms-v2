// lib/domains/types.ts — client domains (table client_domains, migration 0079).

export type DomainRegistrar = "cloudflare" | "hostinger";
export type DomainOrigin = "purchased" | "imported";

export type DomainStatus =
  | "purchasing" // registrar order in flight
  | "setting_up" // the pipeline is connecting DNS / hosting / SSL / the site
  | "waiting_for_site" // domain ready; the lead has no live staging site yet
  | "live" // the lead's site serves on the domain
  | "connected" // imported; set up by hand already — the pipeline never runs
  | "unassigned" // owned, not linked to a lead
  | "needs_attention" // a step failed; a human retries
  | "failed"; // the purchase failed — nothing was bought

/** Statuses the background processor works on. */
export const ACTIVE_DOMAIN_STATUSES = ["purchasing", "setting_up", "waiting_for_site"] as const;

export type StepKey = "registration" | "zone" | "hosting" | "dns" | "ssl" | "site";
export type StepState = "done" | "running" | "waiting" | "failed" | "skipped";

export interface StepProgress {
  state: StepState;
  at: string;
  detail?: string | null;
}

export interface ClientDomainRow {
  id: string;
  domain: string;
  registrar: DomainRegistrar;
  origin: DomainOrigin;
  lead_id: string | null;
  status: DomainStatus;
  step: StepKey | null;
  steps: Partial<Record<StepKey, StepProgress>>;
  last_error: string | null;
  next_run_at: string | null;
  claim_id: string | null;
  claimed_at: string | null;
  attempts: number;
  cf_zone_id: string | null;
  hosting_username: string | null;
  hostinger_order_id: number | null;
  hostinger_subscription_id: string | null;
  registration_cost_cents: number | null;
  renewal_cost_cents: number | null;
  currency: string | null;
  auto_renew: boolean | null;
  expires_at: string | null;
  purchased_by: string | null;
  purchased_at: string | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;
}

export const STEP_LABELS: Record<StepKey, string> = {
  registration: "Registration",
  zone: "DNS zone",
  hosting: "Hosting",
  dns: "DNS records",
  ssl: "SSL certificate",
  site: "Website live",
};

/** The pipeline for a registrar. A Hostinger-registered domain uses Hostinger
 *  DNS, which Hostinger points at the website itself — no Cloudflare zone. */
export function stepsFor(registrar: DomainRegistrar): StepKey[] {
  return registrar === "cloudflare"
    ? ["registration", "zone", "hosting", "dns", "ssl", "site"]
    : ["registration", "hosting", "dns", "ssl", "site"];
}

/** Dollars-as-string ("10.46") to integer cents; null when unparseable. */
export function toCents(amount: string | number | null | undefined): number | null {
  if (amount === null || amount === undefined || amount === "") return null;
  const n = Number(amount);
  return Number.isFinite(n) ? Math.round(n * 100) : null;
}

export const STATUS_LABELS: Record<DomainStatus, string> = {
  purchasing: "Purchasing",
  setting_up: "Setting up",
  waiting_for_site: "Waiting for site",
  live: "Live",
  connected: "Connected",
  unassigned: "Unassigned",
  needs_attention: "Needs attention",
  failed: "Purchase failed",
};
