export type MailboxStatus = "unverified" | "verified" | "error";

/** Row shape of public.company_mailboxes (including the secret column). */
export interface CompanyMailboxRow {
  id: string;
  user_id: string;
  email_address: string;
  display_name: string;
  imap_host: string | null;
  imap_port: number | null;
  smtp_host: string | null;
  smtp_port: number | null;
  encrypted_password: string;
  status: MailboxStatus;
  last_verified_at: string | null;
  last_error: string | null;
  created_by: string | null;
  created_at: string;
}

/** Decrypted, defaults-applied mailbox handed to send/verify code. Server-only. */
export interface ResolvedMailbox {
  id: string;
  userId: string;
  address: string;
  displayName: string;
  imap: { host: string; port: number };
  smtp: { host: string; port: number };
  password: string;
}

export const MAILBOX_DEFAULTS = {
  imap_host: "imap.hostinger.com",
  imap_port: 993,
  smtp_host: "smtp.hostinger.com",
  smtp_port: 465,
} as const;
