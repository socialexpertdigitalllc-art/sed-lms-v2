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
 *
 * When cleanup still leaves more than 63 chars, the BUSINESS-NAME portion is
 * truncated, never the trailing disambiguating suffix
 * (`${slugify(business_name)}-${randomBase36(6)}`, see `run/engine.ts`).
 * Blindly slicing from the left instead would cut the suffix down (or off
 * entirely) on a long name, and two long, similarly-prefixed business names
 * would then collapse onto the identical 63-char label — exactly the
 * collision the random suffix exists to prevent.
 */
function dnsSafe(raw: string): string {
  const cleaned = raw
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-+|-+$/g, "");
  if (cleaned.length <= MAX_SUBDOMAIN_LEN) return cleaned;

  const lastHyphen = cleaned.lastIndexOf("-");
  if (lastHyphen > 0) {
    const suffix = cleaned.slice(lastHyphen); // includes its own leading hyphen
    if (suffix.length < MAX_SUBDOMAIN_LEN) {
      const head = cleaned.slice(0, lastHyphen).slice(0, MAX_SUBDOMAIN_LEN - suffix.length).replace(/-+$/g, "");
      const combined = `${head}${suffix}`.replace(/^-+/, "");
      return combined.slice(0, MAX_SUBDOMAIN_LEN).replace(/-+$/g, "");
    }
  }
  return cleaned.slice(0, MAX_SUBDOMAIN_LEN).replace(/-+$/g, "");
}

/**
 * `website_link` is meant to be a full URL, but a hand-entered value or a
 * pre-v3 (v2 / manually-typed) record can be schemeless (`acme.da900.is.cc`)
 * or protocol-relative (`//acme.da900.is.cc`) — `new URL()` throws on both,
 * which would make `subFromWebsiteLink` return null and silently strand the
 * lead's real live site at its old URL while a brand-new subdomain gets
 * created. Normalising here (never inside the kept `directadmin.ts`) fixes
 * that without touching the sanctioned boundary.
 */
function normalizeLink(link: string | null | undefined): string | null {
  if (!link) return null;
  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(link)) return link; // already has an explicit scheme
  if (link.startsWith("//")) return `https:${link}`; // protocol-relative
  return `https://${link}`; // bare host
}

/**
 * The subdomain this lead is ALREADY live on, or null for a first deploy.
 *
 * Split out of `resolveSubdomain` so a caller can ask the cheap question
 * first: naming a first deploy now costs a round-trip to the hosting (to find
 * a free name), and a redeploy must not pay it — it keeps the name it has.
 */
export function reusableSubdomain(
  leadWebsiteLink: string | null | undefined,
  daDomain: string,
): string | null {
  return subFromWebsiteLink(normalizeLink(leadWebsiteLink), daDomain);
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
  const linkSub = reusableSubdomain(leadWebsiteLink, daDomain);
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
