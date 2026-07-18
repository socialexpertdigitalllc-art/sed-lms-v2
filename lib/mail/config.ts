import { decryptSecret } from "@/lib/mail/crypto";
import { MAILBOX_DEFAULTS, type CompanyMailboxRow, type ResolvedMailbox } from "@/lib/mail/types";

/** Map a DB row → ResolvedMailbox: decrypt the password, fill host/port defaults. */
export function resolveMailboxRow(r: CompanyMailboxRow): ResolvedMailbox {
  return {
    id: r.id,
    userId: r.user_id,
    address: r.email_address,
    displayName: r.display_name,
    imap: { host: r.imap_host || MAILBOX_DEFAULTS.imap_host, port: r.imap_port || MAILBOX_DEFAULTS.imap_port },
    smtp: { host: r.smtp_host || MAILBOX_DEFAULTS.smtp_host, port: r.smtp_port || MAILBOX_DEFAULTS.smtp_port },
    password: decryptSecret(r.encrypted_password),
  };
}

export function buildImapConfig(m: ResolvedMailbox) {
  return { host: m.imap.host, port: m.imap.port, secure: true, auth: { user: m.address, pass: m.password } };
}

export function buildSmtpConfig(m: ResolvedMailbox) {
  return { host: m.smtp.host, port: m.smtp.port, secure: true, auth: { user: m.address, pass: m.password } };
}
