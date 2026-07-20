import type { MetadataRoute } from "next";

/**
 * Web App Manifest for the standalone email verifier.
 *
 * `scope` is deliberately pinned to /verify so an installed window only ever
 * owns the mini-app — navigating anywhere else in the dashboard hands control
 * back to the normal browser tab, and the service worker's scope stays just as
 * narrow.
 *
 * Static values only, so this stays a cached route with no request-time work.
 */
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "SED Email Verifier",
    short_name: "Verify",
    description: "Check whether an email address will actually deliver — syntax, typo, DNS and mailbox checks.",
    start_url: "/verify",
    scope: "/verify",
    display: "standalone",
    orientation: "portrait",
    // Brand palette: --color-bg and --color-accent from app/globals.css.
    background_color: "#eef1f5",
    theme_color: "#0d9488",
    icons: [
      { src: "/icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
      { src: "/icon-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
  };
}
