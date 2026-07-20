/**
 * Bounce (NDR) detection — PURE. No IMAP, no database, no network.
 *
 * A bounce is the only *ground truth* we ever get about a verification: the
 * provider said "deliverable", we sent, and the receiving MTA said no. That is
 * what makes the accuracy scorecard meaningful, so this parser is deliberately
 * conservative — a false "hard bounce" would wrongly blame a provider.
 *
 * Recognition is header-first (sender + subject) so the poller can decide
 * whether a message is even worth downloading. The failed recipient and the
 * hard/soft split come from the body: RFC 3464 delivery-status fields
 * (`Final-Recipient:` / `Original-Recipient:` / `Status:` / `Diagnostic-Code:`)
 * first, then the common plain-text forms every MTA invents.
 */

export interface BounceMessage {
  from: string;
  subject: string;
  /** Raw message source, or just the text part. Optional. */
  body?: string | null;
}

export interface BounceResult {
  isBounce: boolean;
  failedRecipient: string | null;
  kind: "hard" | "soft" | null;
}

const DAEMON_SENDER = /(mailer[-_.]?daemon|postmaster@|^postmaster\b|no[-_.]?reply@.*(bounce|delivery)|bounce[sd]?@)/i;

const BOUNCE_SUBJECTS: RegExp[] = [
  /undelivered\s+mail\s+returned\s+to\s+sender/i,
  /delivery\s+status\s+notification/i,
  /(mail|message)\s+delivery\s+(failed|failure|status)/i,
  /delivery\s+(has\s+)?failed/i,
  /\bundeliver(able|ed)\b/i,
  /returned\s+(mail|message|to\s+sender)/i,
  /failure\s+notice/i,
  /delivery\s+notification:\s*delivery\s+has\s+failed/i,
  /^mail\s+system\s+error/i,
];

/** Cheap header-only check: is this worth downloading and parsing? */
export function looksLikeBounce(message: Pick<BounceMessage, "from" | "subject">): boolean {
  const from = message.from ?? "";
  const subject = message.subject ?? "";
  if (DAEMON_SENDER.test(from)) return true;
  return BOUNCE_SUBJECTS.some((re) => re.test(subject));
}

/**
 * "Delivery Status Notification (Failure)" is a bounce; the *same* subject with
 * "(Delayed)" or "(Relayed)" is not a failure at all. Guard against those.
 */
const NON_FAILURE_SUBJECT = /\((delayed|relayed|expanded|success(ful)?)\)/i;

const EMAIL_RE = /[A-Za-z0-9!#$%&'*+/=?^_`{|}~.-]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)+/;

function cleanAddress(raw: string): string | null {
  let v = raw.trim();
  // rfc822; <user@host>  |  RFC822;user@host  |  <user@host>
  v = v.replace(/^(rfc\s?822|utf-8|x-[a-z0-9-]+)\s*;\s*/i, "");
  v = v.replace(/^[<"']+|[>"',.;:]+$/g, "");
  const match = v.match(EMAIL_RE);
  if (!match) return null;
  const addr = match[0].replace(/^\.+|\.+$/g, "").toLowerCase();
  // Never treat the daemon itself as the failed recipient.
  if (/^(mailer-daemon|postmaster)@/i.test(addr)) return null;
  return addr;
}

/** DSN `Final-Recipient:` / `Original-Recipient:`, then plain-text fallbacks. */
export function extractFailedRecipient(body: string | null | undefined): string | null {
  if (!body) return null;

  for (const field of ["final-recipient", "original-recipient"]) {
    const re = new RegExp(`^${field}\\s*:\\s*(.+)$`, "im");
    const m = body.match(re);
    const addr = m ? cleanAddress(m[1]) : null;
    if (addr) return addr;
  }

  const plainForms: RegExp[] = [
    // Postfix: "<user@host>: host mail.example.com said: 550 ..."
    /^\s*<([^>\s]+@[^>\s]+)>\s*[:(]/im,
    // Exim: "The following address(es) failed:\n  user@host"
    /following\s+address(?:\(es\))?\s+failed:?\s*\r?\n\s*<?([^\s<>]+@[^\s<>]+)>?/i,
    // Generic: "Your message to user@host couldn't be delivered"
    /message\s+to\s+<?([^\s<>]+@[^\s<>]+)>?\s+(?:could\s*n[o']?t|was\s+not|has\s+not)/i,
    // Generic: "Recipient address rejected: user@host"
    /recipient\s+address\s+rejected:?\s*<?([^\s<>]+@[^\s<>]+)>?/i,
    /^\s*(?:to|recipient)\s*:\s*<?([^\s<>]+@[^\s<>]+)>?\s*$/im,
  ];
  for (const re of plainForms) {
    const m = body.match(re);
    const addr = m ? cleanAddress(m[1]) : null;
    if (addr) return addr;
  }
  return null;
}

/**
 * hard | soft, from the DSN status code (5.x.x / 4.x.x) or the SMTP reply in
 * `Diagnostic-Code:`. UNKNOWN DEGRADES TO SOFT: a soft bounce never counts
 * against a provider in the scorecard, so guessing wrong is free, whereas a
 * wrongly-hard bounce permanently libels a provider's accuracy score.
 */
export function classifyBounceKind(body: string | null | undefined): "hard" | "soft" {
  if (!body) return "soft";

  const status = body.match(/^status\s*:\s*([245])\.\d{1,3}\.\d{1,3}/im);
  if (status) return status[1] === "5" ? "hard" : "soft";

  const diagnostic = body.match(/^diagnostic-code\s*:\s*[^;\r\n]*;\s*(\d{3})/im);
  if (diagnostic) return diagnostic[1].startsWith("5") ? "hard" : "soft";

  const smtp = body.match(/\b(5\d{2})[\s-]\d\.\d{1,3}\.\d{1,3}\b/);
  if (smtp) return "hard";

  // Unambiguous English from MTAs that emit no codes at all.
  if (/(user\s+unknown|no\s+such\s+(user|recipient|mailbox)|mailbox\s+(unavailable|not\s+found)|address\s+(does\s+not\s+exist|rejected)|recipient\s+(address\s+)?rejected|account\s+(has\s+been\s+)?(disabled|deactivated))/i.test(body)) {
    return "hard";
  }
  return "soft";
}

/** Full detection. Safe on any input — never throws. */
export function detectBounce(message: BounceMessage): BounceResult {
  const subject = message?.subject ?? "";
  const notABounce = { isBounce: false, failedRecipient: null, kind: null } as const;

  if (NON_FAILURE_SUBJECT.test(subject)) return notABounce;
  if (!looksLikeBounce({ from: message?.from ?? "", subject })) return notABounce;

  return {
    isBounce: true,
    failedRecipient: extractFailedRecipient(message?.body),
    kind: classifyBounceKind(message?.body),
  };
}
