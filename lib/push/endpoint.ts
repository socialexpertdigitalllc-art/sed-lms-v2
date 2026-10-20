// lib/push/endpoint.ts
/**
 * Which push-service URLs the server will POST to. A subscription's endpoint
 * comes from the browser — i.e. from the client — so without this check a
 * signed-in user could register any https URL and have the LMS server send
 * requests to it (internal addresses included). Only the browser vendors'
 * push services are accepted.
 */
const ALLOWED_SUFFIXES = [
  ".googleapis.com", // Chrome, Edge (Chromium), Android: fcm.googleapis.com
  ".mozilla.com", // Firefox: updates.push.services.mozilla.com
  ".notify.windows.com", // legacy Edge / Windows (WNS)
  ".push.apple.com", // Safari (macOS, iOS home-screen apps): web.push.apple.com
];

export function isAllowedPushEndpoint(endpoint: unknown): endpoint is string {
  if (typeof endpoint !== "string" || endpoint.length > 2048) return false;
  let url: URL;
  try {
    url = new URL(endpoint);
  } catch {
    return false;
  }
  if (url.protocol !== "https:" || url.port || url.username || url.password) return false;
  const host = url.hostname.toLowerCase();
  return ALLOWED_SUFFIXES.some((s) => host.endsWith(s) && host.length > s.length);
}

/** A subscription key as browsers send it: base64url, sane length. */
export function isPushKey(v: unknown, min: number, max: number): v is string {
  return typeof v === "string" && v.length >= min && v.length <= max && /^[A-Za-z0-9_-]+={0,2}$/.test(v);
}

/** The public origin of a request behind the host's proxy. */
export function requestOrigin(req: Request): string {
  const h = req.headers;
  const host = h.get("x-forwarded-host") ?? h.get("host");
  const proto = (h.get("x-forwarded-proto") ?? "").split(",")[0].trim() || new URL(req.url).protocol.replace(":", "");
  return host ? `${proto}://${host}` : new URL(req.url).origin;
}
