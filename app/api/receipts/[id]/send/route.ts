import { NextResponse, after } from "next/server";
import nodemailer from "nodemailer";
import MailComposer from "nodemailer/lib/mail-composer";
import { createAdminClient } from "@/lib/supabase/admin";
import { buildSmtpConfig } from "@/lib/mail/config";
import { appendToSent } from "@/lib/mail/imap";
import { requirePermission } from "@/lib/receipts/guard";
import { sendReceiptSchema } from "@/lib/receipts/schema";
import { getReceiptSettings, resolveReceiptMailbox } from "@/lib/receipts/settings";
import { loadReceiptPdf, storeReceiptPdf } from "@/lib/receipts/storage";
import { buildReceiptEmail } from "@/lib/receipts/email";
import { receiptDocFromRow, receiptFileName } from "@/lib/receipts/compute";
import { BILLING_MAILBOX_ADDRESS, RECEIPT_COMPANY } from "@/lib/receipts/company";
import type { ReceiptRow } from "@/lib/receipts/types";

export const runtime = "nodejs";

/**
 * Email a receipt's PDF to the client from the billing mailbox. Resending is
 * allowed (a client may ask again); each send is recorded in activity_log and
 * the row keeps the latest recipient and time.
 */
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const auth = await requirePermission("receipts.send");
  if ("response" in auth) return auth.response;

  const parsed = sendReceiptSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Invalid email address" }, { status: 422 });
  }
  const to = parsed.data.to;

  const admin = createAdminClient();
  const { data } = await admin.from("lead_receipts").select("*").eq("id", id).maybeSingle();
  if (!data) return NextResponse.json({ error: "Receipt not found" }, { status: 404 });
  const receipt = data as ReceiptRow;

  const mailbox = await resolveReceiptMailbox(await getReceiptSettings());
  if (!mailbox) {
    return NextResponse.json(
      { error: `No billing mailbox is linked. Link ${BILLING_MAILBOX_ADDRESS} in Admin → Mail, then try again.` },
      { status: 409 }
    );
  }

  const pdf = await loadReceiptPdf(admin, receipt);
  const doc = receiptDocFromRow(receipt);
  const { subject, html, text } = buildReceiptEmail(doc);
  const mail = {
    from: `"${mailbox.displayName || `${RECEIPT_COMPANY.name} Billing`}" <${mailbox.address}>`,
    to,
    subject,
    html,
    text,
    attachments: [{ filename: receiptFileName(receipt.receipt_no, "pdf"), content: pdf, contentType: "application/pdf" }],
  };

  try {
    // Explicit timeouts: nodemailer's defaults (2 min connect, 10 min socket)
    // would leave the person sending staring at a spinner on a stalled server.
    const transport = nodemailer.createTransport({
      ...buildSmtpConfig(mailbox),
      connectionTimeout: 15_000,
      greetingTimeout: 15_000,
      socketTimeout: 30_000,
    });
    await transport.sendMail(mail);
  } catch (e) {
    return NextResponse.json({ error: `Send failed: ${(e as Error).message}` }, { status: 502 });
  }

  const sentAt = new Date().toISOString();
  const { data: updated } = await admin
    .from("lead_receipts")
    .update({ sent_to: to, sent_at: sentAt, sent_by: auth.userId, mailbox_id: mailbox.id })
    .eq("id", receipt.id)
    .select("*")
    .single();

  await admin.from("activity_log").insert({
    user_id: auth.userId,
    action: "receipt.sent",
    entity_type: "lead",
    entity_id: receipt.lead_id,
    new_value: { receipt_id: receipt.id, receipt_no: receipt.receipt_no, to, from: mailbox.address, sent_at: sentAt },
  });

  // After the response: keep a copy in the billing mailbox's Sent folder, and
  // store the PDF if creation couldn't. Neither may fail or slow the send.
  after(async () => {
    if (!receipt.pdf_path) await storeReceiptPdf(admin, receipt.id, pdf).catch(() => null);
    try {
      const raw: Buffer = await new Promise((resolve, reject) => {
        new MailComposer(mail).compile().build((err, message) => (err ? reject(err) : resolve(message)));
      });
      await appendToSent(mailbox, raw);
    } catch {
      // ignore — the client already has the receipt
    }
  });

  return NextResponse.json({ receipt: (updated as ReceiptRow | null) ?? { ...receipt, sent_to: to, sent_at: sentAt } });
}
