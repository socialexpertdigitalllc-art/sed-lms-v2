import type { ProviderClassification, ProviderDetail } from "../types";
import type { ProviderAdapter, ProviderCredentials } from "./types";

/**
 * MailRook adapter — key-based single verification.
 *
 * Implemented against https://mailrook.com/docs/api
 *
 *   GET https://api.mailrook.com/v1/validate/{email}
 *   Authorization: Bearer <API key>
 *
 * Documented success body (the address is path-encoded, so the key only ever
 * travels in the header):
 *
 *   { "data": { "email", "normalized_email", "domain", "mx_record", "provider",
 *               "score", "result", "reason",
 *               "isv_format", "isv_domain", "isv_deliverable",
 *               "isv_nocatchall", "isv_nodisposable", "isv_nofreeemail",
 *               "isv_nogeneric" },
 *     "code": 0, "message": "ok" }
 *
 *   result: deliverable | undeliverable | risky | unknown
 *
 * The `isv_*` flags are documented as ASSERTIONS — `isv_nodisposable: true`
 * means "not disposable". Only `reason: "catch_all"` is shown in the docs, so
 * we read detail from the flags and treat any other `reason` as opaque.
 *
 * Documented failure codes: 401 (missing/invalid key), 422 (bad address),
 * 429 (rate limit / quota), 500. The docs do NOT publish the error body shape,
 * so we classify on the HTTP status alone and never guess at a payload.
 *
 * There is NO documented balance/credits endpoint — see registry
 * `supportsBalance: false`, which keeps "Test connection" on our own counter.
 */

export const BASE_URL = process.env.MAILROOK_BASE_URL || "https://api.mailrook.com/v1/validate";
const DEFAULT_TIMEOUT_MS = 20000;

export type MailrookData = {
  email?: string;
  result?: string;
  reason?: string | null;
  score?: number;
  isv_nocatchall?: boolean;
  isv_nodisposable?: boolean;
  isv_nogeneric?: boolean;
  [k: string]: unknown;
};

export type MailrookResponse = {
  data?: MailrookData;
  code?: number;
  message?: string;
};

/**
 * API key, or null when missing/blank (never throws). `source` is the
 * user-managed configuration; the environment is only the fallback seed path.
 */
export function getMailrookKey(source?: ProviderCredentials | null): string | null {
  const key = ((source ? source.api_key : process.env.MAILROOK_API_KEY) ?? "").trim();
  return key || null;
}

/** Map an HTTP status to our failure reason, or null when it is not a failure. */
export function classifyMailrookHttp(status: number): "auth" | "quota" | "error" | null {
  if (status === 200) return null;
  if (status === 401 || status === 403) return "auth";
  // 429 is the documented "you exceeded your limit" answer, and 402 is the
  // conventional out-of-credit code — both park the provider for the period.
  if (status === 402 || status === 429) return "quota";
  return "error"; // 422, 500…
}

/**
 * Map MailRook's `result` vocabulary into ours.
 *
 * `reason: "catch_all"` is the one documented reason value; everything else is
 * left opaque and the detail is read from the negative `isv_*` assertions.
 */
export function mapMailrookResult(
  result: string,
  data: Pick<MailrookData, "reason" | "isv_nocatchall" | "isv_nodisposable" | "isv_nogeneric"> = {}
): { classification: ProviderClassification; detail: ProviderDetail } {
  const reason = (data.reason ?? "").toLowerCase();

  let detail: ProviderDetail = null;
  if (reason === "catch_all" || data.isv_nocatchall === false) detail = "catch_all";
  else if (data.isv_nodisposable === false) detail = "disposable";
  else if (data.isv_nogeneric === false) detail = "role";

  switch ((result ?? "").toLowerCase()) {
    case "deliverable":
      return { classification: "deliverable", detail };
    case "undeliverable":
      // Their negative answer comes from an SMTP probe — probabilistic, so the
      // verdict engine only ever turns this into a WARN.
      return { classification: "undeliverable", detail: detail ?? "mailbox_not_found" };
    case "risky":
      return { classification: "risky", detail };
    default:
      // "unknown", and anything the vendor adds later, degrades safely.
      return { classification: "unknown", detail };
  }
}

export const mailrook: ProviderAdapter = {
  name: "mailrook",

  isConfigured(credentials) {
    return getMailrookKey(credentials) !== null;
  },

  async verify(email, opts = {}) {
    const key = getMailrookKey(opts.credentials);
    // A blank credential SKIPS the provider — it must never throw.
    if (!key) return { ok: false, reason: "auth", message: "MailRook API key not configured" };

    try {
      const res = await fetch(`${BASE_URL}/${encodeURIComponent(email)}`, {
        method: "GET",
        headers: { Authorization: `Bearer ${key}`, Accept: "application/json" },
        signal: AbortSignal.timeout(opts.timeoutMs ?? DEFAULT_TIMEOUT_MS),
      });

      const httpFailure = classifyMailrookHttp(res.status);
      // Never echo a body here — only the shape of the failure.
      if (httpFailure) return { ok: false, reason: httpFailure, message: `MailRook HTTP ${res.status}` };

      let body: MailrookResponse | null = null;
      try {
        body = (await res.json()) as MailrookResponse;
      } catch {
        return { ok: false, reason: "error", message: "MailRook returned a non-JSON body" };
      }

      const data = body && typeof body === "object" ? body.data : null;
      const result = data && typeof data === "object" ? (data.result ?? "") : "";
      if (!result) return { ok: false, reason: "error", message: "MailRook response had no result" };

      const mapped = mapMailrookResult(result, data ?? {});
      return { ok: true, status: result, classification: mapped.classification, detail: mapped.detail, raw: body };
    } catch (err) {
      const message = err instanceof Error ? err.name : "MailRook request failed";
      return { ok: false, reason: "error", message };
    }
  },
};
