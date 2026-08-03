/**
 * Domains the deployment board must never destroy: company infrastructure,
 * not client sites. Configured via PROTECTED_DOMAINS (comma-separated) in the
 * environment; the staging apex (DA_DOMAIN) is always protected. Matching is
 * exact-or-subdomain, case-insensitive.
 */

export function protectedDomains(): string[] {
  const raw = process.env.PROTECTED_DOMAINS ?? "";
  const list = raw
    .split(",")
    .map((d) => d.trim().toLowerCase())
    .filter(Boolean);
  const apex = (process.env.DA_DOMAIN ?? "").toLowerCase();
  if (apex && !list.includes(apex)) list.push(apex);
  return list;
}

export function isProtectedDomain(hostname: string | null | undefined): boolean {
  if (!hostname) return false;
  const h = hostname.toLowerCase().trim();
  return protectedDomains().some((d) => h === d || h.endsWith(`.${d}`));
}
