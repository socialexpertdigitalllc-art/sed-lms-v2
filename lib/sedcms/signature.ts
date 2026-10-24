import { createHash, createHmac, timingSafeEqual } from "node:crypto";

/**
 * Proving that a call to /api/internal/sedcms/* really came from SED CMS.
 * SERVER ONLY.
 *
 * The CMS signs every request with SEDCMS_LMS_SECRET (32+ random bytes, the
 * same value in both apps' environments):
 *   x-sedcms-timestamp: Unix seconds
 *   x-sedcms-signature: hex HMAC-SHA256 over the method, the path with its
 *                       query, the timestamp and the hex SHA-256 of the body,
 *                       joined by line feeds.
 * Refused with 401: a missing or malformed header, a timestamp more than 300 s
 * away, a mismatch (compared in constant time), or a signature already seen
 * in the last 10 minutes. 503 while the secret is unset, shorter than 32
 * bytes, or has whitespace around it, so a misconfigured LMS never accepts
 * anything; the log says which, never the value.
 *
 * The test vectors are shared with the CMS's signing client through
 * tests/fixtures/sedcms/shared-vectors.json.
 */

export const SEDCMS_TIMESTAMP_HEADER = "x-sedcms-timestamp";
export const SEDCMS_SIGNATURE_HEADER = "x-sedcms-signature";
export const SEDCMS_WINDOW_SECONDS = 300;
export const SEDCMS_MIN_SECRET_BYTES = 32;
const REPLAY_TTL_MS = 10 * 60_000;
const REPLAY_MAX_ENTRIES = 10_000;

const LF = String.fromCharCode(10);
const TIMESTAMP = /^[0-9]{1,12}$/;
const SIGNATURE = /^[0-9a-f]{64}$/;

function sha256Hex(data: string | Uint8Array): string {
  return createHash("sha256").update(data).digest("hex");
}

/** hex HMAC-SHA256(secret, [method, pathAndQuery, timestamp, sha256hex(body)].join(LF)) */
export function sedcmsSignature(
  secret: string,
  method: string,
  pathAndQuery: string,
  timestamp: number,
  body: string | Uint8Array,
): string {
  return createHmac("sha256", secret)
    .update([method, pathAndQuery, String(timestamp), sha256Hex(body)].join(LF), "utf8")
    .digest("hex");
}

/**
 * Signatures already accepted, each kept for 10 minutes: a signature is only
 * valid while its timestamp is within 300 s of now, so 10 minutes from its
 * first use outlives it. Bounded: a full cache refuses rather than forgetting
 * a live entry early. In memory — the LMS runs one process.
 */
export class ReplayCache {
  private readonly entries = new Map<string, number>(); // signature -> expiry (ms), oldest first
  private readonly ttlMs: number;
  private readonly maxEntries: number;

  constructor(opts: { ttlMs?: number; maxEntries?: number } = {}) {
    this.ttlMs = opts.ttlMs ?? REPLAY_TTL_MS;
    this.maxEntries = opts.maxEntries ?? REPLAY_MAX_ENTRIES;
  }

  get size(): number {
    return this.entries.size;
  }

  /** "fresh": first use, now remembered; "seen": a replay; "full": no room. */
  record(signature: string, nowMs: number): "fresh" | "seen" | "full" {
    for (const [key, expiry] of this.entries) {
      if (expiry > nowMs) break;
      this.entries.delete(key);
    }
    const expiry = this.entries.get(signature);
    if (expiry !== undefined && expiry > nowMs) return "seen";
    if (expiry === undefined && this.entries.size >= this.maxEntries) return "full";
    this.entries.delete(signature);
    this.entries.set(signature, nowMs + this.ttlMs);
    return "fresh";
  }
}

// One cache per process, whichever route module asks (Next gives route
// modules separate module state, so it lives on globalThis).
const CACHE_KEY = Symbol.for("sedcms.replayCache");
function processReplayCache(): ReplayCache {
  const g = globalThis as unknown as Record<symbol, ReplayCache | undefined>;
  return (g[CACHE_KEY] ??= new ReplayCache());
}

export type SedcmsVerdict = { ok: true } | { ok: false; status: 401 | 503 };

export interface VerifyOptions {
  /** Milliseconds since the epoch. */
  now?: () => number;
  seen?: ReplayCache;
  /** Defaults to process.env.SEDCMS_LMS_SECRET, read at call time. */
  secret?: string;
}

/**
 * The secret, or why it can't be used. Whitespace around it is refused, never
 * trimmed: a value pasted with a stray space or line break would otherwise
 * sign differently on the two sides, or be quietly "fixed" on one of them.
 */
function readSecret(opts: VerifyOptions): { ok: true; secret: string } | { ok: false; reason: string } {
  const secret = opts.secret ?? process.env.SEDCMS_LMS_SECRET;
  if (typeof secret !== "string" || secret.length === 0) return { ok: false, reason: "SEDCMS_LMS_SECRET is not set" };
  if (secret.trim() !== secret) return { ok: false, reason: "SEDCMS_LMS_SECRET has leading or trailing whitespace" };
  if (Buffer.byteLength(secret, "utf8") < SEDCMS_MIN_SECRET_BYTES) {
    return { ok: false, reason: `SEDCMS_LMS_SECRET is shorter than ${SEDCMS_MIN_SECRET_BYTES} bytes` };
  }
  return { ok: true, secret };
}

/**
 * The checks that need no body: the secret is usable (else 503, logged by its
 * reason, never its value), both headers are well formed, and the timestamp is
 * inside the window. Routes run this before reading a body, so a request
 * without them is refused unread. It proves nothing, though: well-formed
 * headers are easy to make up, and the HMAC can only be checked once the body
 * is in. So each route reads at most its own cap first (lib/sedcms/http.ts:
 * 64 KiB, 160 KiB for tickets, 30 MiB for apply alone).
 */
export function precheckSedcms(req: Request, opts: VerifyOptions = {}): SedcmsVerdict {
  const secret = readSecret(opts);
  if (!secret.ok) {
    console.error(`[sedcms] refusing CMS requests: ${secret.reason}`);
    return { ok: false, status: 503 };
  }
  const timestamp = req.headers.get(SEDCMS_TIMESTAMP_HEADER);
  const signature = req.headers.get(SEDCMS_SIGNATURE_HEADER);
  if (!timestamp || !signature || !TIMESTAMP.test(timestamp) || !SIGNATURE.test(signature)) return { ok: false, status: 401 };
  const nowMs = (opts.now ?? Date.now)();
  if (Math.abs(nowMs / 1000 - Number(timestamp)) > SEDCMS_WINDOW_SECONDS) return { ok: false, status: 401 };
  return { ok: true };
}

/** The full check, over the raw body exactly as it arrived. */
export async function verifySedcms(req: Request, rawBody: string | Uint8Array, opts: VerifyOptions = {}): Promise<SedcmsVerdict> {
  const pre = precheckSedcms(req, opts);
  if (!pre.ok) return pre;
  const read = readSecret(opts);
  if (!read.ok) return { ok: false, status: 503 };
  const secret = read.secret;
  const timestamp = Number(req.headers.get(SEDCMS_TIMESTAMP_HEADER));
  const given = req.headers.get(SEDCMS_SIGNATURE_HEADER) as string;

  let url: URL;
  try {
    url = new URL(req.url);
  } catch {
    return { ok: false, status: 401 };
  }
  const expected = sedcmsSignature(secret, req.method, `${url.pathname}${url.search}`, timestamp, rawBody);
  // Equal-length digests, compared in constant time.
  const a = createHash("sha256").update(expected, "utf8").digest();
  const b = createHash("sha256").update(given, "utf8").digest();
  if (!timingSafeEqual(a, b)) return { ok: false, status: 401 };

  const seen = opts.seen ?? processReplayCache();
  const recorded = seen.record(given, (opts.now ?? Date.now)());
  if (recorded === "seen") return { ok: false, status: 401 };
  if (recorded === "full") return { ok: false, status: 503 };
  return { ok: true };
}
