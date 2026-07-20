import type { ProviderClassification, ProviderDetail, RemoteResult } from "../types";
import type { ProviderAdapter } from "./types";

/**
 * Verifalia adapter — REST API v2.7, HTTP Basic auth.
 *
 * Implemented against https://verifalia.com/developers/email-verifications
 * (creating-jobs / retrieving-jobs) and the core-concepts status-code table:
 *
 *   POST {BASE}/email-validations?waitTime=<ms>   body {"entries":[{"inputData":"a@b.com"}]}
 *     200 → the job finished inside the wait window; body is the job snapshot
 *     202 → still running; body carries overview.id, and a Location header
 *   GET  {BASE}/email-validations/{id}?waitTime=<ms>   → same snapshot shape
 *
 *   401 no/!valid credentials · 402 out of credit or over the monthly cap
 *   403 insufficient permission · 429 rate limit (18 req/s, burst 45)
 *
 * `waitTime` is 0..30000 ms and the server may honour less, so we still poll.
 */

const BASE_URL = process.env.VERIFALIA_BASE_URL || "https://api.verifalia.com/v2.7";
/** Per-request server-side wait. Kept short so a slow job does not hold a request handler. */
const WAIT_MS = 8000;
/** Hard ceiling across submit + all polls. */
const DEFAULT_TOTAL_TIMEOUT_MS = 25000;

export type VerifaliaEntry = {
  inputData?: string;
  emailAddress?: string;
  classification?: string;
  status?: string;
  isDisposableEmailAddress?: boolean;
  isRoleAccount?: boolean;
  isFreeEmailAddress?: boolean;
  suggestions?: string[];
};

/** Credentials, or null when either half is missing/blank (never throws). */
export function getVerifaliaCredentials(): { username: string; password: string } | null {
  const username = (process.env.VERIFALIA_USERNAME ?? "").trim();
  const password = (process.env.VERIFALIA_PASSWORD ?? "").trim();
  if (!username || !password) return null;
  return { username, password };
}

/** Map an HTTP status to our failure reason, or null when it is not a failure. */
export function classifyVerifaliaHttp(status: number): "auth" | "quota" | "error" | null {
  if (status === 200 || status === 202) return null;
  if (status === 401 || status === 403) return "auth";
  if (status === 402) return "quota";
  return "error"; // 400, 404, 429, 5xx…
}

/**
 * Map Verifalia's own vocabulary into ours. Their enum must never leak past here.
 * Classification is authoritative; `status` only adds detail.
 */
export function mapVerifaliaEntry(entry: VerifaliaEntry): {
  status: string;
  classification: ProviderClassification;
  detail: ProviderDetail;
} {
  const cls = (entry.classification ?? "").toLowerCase();
  const status = entry.status ?? "Unknown";

  let classification: ProviderClassification;
  switch (cls) {
    case "deliverable":
      classification = "deliverable";
      break;
    case "undeliverable":
      classification = "undeliverable";
      break;
    case "risky":
      classification = "risky";
      break;
    default:
      classification = "unknown";
  }

  let detail: ProviderDetail = null;
  const s = status.toLowerCase();
  if (s === "serveriscatchall") detail = "catch_all";
  else if (s === "mailboxdoesnotexist") detail = "mailbox_not_found";
  else if (s === "mailboxisdea" || entry.isDisposableEmailAddress) detail = "disposable";
  else if (entry.isRoleAccount) detail = "role";

  return { status, classification, detail };
}

/** Pull the single entry out of a job snapshot, tolerating both entry shapes. */
export function extractVerifaliaEntry(snapshot: unknown): VerifaliaEntry | null {
  const s = snapshot as { entries?: { data?: VerifaliaEntry[] } | VerifaliaEntry[] } | null;
  if (!s || typeof s !== "object") return null;
  const entries = s.entries;
  if (Array.isArray(entries)) return entries[0] ?? null;
  if (entries && Array.isArray(entries.data)) return entries.data[0] ?? null;
  return null;
}

function isCompleted(snapshot: unknown): boolean {
  const status = (snapshot as { overview?: { status?: string } })?.overview?.status ?? "";
  return status.toLowerCase() === "completed";
}

function authHeader(c: { username: string; password: string }): string {
  return `Basic ${Buffer.from(`${c.username}:${c.password}`).toString("base64")}`;
}

async function readJson(res: Response): Promise<unknown> {
  try {
    return await res.json();
  } catch {
    return null;
  }
}

export const verifalia: ProviderAdapter = {
  name: "verifalia",

  isConfigured() {
    return getVerifaliaCredentials() !== null;
  },

  async verify(email, opts = {}) {
    const creds = getVerifaliaCredentials();
    // A blank credential SKIPS the provider — it must never throw.
    if (!creds) return { ok: false, reason: "auth", message: "Verifalia credentials not configured" };

    const deadline = Date.now() + (opts.timeoutMs ?? DEFAULT_TOTAL_TIMEOUT_MS);
    const headers = {
      Authorization: authHeader(creds),
      "Content-Type": "application/json",
      Accept: "application/json",
    };

    try {
      let res = await fetch(`${BASE_URL}/email-validations?waitTime=${WAIT_MS}`, {
        method: "POST",
        headers,
        body: JSON.stringify({ entries: [{ inputData: email }] }),
        signal: AbortSignal.timeout(Math.max(1000, deadline - Date.now())),
      });

      let failure = classifyVerifaliaHttp(res.status);
      if (failure) return { ok: false, reason: failure, message: `Verifalia HTTP ${res.status}` };

      let snapshot = await readJson(res);
      let jobId = (snapshot as { overview?: { id?: string } })?.overview?.id ?? null;

      // 202 → keep polling the job until it completes or we run out of time.
      while (!isCompleted(snapshot) && jobId && Date.now() < deadline) {
        const remaining = deadline - Date.now();
        const wait = Math.min(WAIT_MS, Math.max(500, remaining - 500));
        res = await fetch(`${BASE_URL}/email-validations/${jobId}?waitTime=${wait}`, {
          method: "GET",
          headers,
          signal: AbortSignal.timeout(Math.max(1000, deadline - Date.now())),
        });
        failure = classifyVerifaliaHttp(res.status);
        if (failure) return { ok: false, reason: failure, message: `Verifalia HTTP ${res.status}` };
        snapshot = await readJson(res);
        jobId = (snapshot as { overview?: { id?: string } })?.overview?.id ?? jobId;
      }

      const entry = extractVerifaliaEntry(snapshot);
      if (!entry) {
        return { ok: false, reason: "error", message: "Verifalia job did not complete in time" };
      }

      const mapped = mapVerifaliaEntry(entry);
      return { ok: true, status: mapped.status, classification: mapped.classification, detail: mapped.detail, raw: snapshot };
    } catch (err) {
      // Network error / abort — never surface the credential, only the shape of the failure.
      const message = err instanceof Error ? err.name : "Verifalia request failed";
      return { ok: false, reason: "error", message };
    }
  },
};
