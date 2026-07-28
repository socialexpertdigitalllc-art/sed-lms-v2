import type { HostProvider, ImageHost } from "./types";

/**
 * The fallback order is a product decision, not a config value: imgbb first
 * (it uploads by URL, so we transfer no bytes), then postimages, then imgchest.
 */
export const PROVIDER_RANK: Record<HostProvider, number> = {
  imgbb: 0,
  postimages: 1,
  imgchest: 2,
};

/**
 * Usable hosts, in the order the chain must try them. Pure, so the rule is
 * testable without a database.
 */
export function orderHosts(hosts: ImageHost[], now: Date): ImageHost[] {
  return hosts
    .filter((h) => h.enabled)
    .filter((h) => !h.exhaustedUntil || h.exhaustedUntil.getTime() <= now.getTime())
    .slice()
    .sort(
      (a, b) =>
        PROVIDER_RANK[a.provider] - PROVIDER_RANK[b.provider] ||
        a.position - b.position ||
        a.id.localeCompare(b.id)
    );
}
