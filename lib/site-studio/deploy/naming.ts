/**
 * Subdomain naming scheme for deployed sites:
 *   {full business name, slugified}.dmviral.com
 *
 * The name is the WHOLE business name and nothing else — "A M Handyman"
 * deploys to `a-m-handyman.dmviral.com`. This is a deliverability decision,
 * not a cosmetic one: the link is sent to the client, and a subdomain carrying
 * a random tail (`a-m-handyman-x7k2p9`) or a truncated stub (`a-mv1`) reads as
 * a phishing link, so clients hesitate to open the site we just built them.
 *
 * A suffix is therefore only ever added when the clean name is genuinely
 * TAKEN — two different businesses really can share a name — and then it is a
 * plain counter (`-2`, `-3`), which reads as a second location rather than as
 * machine noise.
 */

/** DNS labels are capped at 63 octets; the counter suffix has to fit inside it. */
const MAX_LABEL = 63;

/** Slugified full business name, DNS-safe. "" only if nothing survives. */
export function baseSubdomain(businessName: string): string {
  const slug = businessName
    .trim()
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  const cut = slug.slice(0, MAX_LABEL).replace(/-+$/g, "");
  return cut || "site";
}

/**
 * "joes-plumbing-2" -> { base: "joes-plumbing", version: 2 }.
 *
 * Also parses the LEGACY `vN` form ("joes-plumbingv2"), because sites deployed
 * under the old scheme are still live and still have to version forward
 * without their base name mutating underneath them.
 */
export function parseVersion(sub: string): { base: string; version: number } {
  const dashed = /^(.*[^-])-(\d{1,4})$/.exec(sub);
  if (dashed && dashed[1]) return { base: dashed[1], version: parseInt(dashed[2], 10) };
  const legacy = /^(.*[^\d])v(\d{1,4})$/.exec(sub);
  if (legacy && legacy[1]) return { base: legacy[1], version: parseInt(legacy[2], 10) };
  return { base: sub, version: 1 };
}

/** Version 1 is the bare name — the whole point of the scheme. */
export function versionedSubdomain(base: string, version: number): string {
  if (version <= 1) return base.slice(0, MAX_LABEL).replace(/-+$/g, "");
  const suffix = `-${version}`;
  const head = base.slice(0, MAX_LABEL - suffix.length).replace(/-+$/g, "");
  return `${head}${suffix}`;
}

export function nextVersionSubdomain(current: string): string {
  const { base, version } = parseVersion(current);
  return versionedSubdomain(base, version + 1);
}

/**
 * First name not taken on the hosting: the clean one if it is free, then
 * `-2`, `-3`, … `skip` marks a name as taken regardless (e.g. the current
 * subdomain while shuffling, which must change).
 */
export async function firstFreeVersion(
  base: string,
  exists: (sub: string) => Promise<boolean>,
  opts: { skip?: string; start?: number } = {},
): Promise<string> {
  const start = opts.start ?? 1;
  for (let v = start; v < start + 500; v++) {
    const candidate = versionedSubdomain(base, v);
    if (candidate === opts.skip) continue;
    if (!(await exists(candidate))) return candidate;
  }
  throw new Error(`No free subdomain for base "${base}"`);
}
