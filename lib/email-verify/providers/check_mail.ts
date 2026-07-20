import type { ProviderClassification, ProviderDetail } from "../types";
import type { ProviderAdapter, ProviderCredentials } from "./types";

/**
 * Check-Mail.org adapter — key-based single lookup.
 *
 * Implemented against https://docs.check-mail.org/api-and-authentication/
 *
 *   POST https://api.check-mail.org/v2/
 *   Authorization: Bearer <API key>
 *   body (form-encoded): email=<address>        (or domain=<domain>)
 *
 * Documented success body (fields, from the API reference):
 *
 *   { "valid": true, "block": true, "disposable": true,
 *     "domain": "temp-mail.org", "base_domain": "temp-mail.org",
 *     "text": "Disposable / temporary domain", "reason": "Heuristics x6",
 *     "risk": 99, "is_disposable": true, "is_role_based_email": false,
 *     "possible_typo": …, "is_parked": …, "mx_host": …, … }
 *
 *   `block` is the headline value: true when the domain or address is either
 *   invalid or disposable. `valid` is DOMAIN-LEVEL — "the domain exists and can
 *   receive mail" — so Check-Mail never confirms an individual MAILBOX the way
 *   Verifalia's and Reoon's SMTP probes do. Its positive answer is therefore
 *   weaker evidence, which is why it sits last in RECOMMENDED_ORDER.
 *
 *   401 → invalid/missing key, body {"message":"Invalid API key."}
 *   429 → rate limit / monthly allowance exceeded
 *   The `x-ratelimit-requests-remaining` response header carries the remaining
 *   quota, but there is NO separate balance endpoint — reading it would cost a
 *   lookup, so the registry sets `supportsBalance: false` and "Test connection"
 *   stays on our own counter.
 *
 * Check-Mail publishes no single status enum, so the verbatim `status` we store
 * is the vendor's own `text` sentence, falling back to a derived token.
 */

export const BASE_URL = process.env.CHECK_MAIL_BASE_URL || "https://api.check-mail.org/v2/";
const DEFAULT_TIMEOUT_MS = 20000;

export type CheckMailResponse = {
  valid?: boolean;
  block?: boolean;
  disposable?: boolean;
  is_disposable?: boolean;
  is_role_based_email?: boolean;
  is_parked?: boolean;
  text?: string;
  reason?: string;
  risk?: number;
  message?: string;
  [k: string]: unknown;
};

/**
 * API key, or null when missing/blank (never throws). `source` is the
 * user-managed configuration; the environment is only the fallback seed path.
 */
export function getCheckMailKey(source?: ProviderCredentials | null): string | null {
  const key = ((source ? source.api_key : process.env.CHECK_MAIL_API_KEY) ?? "").trim();
  return key || null;
}

/** Map an HTTP status to our failure reason, or null when it is not a failure. */
export function classifyCheckMailHttp(status: number): "auth" | "quota" | "error" | null {
  if (status === 200) return null;
  if (status === 401 || status === 403) return "auth";
  // 429 is the documented answer both for bursting and for spending the
  // 1000/month allowance — provider-authoritative, so it parks the provider.
  if (status === 402 || status === 429) return "quota";
  return "error";
}

/** The stored, human-recognisable status. Their `text`, or a derived token. */
export function checkMailStatus(body: CheckMailResponse): string {
  const text = (body.text ?? "").trim();
  if (text) return text;
  if (body.valid === false) return "invalid";
  if (body.block === true) return "blocked";
  return "valid";
}

/**
 * Map Check-Mail's booleans into our enum.
 *
 * Order matters: an explicit `valid: false` is their strongest negative, then
 * the `block` recommendation, then the plain positive.
 */
export function mapCheckMail(body: CheckMailResponse): {
  classification: ProviderClassification;
  detail: ProviderDetail;
} {
  const disposable = body.is_disposable === true || body.disposable === true;
  const role = body.is_role_based_email === true;

  let detail: ProviderDetail = null;
  if (disposable) detail = "disposable";
  else if (role) detail = "role";

  // Domain-level "this cannot receive mail". Still only a WARN downstream —
  // BLOCK is reserved for our own deterministic DNS/syntax checks.
  if (body.valid === false) return { classification: "undeliverable", detail };
  if (body.block === true) return { classification: "risky", detail };
  if (body.valid === true) return { classification: "deliverable", detail };

  // Neither boolean present (or not booleans) — say so rather than guess.
  return { classification: "unknown", detail };
}

export const checkMail: ProviderAdapter = {
  name: "check_mail",

  isConfigured(credentials) {
    return getCheckMailKey(credentials) !== null;
  },

  async verify(email, opts = {}) {
    const key = getCheckMailKey(opts.credentials);
    // A blank credential SKIPS the provider — it must never throw.
    if (!key) return { ok: false, reason: "auth", message: "Check-Mail API key not configured" };

    try {
      const res = await fetch(BASE_URL, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${key}`,
          "Content-Type": "application/x-www-form-urlencoded",
          Accept: "application/json",
        },
        body: new URLSearchParams({ email }).toString(),
        signal: AbortSignal.timeout(opts.timeoutMs ?? DEFAULT_TIMEOUT_MS),
      });

      const httpFailure = classifyCheckMailHttp(res.status);
      if (httpFailure) return { ok: false, reason: httpFailure, message: `Check-Mail HTTP ${res.status}` };

      let body: CheckMailResponse | null = null;
      try {
        body = (await res.json()) as CheckMailResponse;
      } catch {
        return { ok: false, reason: "error", message: "Check-Mail returned a non-JSON body" };
      }

      if (!body || typeof body !== "object") {
        return { ok: false, reason: "error", message: "Check-Mail returned an unexpected body" };
      }

      // A 200 carrying only {"message": …} is the documented error envelope.
      if (body.valid === undefined && body.block === undefined) {
        const message = typeof body.message === "string" ? body.message : "";
        if (message) return { ok: false, reason: "error", message: `Check-Mail error: ${message}` };
        return { ok: false, reason: "error", message: "Check-Mail response had no verdict fields" };
      }

      const mapped = mapCheckMail(body);
      return {
        ok: true,
        status: checkMailStatus(body),
        classification: mapped.classification,
        detail: mapped.detail,
        raw: body,
      };
    } catch (err) {
      const message = err instanceof Error ? err.name : "Check-Mail request failed";
      return { ok: false, reason: "error", message };
    }
  },
};
