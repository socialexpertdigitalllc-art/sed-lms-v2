/**
 * The LMS calling SED CMS: "Open in CMS". SERVER ONLY.
 *
 * Everything the LMS assumes about the CMS's side of it lives in this file,
 * so the CMS can match it (launch plan L7 and M4.1; 0.3's lms-sso plugin):
 *
 *   SEDCMS_URL      the Studio's origin: https (http only for localhost or
 *                   127.0.0.1 outside production), no path, query, fragment
 *                   or credentials; a trailing slash is allowed.
 *   SEDCMS_API_KEY  the key the owner's "Connect the LMS" shows once
 *                   (permission sso: ["mint"]), sent as x-api-key.
 *   Neither may have whitespace around it: refused, never trimmed.
 *
 *   POST {SEDCMS_URL}/api/auth/lms-sso/mint
 *     headers  x-api-key, Content-Type: application/json
 *     body     { lmsUserId: <the developer's LMS user id>, leadId: <uuid> }
 *     10 s for the whole exchange; redirects are never followed; the answer
 *     is read up to 64 KiB.
 *   200 { url, expiresAt }: url must be a string of at most 2048 characters
 *     that starts with SEDCMS_URL's origin and a slash, parses, and has that
 *     same origin and no credentials. Anything else is "unavailable".
 *   Errors are { code, message }:
 *     404 UNKNOWN_DEVELOPER   the developer's LMS id is linked to no staff account
 *     429 (any code)          the key's mint limit
 *     anything else           unavailable
 *
 * The link is a one-time sign-in: it is handed to the developer's browser and
 * never logged.
 */

export const CMS_MINT_PATH = "/api/auth/lms-sso/mint";
export const CMS_MINT_TIMEOUT_MS = 10_000;
const MAX_ANSWER_BYTES = 64 * 1024;
const MAX_LINK_CHARS = 2048;
const MAX_KEY_CHARS = 512;

export type CmsConfig = { ok: true; origin: string; apiKey: string } | { ok: false; reason: string };

type Env = Record<string, string | undefined>;

export function cmsConfig(env: Env = process.env): CmsConfig {
  const raw = env.SEDCMS_URL;
  const apiKey = env.SEDCMS_API_KEY;
  if (!raw) return { ok: false, reason: "SEDCMS_URL is not set" };
  if (raw.trim() !== raw) return { ok: false, reason: "SEDCMS_URL has leading or trailing whitespace" };
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return { ok: false, reason: "SEDCMS_URL is not a URL" };
  }
  if (url.username || url.password || url.search || url.hash || url.pathname !== "/" || (raw !== url.origin && raw !== `${url.origin}/`)) {
    return { ok: false, reason: "SEDCMS_URL must be an origin only (no path, query or credentials)" };
  }
  const local = url.hostname === "localhost" || url.hostname === "127.0.0.1";
  if (url.protocol !== "https:" && !(url.protocol === "http:" && local && env.NODE_ENV !== "production")) {
    return { ok: false, reason: "SEDCMS_URL must be https" };
  }
  if (!apiKey) return { ok: false, reason: "SEDCMS_API_KEY is not set" };
  if (apiKey.trim() !== apiKey) return { ok: false, reason: "SEDCMS_API_KEY has leading or trailing whitespace" };
  if (apiKey.length > MAX_KEY_CHARS) return { ok: false, reason: "SEDCMS_API_KEY is too long" };
  return { ok: true, origin: url.origin, apiKey };
}

/** A link the browser may be sent to: on the CMS's own origin, nowhere else. */
export function onCmsOrigin(link: unknown, origin: string): link is string {
  if (typeof link !== "string" || link.length > MAX_LINK_CHARS || !link.startsWith(`${origin}/`)) return false;
  try {
    const url = new URL(link);
    return url.origin === origin && !url.username && !url.password;
  } catch {
    return false;
  }
}

export type MintResult =
  | { ok: true; url: string }
  | { ok: false; kind: "unknown_developer" | "rate_limited" | "unavailable"; detail: string };

/** Ask the CMS for a one-time sign-in link for this developer, about this lead. */
export async function mintCmsLink(
  cfg: { origin: string; apiKey: string },
  body: { lmsUserId: string; leadId: string },
  opts: { timeoutMs?: number } = {},
): Promise<MintResult> {
  const timeoutMs = opts.timeoutMs ?? CMS_MINT_TIMEOUT_MS;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  let status: number;
  let text: string;
  try {
    const res = await fetch(`${cfg.origin}${CMS_MINT_PATH}`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json", "x-api-key": cfg.apiKey },
      body: JSON.stringify({ lmsUserId: body.lmsUserId, leadId: body.leadId }),
      redirect: "error",
      cache: "no-store",
      signal: controller.signal,
    });
    status = res.status;
    const read = await readCapped(res, MAX_ANSWER_BYTES);
    if (read === null) return { ok: false, kind: "unavailable", detail: `HTTP ${status}, an answer over ${MAX_ANSWER_BYTES} bytes` };
    text = read;
  } catch {
    return { ok: false, kind: "unavailable", detail: controller.signal.aborted ? `no answer within ${timeoutMs / 1000}s` : "no answer (network error or a redirect)" };
  } finally {
    clearTimeout(timer);
  }

  if (status === 429) return { ok: false, kind: "rate_limited", detail: "HTTP 429" };
  let json: { url?: unknown; code?: unknown } | null = null;
  try {
    json = JSON.parse(text) as { url?: unknown; code?: unknown };
  } catch {
    json = null;
  }
  const code = typeof json?.code === "string" ? json.code.slice(0, 64) : null;
  if (status === 404 && code === "UNKNOWN_DEVELOPER") return { ok: false, kind: "unknown_developer", detail: "UNKNOWN_DEVELOPER" };
  if (status !== 200 || !json) return { ok: false, kind: "unavailable", detail: `HTTP ${status}${code ? ` ${code}` : ""}` };
  if (!onCmsOrigin(json.url, cfg.origin)) return { ok: false, kind: "unavailable", detail: "the CMS answered a link that isn't on its own address" };
  return { ok: true, url: json.url };
}

async function readCapped(res: Response, max: number): Promise<string | null> {
  if (!res.body) return "";
  const reader = res.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.length;
    if (total > max) {
      await reader.cancel().catch(() => {});
      return null;
    }
    chunks.push(value);
  }
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const c of chunks) {
    bytes.set(c, offset);
    offset += c.length;
  }
  return new TextDecoder().decode(bytes);
}
