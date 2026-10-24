import { createHash } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import { isMissingSedcmsTables } from "./links";

/**
 * The request ids SED CMS has used (migration 0094, sedcms_requests).
 * SERVER ONLY.
 *
 * A request id is claimed with an insert BEFORE anything is written, and the
 * table's primary key makes the claim single-use on every LMS process. The
 * replay cache (lib/sedcms/signature.ts) is per process, and a rollback (a
 * publish of what was there before) puts back exactly the bytes an old apply
 * expected, so without this a captured apply replayed on the other process
 * would pass the checksum guard and undo the rollback.
 *   - apply: claimed before anything is read or written. A used id never
 *     writes: 409 REQUEST_ID_USED, unless it is this lead's same request and
 *     every file is already at its new bytes (then 200, the plan's rule for
 *     a retried request).
 *   - ticket: the id names its one ticket. Everything the request makes has
 *     an id derived from it (derivedUuid), so a second delivery, on any
 *     process, at any moment, finds what the first made instead of making
 *     it again, and completes what a failed or crashed one left undone.
 */

export type RequestKind = "apply" | "ticket";

export interface UsedRequest {
  requestId: string;
  leadId: string;
  kind: RequestKind;
  digest: string;
  ticketId: string | null;
  completedAt: string | null;
}

export type Claim = { status: "claimed" } | { status: "used"; request: UsedRequest } | { status: "error"; missingTable: boolean };

const COLUMNS = "request_id, lead_id, kind, digest, ticket_id, completed_at";

function asUsed(row: unknown): UsedRequest | null {
  const r = row as Record<string, unknown> | null;
  if (!r || typeof r.request_id !== "string" || typeof r.lead_id !== "string" || typeof r.digest !== "string") return null;
  if (r.kind !== "apply" && r.kind !== "ticket") return null;
  return {
    requestId: r.request_id,
    leadId: r.lead_id,
    kind: r.kind,
    digest: r.digest,
    ticketId: typeof r.ticket_id === "string" ? r.ticket_id : null,
    completedAt: typeof r.completed_at === "string" ? r.completed_at : null,
  };
}

/** Claim `requestId` for this lead and kind; "used" carries what claimed it first. */
export async function claimRequest(
  admin: SupabaseClient,
  r: { requestId: string; leadId: string; kind: RequestKind; digest: string },
): Promise<Claim> {
  try {
    const { error } = await admin.from("sedcms_requests").insert({ request_id: r.requestId, lead_id: r.leadId, kind: r.kind, digest: r.digest });
    if (!error) return { status: "claimed" };
    if ((error as { code?: unknown }).code !== "23505") return { status: "error", missingTable: isMissingSedcmsTables(error) };
    const { data, error: readError } = await admin.from("sedcms_requests").select(COLUMNS).eq("request_id", r.requestId).maybeSingle();
    const used = readError ? null : asUsed(data);
    return used ? { status: "used", request: used } : { status: "error", missingTable: false };
  } catch {
    return { status: "error", missingTable: false };
  }
}

/** Mark a change request done, with its ticket. False when that couldn't be written. */
export async function completeRequest(admin: SupabaseClient, requestId: string, ticketId: string): Promise<boolean> {
  try {
    const { error } = await admin
      .from("sedcms_requests")
      .update({ ticket_id: ticketId, completed_at: new Date().toISOString() })
      .eq("request_id", requestId)
      .is("completed_at", null);
    return !error;
  } catch {
    return false;
  }
}

/** hex sha256 of a value's JSON (callers build it in one fixed key order). */
export function digestOf(value: unknown): string {
  return createHash("sha256").update(JSON.stringify(value), "utf8").digest("hex");
}

/**
 * A name-based UUID (RFC 9562 version 8, from SHA-256) for something a
 * request makes: the same request always names the same ticket, items and
 * log row.
 */
export function derivedUuid(name: string, requestId: string): string {
  const h = createHash("sha256").update(`sedcms:${name}:${requestId}`, "utf8").digest();
  h[6] = (h[6] & 0x0f) | 0x80;
  h[8] = (h[8] & 0x3f) | 0x80;
  const x = h.subarray(0, 16).toString("hex");
  return `${x.slice(0, 8)}-${x.slice(8, 12)}-${x.slice(12, 16)}-${x.slice(16, 20)}-${x.slice(20)}`;
}
