// lib/push/payload.ts
/**
 * What a push message carries. PURE (shared by the dispatcher and tests).
 * Push services cap the encrypted body at ~4 KB, so text is trimmed and only
 * what the notification itself shows travels — never lead data beyond the
 * title and body the bell already displays.
 */
import { URGENT_EVENTS } from "@/lib/notifications/events";

export interface PushPayload {
  /** The notification row, so a click can mark it read. */
  id: string | null;
  title: string;
  body: string;
  /** Where a click lands (same-origin path). */
  url: string;
  /** Same tag = the newer notification replaces the older one on screen. */
  tag: string;
  /** Stays on screen until clicked. */
  urgent: boolean;
  /** When it happened (ms), for the OS notification's timestamp. */
  ts: number;
}

const clip = (s: string, n: number) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);

/** A notification row → the push it becomes. A click goes through the open
 *  route, which marks the row read and then lands on its page. */
export function pushPayloadFor(n: {
  id: string;
  event_key: string;
  title: string;
  body: string;
  created_at: string;
  lead_id?: string | null;
  target_url?: string | null;
}): PushPayload {
  return {
    id: n.id,
    title: clip(n.title || "SED LMS", 120),
    body: clip(n.body || "", 400),
    url: `/api/notifications/${n.id}/open`,
    tag: `n-${n.id}`,
    urgent: URGENT_EVENTS.has(n.event_key),
    ts: new Date(n.created_at).getTime() || Date.now(),
  };
}

/**
 * Where the open route sends someone: the notification's own page when it is
 * a same-origin path, else the lead, else the inbox. An absolute or
 * protocol-relative URL is never followed (no open redirect).
 */
export function safeTarget(n: { target_url?: string | null; lead_id?: string | null }): string {
  const t = (n.target_url ?? "").trim();
  if (t.startsWith("/") && !t.startsWith("//") && !t.startsWith("/\\")) return t;
  if (n.lead_id) return `/leads/${n.lead_id}`;
  return "/notifications";
}
