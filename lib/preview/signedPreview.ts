// lib/preview/signedPreview.ts
/**
 * Signed preview paths: how the sandboxed site previews load their own CSS and JS.
 *
 * The previews (AI developer review, Site Builder runs and templates) send CSP
 * `sandbox allow-scripts` WITHOUT `allow-same-origin`, so a previewed site's
 * scripts run under an opaque origin and can't reach the LMS. The catch: to
 * the browser, every request such a page makes (style.css, components.js, a
 * click to about.html) is cross-site, and the LMS login cookie is
 * SameSite=Lax, so it is never sent. Every asset request then failed the
 * route's session check with a 401 and the page showed bare HTML: no
 * styles, and no header or footer (those render from components.js).
 * Reproduced in Chromium 141 on 2026-10-14: the asset requests went out as
 * `Sec-Fetch-Site: cross-site` with no cookie, in the iframe and in a new tab.
 *
 * The fix keeps the sandbox and stops relying on the cookie for anything after
 * the first load. A page request that does carry the session (the iframe's own
 * load, "Open in a new tab") is redirected to the same file under a signed path
 * segment, `…/preview/~<token>/index.html`. The page's relative references
 * inherit that segment, so its asset requests authenticate with the token.
 *
 * A token is a read-only capability for ONE preview (its scope, e.g. a run id)
 * and expires within PREVIEW_TOKEN_WINDOW_MS × 2. Every mint inside one window
 * returns the same token, so a preview's URL stays stable while someone is
 * looking at it (no iframe reloads, browser cache keeps working).
 */
import { createHmac, timingSafeEqual } from "node:crypto";

/** Tokens rotate per window and stay valid for between one and two windows. */
export const PREVIEW_TOKEN_WINDOW_MS = 6 * 60 * 60_000;

/** The path segment marker: `~` is URL-safe, never percent-encoded, and no real
 *  site file or folder name starts with it. */
const MARK = "~";

/** Signature length in base64url characters (192 bits). */
const SIG_CHARS = 32;

function signingKey(): Buffer | null {
  const secret = process.env.PREVIEW_TOKEN_SECRET || process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!secret) return null;
  // Derived, never the raw secret, so a token can't be used to probe it.
  return createHmac("sha256", secret).update("sed-lms:preview-token:v1").digest();
}

function sign(key: Buffer, scope: string, exp: string): string {
  return createHmac("sha256", key).update(`${scope}|${exp}`).digest("base64url").slice(0, SIG_CHARS);
}

/** A token for `scope`, or null when the server has no secret to sign with
 *  (the routes then keep serving through the session, as before). */
export function mintPreviewToken(scope: string, now: number = Date.now()): string | null {
  const key = signingKey();
  if (!key) return null;
  const exp = ((Math.floor(now / PREVIEW_TOKEN_WINDOW_MS) + 2) * PREVIEW_TOKEN_WINDOW_MS).toString(36);
  return `${exp}.${sign(key, scope, exp)}`;
}

export function verifyPreviewToken(scope: string, token: string, now: number = Date.now()): boolean {
  const key = signingKey();
  if (!key) return false;
  const m = /^([0-9a-z]{1,12})\.([A-Za-z0-9_-]+)$/.exec(token);
  if (!m) return false;
  const exp = parseInt(m[1], 36);
  // Expired, or dated further out than any token this server mints.
  if (!Number.isFinite(exp) || exp <= now || exp > now + 2 * PREVIEW_TOKEN_WINDOW_MS) return false;
  const expected = Buffer.from(sign(key, scope, m[1]));
  const given = Buffer.from(m[2]);
  return given.length === expected.length && timingSafeEqual(given, expected);
}

/** Splits a leading `~<token>` segment off a preview route's path segments. */
export function splitPreviewToken(segments: string[]): { token: string | null; rest: string[] } {
  const [first, ...rest] = segments;
  if (first?.startsWith(MARK)) return { token: first.slice(MARK.length), rest };
  return { token: null, rest: segments };
}

/** `root` is the route's preview directory with a trailing slash. */
export function signedPreviewRoot(root: string, token: string): string {
  return `${root}${MARK}${token}/`;
}

/** A redirect with a RELATIVE Location: behind the hosting proxy `req.url` can
 *  carry the internal host, and a browser resolves a relative Location against
 *  the address it actually requested. Never cached, as the token rotates. */
export function previewRedirect(location: string): Response {
  return new Response(null, { status: 302, headers: { Location: location, "Cache-Control": "no-store" } });
}

const escapeAttr = (s: string) =>
  s.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

/**
 * What a preview route does with a request for an HTML page.
 *
 *  - Signed in, no valid token → redirect to the page's signed address.
 *  - Valid token, bare entry address → redirect to the entry file itself, so
 *    the page's address and its `<base>` agree.
 *  - Valid token, a page → serve it. `base` is the page's own address, so
 *    relative links resolve exactly as on the live site, and a `#section` link
 *    scrolls the page instead of reloading the entry page. `assetRoot` is the
 *    signed directory, for root-absolute references (`/style.css`).
 *  - No secret to sign with → serve through the session, as before signing.
 *
 * `encodedTarget` is the served file's path, already URL-encoded per segment.
 */
export function planPreviewPage(args: {
  root: string;
  scope: string;
  /** A token that already passed verifyPreviewToken, or null. */
  token: string | null;
  requested: string;
  encodedTarget: string;
  /** The request's query string ("" or "?v=…"), kept across the redirect. */
  search: string;
}): { redirect: string } | { base: string; assetRoot: string } {
  const token = args.token ?? mintPreviewToken(args.scope);
  if (!token) return { base: escapeAttr(args.root), assetRoot: args.root };
  const signedRoot = signedPreviewRoot(args.root, token);
  if (!args.token || !args.requested) return { redirect: `${signedRoot}${args.encodedTarget}${args.search}` };
  return { base: escapeAttr(`${signedRoot}${args.encodedTarget}${args.search}`), assetRoot: signedRoot };
}
