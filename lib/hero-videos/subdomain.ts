/**
 * The staging subdomain that hosts the shared hero videos
 * (lib/hero-videos/mediaHost.ts). Kept in its own dependency-free module so the
 * subdomain naming code can reserve it without importing the DirectAdmin client.
 */
export const HERO_MEDIA_SUBDOMAIN = (process.env.HERO_MEDIA_SUBDOMAIN || "sed-media").trim().toLowerCase();
