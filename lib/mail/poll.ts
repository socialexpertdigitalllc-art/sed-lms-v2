/**
 * Pure planning helpers for the cron mail poller. Kept free of IMAP/DB so the
 * two rules that matter — first-run suppression and "only strictly newer UIDs"
 * — are unit-testable.
 */

export interface PollMessage {
  uid: number;
  from: string;
  subject: string;
}

export interface PollPlan {
  /** True when the mailbox has never been polled — we record a watermark and notify nobody. */
  firstRun: boolean;
  /** Messages that deserve a notification, oldest UID first. */
  toNotify: PollMessage[];
  /** New watermark to persist, or null when there is nothing to record. */
  highestUid: number | null;
}

/**
 * Decide what to notify about for one mailbox.
 *
 * - `lastNotifiedUid === null` → first run: never notify (nobody wants their
 *   whole existing inbox as a bell storm). Just park the watermark just below
 *   `uidNext` so the next run picks up genuinely new mail.
 * - otherwise → notify for every fetched message whose UID is strictly greater
 *   than the watermark. IMAP's `n:*` range always yields at least one message
 *   even when nothing is newer, so this filter is load-bearing.
 */
export function planMailPoll(
  lastNotifiedUid: number | null,
  uidNext: number | null,
  messages: PollMessage[]
): PollPlan {
  if (lastNotifiedUid === null) {
    const watermark = typeof uidNext === "number" && uidNext > 0 ? uidNext - 1 : null;
    return { firstRun: true, toNotify: [], highestUid: watermark };
  }

  const fresh = messages
    .filter((m) => Number.isFinite(m.uid) && m.uid > lastNotifiedUid)
    .sort((a, b) => a.uid - b.uid);

  const highest = fresh.reduce((max, m) => (m.uid > max ? m.uid : max), lastNotifiedUid);
  return { firstRun: false, toNotify: fresh, highestUid: highest };
}

/** Stable per-message dedup key so overlapping cron runs can't double-send. */
export function mailDedupKey(mailboxId: string, uid: number): string {
  return `mail:${mailboxId}:${uid}`;
}

/** Bell copy for one new message. */
export function mailNotificationText(msg: PollMessage, mailboxAddress: string): { title: string; body: string } {
  const from = msg.from.trim() || "Unknown sender";
  const subject = msg.subject.trim() || "(no subject)";
  return { title: `New email from ${from}`, body: `${subject} — ${mailboxAddress}` };
}
