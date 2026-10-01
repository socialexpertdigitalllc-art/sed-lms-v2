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
  // ---- migration 0080: registrar sync + site health
  /** active | expired | pending | missing (no longer in the account) | … */
  registrar_status: string | null;
  registered_at: string | null;
  /** When the registrar next charges for the renewal. */
  next_billing_at: string | null;
  synced_at: string | null;
  details: DomainDetails;
  health_state: HealthState | null;
  health: DomainHealth | Record<string, never>;
  health_checked_at: string | null;
}

/** Registrar settings snapshot kept on the row (refreshed by sync / the detail page). */
export interface DomainDetails {
  locked?: boolean | null;
  privacy?: boolean | null;
  nameservers?: string[];
  subscription_status?: string | null;
  /** An outgoing move to another Hostinger account. */
  move?: { email: string; status: string; started_at: string } | null;
  /** When the settings above were last read from the registrar. */
  settings_at?: string | null;
}

export type HealthState = "up" | "down" | "ssl_error" | "parked" | "no_dns";

export interface DomainHealth {
  state: HealthState;
  /** Plain-words summary for the UI. */
  summary: string;
  http_status: number | null;
  final_url: string | null;
  ms: number | null;
  ssl: { valid: boolean; valid_to: string | null; issuer: string | null; error: string | null } | null;
  dns: { apex: string[]; www: string[] };
  /** Failed checks in a row (an outage alert needs two). */
  consecutive_failures: number;
  /** When the current state began. */
  since: string;
}

/** True when the registrar says the registration has lapsed. */
export function isExpired(row: Pick<ClientDomainRow, "registrar_status">): boolean {
  return row.registrar_status === "expired";
}

/** The registrar no longer lists the domain (moved, transferred out, deleted). */
export function isMissing(row: Pick<ClientDomainRow, "registrar_status">): boolean {
  return row.registrar_status === "missing";
}

export const HEALTH_LABELS: Record<HealthState, string> = {
  up: "Site up",
  down: "Site down",
  ssl_error: "SSL problem",
  parked: "Parked",
  no_dns: "No DNS",
};

/** Registrar pages for what their APIs can't do (renewing on Cloudflare, …). */
export function registrarDashboardUrl(row: Pick<ClientDomainRow, "registrar" | "domain">): string {
  return row.registrar === "cloudflare"
    ? "https://dash.cloudflare.com/?to=/:account/registrar/domains"
    : "https://hpanel.hostinger.com/domains";
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

/** Pure: which renewal reminder (if any) a domain is due, by days left. */
export function renewalBucket(expiresAt: string | null, now: Date): "30d" | "7d" | "1d" | null {
  if (!expiresAt) return null;
  const days = (Date.parse(expiresAt) - now.getTime()) / 86_400_000;
  if (Number.isNaN(days) || days < 0) return null;
  if (days <= 1) return "1d";
  if (days <= 7) return "7d";
  if (days <= 30) return "30d";
  return null;
}
