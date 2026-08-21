import type { NextConfig } from "next";
import { OPTIMIZED_IMAGE_HOSTS } from "./lib/images/hosts";

const nextConfig: NextConfig = {
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
