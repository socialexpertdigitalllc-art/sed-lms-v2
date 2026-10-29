import type { NextConfig } from "next";
import { OPTIMIZED_IMAGE_HOSTS } from "./lib/images/hosts";

const nextConfig: NextConfig = {
  experimental: {
    // With a middleware/proxy present, Next buffers every request body and
    // TRUNCATES it at 10MB by default — a >10MB site-zip upload then reaches
    // the route handler as a cut-off multipart stream and formData() throws
    // ("Expected a multipart form upload"). The largest accepted upload is a
    // 60MB zip (site-studio manual upload); 64mb covers it plus multipart
    // framing overhead.
    proxyClientMaxBodySize: "64mb",
    // Client router cache for dynamic pages. Since Next 15 every <Link>
    // navigation re-fetched the page from the server (dynamic stale time 0),
    // so Dashboard → Leads → Dashboard rebuilt the whole dashboard from the
    // database each time: "on screen switch it loads all the data from 0".
    // With 30 s, bouncing between screens reuses the payload already in the
    // browser; a realtime event or a mutation calls router.refresh(), which
    // drops the cache, so changes still show at once. 180 s for static
    // segments is the documented default pairing.
    staleTimes: { dynamic: 30, static: 180 },
    // Build workers. Next defaults to one per CPU less one: 63 on Hostinger's
    // build host. Each worker loads Next's native binding, which starts its
    // own thread pool, and from Next 16.4 that crossed the host's thread
    // limit: the 2026-10-29 build aborted in "Collecting page data using 63
    // workers" with "OS can't spawn worker thread (os error 11)". 4 builds
    // the 190 routes in seconds all the same.
    cpus: 4,
  },
  images: {
    // Thumbnails for the image picker. See lib/images/hosts.ts for the
    // measurement that motivated this: client photos are ~832 KB ImgBB
    // originals with no thumbnail variants, so the optimizer is the ONLY
    // way to paint a grid of them quickly.
    remotePatterns: OPTIMIZED_IMAGE_HOSTS.map((hostname) => ({ protocol: "https" as const, hostname })),
    formats: ["image/webp"],
    // Next 16 requires every quality a component asks for to be declared;
    // SmartImage uses 70 (plenty for a thumbnail, meaningfully smaller).
    qualities: [70, 75],
    // Picker tiles + previews; keeping this list short limits how many
    // variants sharp has to produce per image on a shared box.
    imageSizes: [96, 160, 256, 384],
    deviceSizes: [640, 1080, 1920],
    // A picked photo never changes behind its URL, so cache hard: the second
    // time an operator opens a lead's photos it must be instant.
    minimumCacheTTL: 60 * 60 * 24 * 365,
  },
};

export default nextConfig;
