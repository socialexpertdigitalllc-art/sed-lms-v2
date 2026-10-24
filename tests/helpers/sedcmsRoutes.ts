import { SEDCMS_SIGNATURE_HEADER, SEDCMS_TIMESTAMP_HEADER, sedcmsSignature } from "@/lib/sedcms/signature";
import type { UniqueIndex } from "./memorySupabase";

/**
 * Signed requests for the SED CMS internal route tests, made the way the CMS
 * makes them. A test-only secret, set as SEDCMS_LMS_SECRET by the test.
 */

export const TEST_SECRET = "sedcms-route-tests-only-secret-0123456789abcdef";
export const LMS = "https://lms.sedsolutions.online";

// Each request gets its own timestamp, counting down from the moment the file
// loads, so two identical requests in a test are two signatures, not a replay
// (a test file signs far fewer than 300 requests in far less than a minute).
const base = Math.floor(Date.now() / 1000);
let step = 0;

export interface SignOptions {
  secret?: string;
  /** send these bytes instead of the ones signed */
  tamper?: (raw: string) => string;
  unsigned?: boolean;
}

export function signedRequest(path: string, body: unknown, opts: SignOptions = {}): Request {
  const raw = typeof body === "string" ? body : JSON.stringify(body);
  const timestamp = base - step++;
  const headers = new Headers({ "content-type": "application/json" });
  if (!opts.unsigned) {
    headers.set(SEDCMS_TIMESTAMP_HEADER, String(timestamp));
    headers.set(SEDCMS_SIGNATURE_HEADER, sedcmsSignature(opts.secret ?? TEST_SECRET, "POST", path, timestamp, raw));
  }
  return new Request(`${LMS}${path}`, { method: "POST", headers, body: opts.tamper ? opts.tamper(raw) : raw });
}

export const routeCtx = (id: string) => ({ params: Promise.resolve({ id }) });

export const leadPath = (id: string, endpoint: string) => `/api/internal/sedcms/leads/${id}/${endpoint}`;

/** Migration 0094's unique indexes (and the primary keys SED CMS relies on), for memorySupabase. */
export const SEDCMS_UNIQUE: Record<string, UniqueIndex[]> = {
  sedcms_links: [
    { name: "sedcms_links_one_per_lead", key: (r) => (r.revoked_at == null ? String(r.lead_id) : null) },
    { name: "sedcms_links_one_per_site", key: (r) => (r.revoked_at == null ? String(r.host).replace(/^www\./, "") : null) },
  ],
  sedcms_requests: [{ name: "sedcms_requests_pkey", key: (r) => String(r.request_id) }],
  lead_tickets: [{ name: "lead_tickets_pkey", key: (r) => String(r.id) }],
  ticket_items: [{ name: "ticket_items_pkey", key: (r) => String(r.id) }],
  activity_log: [{ name: "activity_log_pkey", key: (r) => String(r.id) }],
};

let linkSeq = 0;

/** An active sedcms_links row: SED CMS turned on for `leadId` at `host`. */
export function linkRow(leadId: string, host: string, extra: Record<string, unknown> = {}) {
  linkSeq++;
  return {
    id: `0000a11c-0000-4000-8000-${String(linkSeq).padStart(12, "0")}`,
    lead_id: leadId,
    host,
    linked_by: null,
    linked_at: "2026-10-24T00:00:00.000Z",
    revoked_at: null,
    revoked_by: null,
    ...extra,
  };
}

/** Migration 0094's column defaults, for memorySupabase. */
export const SEDCMS_DEFAULTS: Record<string, () => Record<string, unknown>> = {
  sedcms_links: () => ({ linked_at: new Date().toISOString(), revoked_at: null, revoked_by: null }),
  sedcms_requests: () => ({ ticket_id: null, completed_at: null }),
};
