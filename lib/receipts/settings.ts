import { createAdminClient } from "@/lib/supabase/admin";
import { getMailboxById } from "@/lib/mail/mailbox";
import { BILLING_MAILBOX_ADDRESS } from "@/lib/receipts/company";
import type { ResolvedMailbox } from "@/lib/mail/types";

export type ReceiptSettings = {
  /** The fixed signer printed on every receipt. Empty = blank signature line. */
  signerName: string;
  /** Sending mailbox override; null = the verified billing@ mailbox. */
  mailboxId: string | null;
};

const DEFAULTS: ReceiptSettings = { signerName: "", mailboxId: null };

/**
 * Its own query on purpose — NOT getAppSettings(). Before migration 0085 is
 * applied these columns don't exist; selecting them there would error and make
 * the whole app fall back to default branding. Here a missing column only means
 * "no receipt settings yet".
 */
export async function getReceiptSettings(): Promise<ReceiptSettings> {
  const admin = createAdminClient();
  const { data, error } = await admin
    .from("app_settings")
    .select("receipt_signer_name, receipt_mailbox_id")
    .eq("singleton", true)
    .maybeSingle();
  if (error || !data) return DEFAULTS;
  return {
    signerName: (data.receipt_signer_name as string | null) ?? "",
    mailboxId: (data.receipt_mailbox_id as string | null) ?? null,
  };
}

/** Settings mailbox → the verified billing@ mailbox → null (send disabled). */
export async function resolveReceiptMailbox(settings: ReceiptSettings): Promise<ResolvedMailbox | null> {
  if (settings.mailboxId) {
    const m = await getMailboxById(settings.mailboxId);
    if (m) return m;
  }
  const admin = createAdminClient();
  const { data } = await admin
    .from("company_mailboxes")
    .select("id")
    .ilike("email_address", BILLING_MAILBOX_ADDRESS)
    .eq("status", "verified")
    .maybeSingle();
  return data ? getMailboxById(data.id as string) : null;
}

/** The sender address only (never credentials), for the UI. */
export async function receiptSenderAddress(): Promise<string | null> {
  const mailbox = await resolveReceiptMailbox(await getReceiptSettings());
  return mailbox?.address ?? null;
}
