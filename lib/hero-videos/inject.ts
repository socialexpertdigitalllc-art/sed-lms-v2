/**
 * Point a built site's home hero at its library video. Pure; unit tested
 * (tests/heroVideos.test.ts).
 *
 * A video-hero template (builder_templates.hero_video) carries ONE hero video
 * slot, in either of two shapes:
 *
 *  1. The SD Home engine: a script that declares
 *       var HERO = { poster: "...", loop: "<url>" };
 *     and writes `<video class="hero__video" src="' + HERO.loop + '" ...>` into
 *     the page at runtime. The `loop` value is replaced. It lives in a script,
 *     not a page, on purpose: the AI rewrites pages, never this file, so the
 *     slot can't be dropped or changed by a page rewrite.
 *  2. Any template: a `<video data-hero-video ...>` element in a page — its
 *     `src` and any `<source src>` inside it are replaced.
 *
 * Either way the video element gains `crossorigin="anonymous"`. The video is
 * served from another site (the shared media host), and a WebGL engine may
 * only draw a cross-site video that was fetched in CORS mode — without it the
 * SD Home engine logs "[gl] off" and drops ALL of its effects for the page
 * (verified in Chromium, 2026-11-05). The media host answers with
 * `Access-Control-Allow-Origin: *`, so a CORS fetch always succeeds there.
 */

export interface InjectResult {
  files: Record<string, Uint8Array>;
  /** How many hero slots were pointed at the video. 0 = the template has no slot. */
  replaced: number;
}

const TEXT_FILE = /\.(m?js|html?)$/i;

/** var|let|const HERO = { ... loop: "<url>" ... } — group 1 is everything up to the opening quote. */
const ENGINE_SLOT = /(\b(?:var|let|const)\s+HERO\s*=\s*\{[^{}]*?\bloop\s*:\s*)(["'])(?:(?!\2)[^\\\n]|\\.)*\2/g;
/** A hero video tag written from a script string, still without crossorigin. */
const ENGINE_VIDEO_TAG = /<video\b(?![^>]*\bcrossorigin\b)(?=[^>]*\bhero__video\b)/g;
/** A whole `<video data-hero-video>` element in a page. */
const PAGE_SLOT = /<video\b[^>]*\bdata-hero-video\b[^>]*>[\s\S]*?<\/video>/gi;

const attr = (s: string) => s.replace(/&/g, "&amp;").replace(/"/g, "&quot;");

export function injectHeroVideoText(text: string, url: string): { text: string; replaced: number } {
  let replaced = 0;
  let out = text.replace(ENGINE_SLOT, (_m, head: string) => {
    replaced++;
    return `${head}${JSON.stringify(url)}`;
  });
  if (replaced > 0) {
    out = out.replace(ENGINE_VIDEO_TAG, '<video crossorigin="anonymous"');
  }
  out = out.replace(PAGE_SLOT, (el: string) => {
    replaced++;
    const open = el.match(/^<video\b[^>]*>/i)?.[0] ?? "<video>";
    const rest = el.slice(open.length);
    const cleaned = open
      .replace(/\s+src\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/gi, "")
      .replace(/\s+crossorigin(\s*=\s*("[^"]*"|'[^']*'|[^\s>]+))?/gi, "")
      .replace(/\s*\/?>$/, "");
    const newOpen = `${cleaned} src="${attr(url)}" crossorigin="anonymous">`;
    const newRest = rest.replace(
      /(<source\b[^>]*?\bsrc\s*=\s*)("[^"]*"|'[^']*'|[^\s>]+)/gi,
      (_s, pre: string) => `${pre}"${attr(url)}"`,
    );
    return newOpen + newRest;
  });
  return { text: out, replaced };
}

export function injectHeroVideo(files: Record<string, Uint8Array>, url: string): InjectResult {
  const dec = new TextDecoder();
  const enc = new TextEncoder();
  const out: Record<string, Uint8Array> = { ...files };
  let replaced = 0;
  for (const [name, bytes] of Object.entries(files)) {
    if (!TEXT_FILE.test(name)) continue;
    const text = dec.decode(bytes);
    if (!text.includes("HERO") && !text.includes("data-hero-video")) continue;
    const r = injectHeroVideoText(text, url);
    if (r.replaced > 0) {
      out[name] = enc.encode(r.text);
      replaced += r.replaced;
    }
  }
  return { files: out, replaced };
}
