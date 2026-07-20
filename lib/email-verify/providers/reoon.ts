import type { ProviderClassification, ProviderDetail, RemoteResult } from "../types";
import type { ProviderAdapter } from "./types";

/**
 * Reoon Email Verifier adapter — key-based single verification.
 *
 * Implemented against https://www.reoon.com/articles/api-documentation-of-reoon-email-verifier/
 *
 *   GET https://emailverifier.reoon.com/api/v1/verify?email=<e>&key=<k>&mode=power
 *
 * Success body (quick mode example from the docs):
 *   { email, status, username, domain, is_valid_syntax, is_disposable,
 *     is_role_account, mx_accepts_mail, is_spamtrap, is_free_email,
 *     mx_records[], verification_mode }
 * Power mode adds is_safe_to_send / can_connect_smtp / has_inbox_full /
 * is_catch_all / is_deliverable / is_disabled.
 *
 *   status (quick): valid | invalid | disposable | spamtrap
 *   status (power): safe | invalid | disabled | disposable | inbox_full |
 *                   catch_all | role_account | spamtrap | unknown
 *
 * Documented error shape: {"status":"error","reason":"<description>"}.
 */

const BASE_URL = process.env.REOON_BASE_URL || "https://emailverifier.reoon.com/api/v1/verify";
const DEFAULT_TIMEOUT_MS = 20000;
/** "power" does the SMTP-level probe; "quick" is syntax + MX only. */
const MODE = (process.env.REOON_MODE || "power").toLowerCase();

export type ReoonResponse = {
  email?: string;
  status?: string;
  reason?: string;
  is_disposable?: boolean;
  is_role_account?: boolean;
  is_catch_all?: boolean;
  is_safe_to_send?: boolean;
  [k: string]: unknown;
};

/** API key, or null when missing/blank (never throws). */
export function getReoonKey(): string | null {
  const key = (process.env.REOON_API_KEY ?? "").trim();
  return key || null;
}

/** Map Reoon's status vocabulary into ours. */
export function mapReoonStatus(
  status: string,
  flags: Pick<ReoonResponse, "is_disposable" | "is_role_account" | "is_catch_all"> = {}
): { classification: ProviderClassification; detail: ProviderDetail } {
  switch ((status ?? "").toLowerCase()) {
    case "valid":
    case "safe":
      return { classification: "deliverable", detail: flags.is_role_account ? "role" : null };
    case "invalid":
      return { classification: "undeliverable", detail: "mailbox_not_found" };
    case "disabled":
      return { classification: "undeliverable", detail: null };
    case "disposable":
      return { classification: "risky", detail: "disposable" };
    case "catch_all":
      return { classification: "risky", detail: "catch_all" };
    case "role_account":
      return { classification: "risky", detail: "role" };
    case "spamtrap":
    case "inbox_full":
      return { classification: "risky", detail: null };
    default:
      return { classification: "unknown", detail: flags.is_catch_all ? "catch_all" : null };
  }
}

/** Classify a documented `{status:"error", reason}` payload. */
export function classifyReoonError(reason: string): "quota" | "auth" | "error" {
  const r = (reason ?? "").toLowerCase();
  if (/credit|quota|limit|exhaust|insufficient|balance|exceed/.test(r)) return "quota";
  if (/key|auth|permission|forbidden|token|subscription|expired/.test(r)) return "auth";
  return "error";
}

/** Map an HTTP status to our failure reason, or null when it is not a failure. */
export function classifyReoonHttp(status: number): "auth" | "quota" | "error" | null {
  if (status === 200) return null;
  if (status === 401 || status === 403) return "auth";
  if (status === 402 || status === 429) return "quota";
  return "error";
}

export const reoon: ProviderAdapter = {
  name: "reoon",

  isConfigured() {
    return getReoonKey() !== null;
  },

  async verify(email, opts = {}) {
    const key = getReoonKey();
    // A blank credential SKIPS the provider — it must never throw.
    if (!key) return { ok: false, reason: "auth", message: "Reoon API key not configured" };

    const url = `${BASE_URL}?email=${encodeURIComponent(email)}&key=${encodeURIComponent(key)}&mode=${encodeURIComponent(MODE)}`;
    try {
      const res = await fetch(url, {
        method: "GET",
        headers: { Accept: "application/json" },
        signal: AbortSignal.timeout(opts.timeoutMs ?? DEFAULT_TIMEOUT_MS),
      });

      const httpFailure = classifyReoonHttp(res.status);
      // The URL carries the key — never let it reach a log or an error message.
      if (httpFailure) return { ok: false, reason: httpFailure, message: `Reoon HTTP ${res.status}` };

      let body: ReoonResponse | null = null;
      try {
        body = (await res.json()) as ReoonResponse;
      } catch {
        return { ok: false, reason: "error", message: "Reoon returned a non-JSON body" };
      }

      const status = body?.status ?? "";
      if (status === "error") {
        const reason = classifyReoonError(body?.reason ?? "");
        return { ok: false, reason, message: `Reoon error: ${body?.reason ?? "unspecified"}` };
      }
      if (!status) return { ok: false, reason: "error", message: "Reoon response had no status" };

      const mapped = mapReoonStatus(status, body ?? {});
      return { ok: true, status, classification: mapped.classification, detail: mapped.detail, raw: body };
    } catch (err) {
      const message = err instanceof Error ? err.name : "Reoon request failed";
      return { ok: false, reason: "error", message };
    }
  },
};
