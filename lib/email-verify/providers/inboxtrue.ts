import type { ProviderClassification, ProviderDetail } from "../types";
import type { ProviderAdapter, ProviderCredentials } from "./types";

/**
 * InboxTrue adapter — key-based single verification.
 *
 * Implemented against the vendor's API reference (https://inboxtrue.com/docs):
 *
 *   GET https://api.inboxtrue.com/v1/email/validate?email=<e>&timeout=<seconds>
 *   Authorization: Bearer <API key>
 *
 * `timeout` is optional, an integer 1–90, default 60. We ask for a SHORT one so
 * a slow SMTP probe on their side can never stall a lead form — the chain has
 * its own bounded abort on top.
 *
 * Documented success body (HTTP 200):
 *
 *   { "email": "user@example.com",
 *     "normalized": "user@example.com",      // string | null (null if malformed)
 *     "validity": "valid",
 *     "validated_at": "2025-06-15T14:32:01",
 *     "is_disposable": false,
 *     "is_consumer": false,
 *     "is_domain_catchall": false,           // boolean | null (null = unknown)
 *     "mx_records": ["mx1.example.com"] }
 *
 *   validity ∈ valid | ambiguous | maybe_valid | invalid | malformed |
 *              temp_error | perm_error
 *
 * Documented failures: 400 bad request, 401 unauthorized, 402 missing credits,
 * 404 not found, 429 too many requests, 500 internal error. The error body is
 * `{"msg": "…"}`.
 *
 * Rate-limit headers (X-RateLimit-Limit/Remaining/Reset/Bucket, plus
 * X-RateLimit-NextAvailable on a 429) ride on every response, but they describe
 * REQUEST PACING, not remaining verification credits — and no credit-balance
 * endpoint is documented. Hence registry `supportsBalance: false`: "Test
 * connection" and the usage dashboard stay on our own counter.
 *
 * A bulk endpoint exists; we deliberately do not implement it — this system only
 * ever verifies one address at a time, at the moment a human types it.
 */

export const BASE_URL = process.env.INBOXTRUE_BASE_URL || "https://api.inboxtrue.com/v1/email/validate";
const DEFAULT_TIMEOUT_MS = 20000;
/** Their server-side probe budget, in seconds (documented range 1–90). */
const API_TIMEOUT_SECONDS = 10;

export type InboxTrueResponse = {
  email?: string;
  normalized?: string | null;
  validity?: string;
  validated_at?: string;
  is_disposable?: boolean;
  is_consumer?: boolean;
  is_domain_catchall?: boolean | null;
  mx_records?: string[];
  /** Present on an error body. */
  msg?: string;
  [k: string]: unknown;
};

/**
 * API key, or null when missing/blank (never throws). `source` is the
 * user-managed configuration; the environment is only the fallback seed path.
 */
export function getInboxTrueKey(source?: ProviderCredentials | null): string | null {
  const key = ((source ? source.api_key : process.env.INBOXTRUE_API_KEY) ?? "").trim();
  return key || null;
}

/** Map an HTTP status to our failure reason, or null when it is not a failure. */
export function classifyInboxTrueHttp(status: number): "auth" | "quota" | "error" | null {
  if (status === 200) return null;
  if (status === 401 || status === 403) return "auth";
  // 402 "Missing credits." is the vendor's authoritative out-of-credit answer —
  // it parks the provider for the period, overriding our own counter.
  if (status === 402) return "quota";
  // 429 is RATE LIMITING, not exhaustion: they publish a separate
  // X-RateLimit-NextAvailable, often seconds away. Parking the provider for the
  // rest of the month over a burst would throw away most of the free tier, so
  // this is a transient error and the chain simply moves on this once.
  return "error"; // 400, 404, 429, 500…
}

/**
 * Map InboxTrue's `validity` vocabulary into ours.
 *
 * Only DETERMINISTIC failures are undeliverable. `temp_error` and `perm_error`
 * both describe a failed MEASUREMENT (their probe could not reach a verdict),
 * not evidence the mailbox is bad — those are `unknown`, per verdict.ts.
 *
 * InboxTrue exposes no role-account flag; role detection stays with our local
 * `isRoleAccount` check. It does report `is_consumer` (a free/consumer mailbox),
 * which our local `isFreeProvider` already covers and which ProviderDetail has
 * no slot for — it is kept verbatim in `raw` rather than forced into the enum.
 */
export function mapInboxTrueValidity(
  validity: string,
  flags: Pick<InboxTrueResponse, "is_disposable" | "is_domain_catchall"> = {}
): { classification: ProviderClassification; detail: ProviderDetail } {
  let detail: ProviderDetail = null;
  if (flags.is_disposable === true) detail = "disposable";
  else if (flags.is_domain_catchall === true) detail = "catch_all";

  switch ((validity ?? "").toLowerCase()) {
    case "valid":
      return { classification: "deliverable", detail };
    case "invalid":
      // Their negative comes from an SMTP probe — probabilistic, so the verdict
      // engine only ever turns this into a WARN.
      return { classification: "undeliverable", detail: detail ?? "mailbox_not_found" };
    case "malformed":
      // Syntactically not an address. ProviderDetail has no syntax slot, and our
      // own parser would have caught this first anyway.
      return { classification: "undeliverable", detail };
    case "ambiguous":
    case "maybe_valid":
      return { classification: "risky", detail };
    case "temp_error":
    case "perm_error":
      return { classification: "unknown", detail };
    default:
      // Anything the vendor adds later degrades safely.
      return { classification: "unknown", detail };
  }
}

/** Best-effort `{msg}` from an error body — never throws, never echoes a key. */
function errorMessage(body: unknown): string | null {
  if (!body || typeof body !== "object") return null;
  const msg = (body as { msg?: unknown }).msg;
  return typeof msg === "string" && msg.trim() ? msg.trim() : null;
}

export const inboxtrue: ProviderAdapter = {
  name: "inboxtrue",

  isConfigured(credentials) {
    return getInboxTrueKey(credentials) !== null;
  },

  async verify(email, opts = {}) {
    const key = getInboxTrueKey(opts.credentials);
    // A blank credential SKIPS the provider — it must never throw.
    if (!key) return { ok: false, reason: "auth", message: "InboxTrue API key not configured" };

    const url = `${BASE_URL}?email=${encodeURIComponent(email)}&timeout=${API_TIMEOUT_SECONDS}`;
    try {
      const res = await fetch(url, {
        method: "GET",
        headers: { Authorization: `Bearer ${key}`, Accept: "application/json" },
        signal: AbortSignal.timeout(opts.timeoutMs ?? DEFAULT_TIMEOUT_MS),
      });

      const httpFailure = classifyInboxTrueHttp(res.status);
      if (httpFailure) {
        // Their `msg` is safe to surface (it never contains the key), but only
        // when the body actually parses.
        const body = await res.json().catch(() => null);
        const msg = errorMessage(body);
        return {
          ok: false,
          reason: httpFailure,
          message: msg ? `InboxTrue HTTP ${res.status}: ${msg}` : `InboxTrue HTTP ${res.status}`,
        };
      }

      let body: InboxTrueResponse | null = null;
      try {
        body = (await res.json()) as InboxTrueResponse;
      } catch {
        return { ok: false, reason: "error", message: "InboxTrue returned a non-JSON body" };
      }

      if (!body || typeof body !== "object") {
        return { ok: false, reason: "error", message: "InboxTrue returned an unexpected body" };
      }

      const validity = typeof body.validity === "string" ? body.validity : "";
      if (!validity) {
        const msg = errorMessage(body);
        return {
          ok: false,
          reason: "error",
          message: msg ? `InboxTrue error: ${msg}` : "InboxTrue response had no validity",
        };
      }

      const mapped = mapInboxTrueValidity(validity, body);
      return { ok: true, status: validity, classification: mapped.classification, detail: mapped.detail, raw: body };
    } catch (err) {
      const message = err instanceof Error ? err.name : "InboxTrue request failed";
      return { ok: false, reason: "error", message };
    }
  },
};
