import {
  createSubdomain,
  daConfigured,
  docrootFor,
  listDaFolder,
  makeDaFolder,
  subdomainExists,
  uploadDaFile,
} from "@/lib/template-engine/directadmin";

/**
 * The shared media host: ONE copy of every library video, on a subdomain of
 * the DirectAdmin server the staging sites already live on
 * (https://sed-media.<DA_DOMAIN>/hero-videos/<file>.mp4). Every site built with
 * a video-hero template embeds its video from here by URL — no site carries a
 * copy of its own, and Supabase/Hostinger storage never holds a video.
 *
 * Why not straight from Google Drive: Drive answers every cross-site browser
 * request (`Sec-Fetch-Site: cross-site`) with 403 — a deliberate hotlink
 * block, verified 2026-11-05 — so Drive is the library, not the player.
 *
 * The subdomain's .htaccess sends `Access-Control-Allow-Origin: *`: the SD Home
 * engine draws the hero video in WebGL, which a browser only allows for a
 * cross-site video fetched with CORS (see lib/hero-videos/inject.ts).
 */

import { HERO_MEDIA_SUBDOMAIN } from "./subdomain";

/** Reserved in lib/site-studio/deploy/naming.ts so no client site is ever deployed onto it. */
export { HERO_MEDIA_SUBDOMAIN };
const VIDEO_DIR = "hero-videos";
const UPLOAD_TIMEOUT_MS = 240_000;

const HTACCESS = `# SED LMS hero video host (lib/hero-videos/mediaHost.ts) — managed by the app.
# One shared copy of each library video; every website embeds it from here.
Options -Indexes
AddType video/mp4 .mp4
<IfModule mod_headers.c>
  Header always set Access-Control-Allow-Origin "*"
  Header always set Cross-Origin-Resource-Policy "cross-origin"
  <FilesMatch "\\.mp4$">
    Header set Cache-Control "public, max-age=86400"
  </FilesMatch>
</IfModule>
`;

const INDEX_HTML = `<!doctype html><meta charset="utf-8"><title>Media</title><p>Media host.</p>`;

export function mediaHostConfigured(): boolean {
  return daConfigured();
}

function domain(): string {
  return process.env.DA_DOMAIN ?? "";
}

export function mediaUrlFor(fileName: string): string {
  return `https://${HERO_MEDIA_SUBDOMAIN}.${domain()}/${VIDEO_DIR}/${encodeURIComponent(fileName)}`;
}

let ensured = false;

/**
 * Make sure the subdomain, its video folder and its .htaccess exist. Cheap
 * after the first success in a process. Throws a message an operator can act on.
 */
export async function ensureMediaHost(): Promise<void> {
  if (ensured) return;
  if (!daConfigured()) {
    throw new Error("The media host is not configured: DirectAdmin (DA_HOST, DA_USERNAME, DA_LOGIN_KEY, DA_DOMAIN) is missing on the server.");
  }
  if (!(await subdomainExists(HERO_MEDIA_SUBDOMAIN))) {
    const created = await createSubdomain(HERO_MEDIA_SUBDOMAIN);
    if (created.error && !(await subdomainExists(HERO_MEDIA_SUBDOMAIN))) {
      throw new Error(`Could not create the media subdomain ${HERO_MEDIA_SUBDOMAIN}.${domain()}: ${created.text || created.details || "DirectAdmin refused"}`);
    }
  }
  const root = docrootFor(HERO_MEDIA_SUBDOMAIN);
  const listing = await listDaFolder(root);
  if (!listing?.some((e) => e.name === VIDEO_DIR && e.kind === "dir")) {
    const made = await makeDaFolder(`${root}/${VIDEO_DIR}`);
    if (!made.ok) {
      const again = await listDaFolder(root);
      if (!again?.some((e) => e.name === VIDEO_DIR)) throw new Error(`Could not create the video folder on the media host: ${made.message}`);
    }
  }
  const ht = await uploadDaFile(root, ".htaccess", new TextEncoder().encode(HTACCESS), "text/plain");
  if (!ht.ok) throw new Error(`Could not write the media host's settings (.htaccess): ${ht.message}`);
  if (!listing?.some((e) => e.name === "index.html")) {
    await uploadDaFile(root, "index.html", new TextEncoder().encode(INDEX_HTML), "text/html");
  }
  ensured = true;
}

/** Put one video on the media host (replacing a same-named one); returns its public URL. */
export async function uploadHeroVideo(fileName: string, bytes: Uint8Array): Promise<string> {
  await ensureMediaHost();
  const dir = `${docrootFor(HERO_MEDIA_SUBDOMAIN)}/${VIDEO_DIR}`;
  const r = await uploadDaFile(dir, fileName, bytes, "video/mp4", { timeoutMs: UPLOAD_TIMEOUT_MS });
  if (!r.ok) throw new Error(`Upload to the media host failed: ${r.message}`);
  return mediaUrlFor(fileName);
}

/**
 * Fetch the first bytes the way a website's <video crossorigin> will: a range
 * request with an Origin. Null when it plays; otherwise what is wrong. A
 * missing CORS header is reported, not fatal — the video still plays, the
 * template just runs without WebGL.
 */
export async function checkHeroVideoUrl(url: string): Promise<{ error: string | null; warning: string | null }> {
  try {
    const res = await fetch(url, {
      headers: { Range: "bytes=0-1023", Origin: "https://example.com" },
      signal: AbortSignal.timeout(20_000),
    });
    if (res.status !== 206 && res.status !== 200) return { error: `The media host answered ${res.status} for the video.`, warning: null };
    const type = res.headers.get("content-type") ?? "";
    if (!type.startsWith("video/")) return { error: `The media host served the video as "${type || "unknown"}", not as a video.`, warning: null };
    const cors = res.headers.get("access-control-allow-origin");
    await res.body?.cancel().catch(() => {});
    return { error: null, warning: cors ? null : "The media host sent no CORS header; sites will play the video without their WebGL effects." };
  } catch (e) {
    return { error: `The media host could not be reached: ${e instanceof Error ? e.message : String(e)}`, warning: null };
  }
}
