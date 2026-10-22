import { SEDCMS_SIGNATURE_HEADER, SEDCMS_TIMESTAMP_HEADER, sedcmsSignature } from "@/lib/sedcms/signature";

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
