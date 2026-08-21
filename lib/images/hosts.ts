/**
 * Which remote image hosts may go through Next's image optimizer.
 *
 * WHY THIS EXISTS (measured 2026-08-18): the client photos operators pick
 * from are ImgBB originals — 832 KB, ~4 SECONDS each from our region, and
 * ImgBB has NO thumbnail variants (`.md`/`.th` suffixes return the identical
 * bytes — verified against a real lead photo). Painting a dozen of those into
 * small tiles meant downloading ~10 MB of full-resolution JPEG to show
 * postage stamps, which is exactly the "loads like a 1990s printer" the
 * picker suffered from. Routed through the optimizer instead, each tile
 * becomes a ~20-30 KB webp that our server fetches ONCE, resizes with sharp,
 * and caches on disk (and at the CDN edge) for a year.
 *
 * The list is an allowlist, not a filter: an unknown host still renders, just
 * unoptimized (see SmartImage), so a pasted link never breaks.
 *
 * Keep in sync with `images.remotePatterns` in next.config.ts — that file
 * imports OPTIMIZED_IMAGE_HOSTS directly, so adding a host here is enough.
 */
export const OPTIMIZED_IMAGE_HOSTS = [
  "i.ibb.co", // client photos (the dominant source)
  "lh3.googleusercontent.com", // photos captured from Google listings
  "images.pexels.com", // Pexels search results + picked stock
  "images.unsplash.com",
] as const;

/*
 * Deliberately NOT listed: `ibb.co` and `www.pexels.com`. Those serve HTML
 * viewer pages, not image bytes (the bytes live on i.ibb.co / images.pexels.com,
 * which is what every code path here actually produces). Allowlisting them
 * would widen the optimizer surface while only ever turning a stray page URL
 * into a failed optimize.
 */

/** True when the optimizer is configured for this URL's host. */
export function isOptimizableImageUrl(url: string | null | undefined): boolean {
  if (!url) return false;
  try {
    const host = new URL(url).hostname.toLowerCase();
    return (OPTIMIZED_IMAGE_HOSTS as readonly string[]).includes(host);
  } catch {
    return false; // relative or malformed — SmartImage renders it as-is
  }
}
