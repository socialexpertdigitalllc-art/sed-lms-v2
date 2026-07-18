import { ImapFlow } from "imapflow";
import nodemailer from "nodemailer";
import { createAdminClient } from "@/lib/supabase/admin";
import { resolveMailboxRow, buildImapConfig, buildSmtpConfig } from "@/lib/mail/config";
import type { CompanyMailboxRow, ResolvedMailbox } from "@/lib/mail/types";

// Server-only seams. Every downstream feature (contract send, future inbox)
// builds on getMailboxById / getMailboxForUser and nothing else.

export async function getMailboxById(id: string): Promise<ResolvedMailbox | null> {
  const admin = createAdminClient();
  const { data } = await admin.from("company_mailboxes").select("*").eq("id", id).maybeSingle();
  return data ? resolveMailboxRow(data as CompanyMailboxRow) : null;
}

/** The earliest verified mailbox owned by a user (the send-from identity). */
export async function getMailboxForUser(userId: string): Promise<ResolvedMailbox | null> {
  const admin = createAdminClient();
  const { data } = await admin
    .from("company_mailboxes")
    .select("*")
    .eq("user_id", userId)
    .eq("status", "verified")
    .order("created_at", { ascending: true })
    .limit(1)
    .maybeSingle();
  return data ? resolveMailboxRow(data as CompanyMailboxRow) : null;
}

/** Real IMAP + SMTP login. Both must succeed. Never throws — returns a result. */
export async function verifyMailboxCredentials(
  m: ResolvedMailbox
): Promise<{ ok: true } | { ok: false; error: string }> {
  const imap = new ImapFlow({ ...buildImapConfig(m), logger: false });
  try {
    await imap.connect();
    await imap.logout();
  } catch (e) {
    try { await imap.close(); } catch { /* already closed */ }
    return { ok: false, error: `IMAP: ${(e as Error).message}` };
  }
  try {
    const transport = nodemailer.createTransport(buildSmtpConfig(m));
    await transport.verify();
  } catch (e) {
    return { ok: false, error: `SMTP: ${(e as Error).message}` };
  }
  return { ok: true };
}
