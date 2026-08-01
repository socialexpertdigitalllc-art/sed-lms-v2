/**
 * Subdomain naming scheme for deployed sites:
 *   {first 2 words of business name, slugified, max 20 chars}v{version}.dmviral.com
 * Rewrites/shuffles bump the version ({prev}v2, {prev}v3, ...).
 */

const MAX_BASE = 20;

export function baseSubdomain(businessName: string): string {
  const firstTwo = businessName.trim().split(/\s+/).slice(0, 2).join(" ");
  const slug = firstTwo
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  const cut = slug.slice(0, MAX_BASE).replace(/-+$/g, "");
  return cut || "site";
}

/** "joes-plumbingv2" -> { base: "joes-plumbing", version: 2 }; unversioned names are version 1. */
export function parseVersion(sub: string): { base: string; version: number } {
  const m = /^(.*[^\d])v(\d{1,4})$/.exec(sub);
  if (m && m[1]) return { base: m[1], version: parseInt(m[2], 10) };
  return { base: sub, version: 1 };
}

export function versionedSubdomain(base: string, version: number): string {
  return `${base}v${version}`;
}

export function nextVersionSubdomain(current: string): string {
  const { base, version } = parseVersion(current);
  return versionedSubdomain(base, version + 1);
}

/**
 * First versioned name not taken on the hosting. `skip` marks a name as taken
 * regardless (e.g. the current subdomain while shuffling, which must change).
 */
export async function firstFreeVersion(
  base: string,
  exists: (sub: string) => Promise<boolean>,
  opts: { skip?: string; start?: number } = {},
): Promise<string> {
  for (let v = opts.start ?? 1; v < (opts.start ?? 1) + 500; v++) {
    const candidate = versionedSubdomain(base, v);
    if (candidate === opts.skip) continue;
    if (!(await exists(candidate))) return candidate;
  }
  throw new Error(`No free subdomain version for base "${base}"`);
}
