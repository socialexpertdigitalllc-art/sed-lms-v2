import { subFromWebsiteLink } from "@/lib/template-engine/directadmin";

/** DNS labels are capped at 63 octets. */
const MAX_SUBDOMAIN_LEN = 63;

/**
 * Thrown when neither the lead's `website_link` nor its `site_slug` yields a
 * usable subdomain. This must never be swallowed into an empty string — an
 * empty `sub` would deploy the site to `https://.{daDomain}/`, which
 * DirectAdmin (and every caller downstream) would happily treat as the
 * DOMAIN ROOT. Refusing loudly here is the only safe behaviour.
 */
export class InvalidSlugError extends Error {}

export interface ResolveSubdomainInput {
  /** The lead's current `website_link`, if any. */
  leadWebsiteLink?: string | null;
  /** The run's own generated slug (`studio_runs.site_slug`), used only when
   *  there is no existing subdomain to redeploy onto. */
  siteSlug?: string | null;
  /** `process.env.DA_DOMAIN` — passed explicitly so this stays pure. */
  daDomain: string;
}

export interface ResolvedSubdomain {
  sub: string;
  /** true when `sub` came from the lead's OWN existing website_link — this is
   *  the one-live-site-per-lead in-place redeploy path (see deployRun.ts,
   *  which must `clearDocroot` before uploading whenever this is true). */
  reused: boolean;
}

/**
 * Lowercase, alphanumeric-and-hyphen only, no leading/trailing hyphen, and
 * capped at the DNS label limit. Collapses any run of disallowed characters
 * (or of hyphens the collapsing itself produces) into a single hyphen.
 * Returns "" when the input has nothing DNS-safe left in it — callers must
 * treat that as a refusal, not a fallback.
 */
function dnsSafe(raw: string): string {
  return raw
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, MAX_SUBDOMAIN_LEN)
    .replace(/-+$/g, ""); // truncation can expose a trailing hyphen; strip it again
}

/**
 * One live site per lead (spec's hard rule, Phase 4a Task 8): a lead whose
 * `website_link` already resolves — via the kept `subFromWebsiteLink` — to a
 * subdomain of `daDomain` redeploys onto THAT EXACT subdomain, in place. A
 * link pointing anywhere else (the client's own domain, a foreign host) is
 * ignored entirely, and the run's own `siteSlug` is used instead for what is
 * then a first deploy for this lead.
 */
export function resolveSubdomain({ leadWebsiteLink, siteSlug, daDomain }: ResolveSubdomainInput): ResolvedSubdomain {
  const linkSub = subFromWebsiteLink(leadWebsiteLink ?? null, daDomain);
  if (linkSub) {
    return { sub: linkSub, reused: true };
  }

  const safe = dnsSafe(String(siteSlug ?? ""));
  if (!safe) {
    throw new InvalidSlugError(
      `Cannot deploy: this lead has no existing site to redeploy onto, and its slug "${siteSlug ?? ""}" ` +
        `produces no usable subdomain. Refusing rather than deploying to the domain root.`,
    );
  }
  return { sub: safe, reused: false };
}
