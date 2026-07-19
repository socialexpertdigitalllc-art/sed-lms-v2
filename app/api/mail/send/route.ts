import { NextResponse } from "next/server";
import nodemailer from "nodemailer";
import MailComposer from "nodemailer/lib/mail-composer";
import { requireOwnMailbox } from "@/lib/mail/guard";
import { buildSmtpConfig } from "@/lib/mail/config";
import { appendToSent } from "@/lib/mail/imap";
import { sendMailSchema } from "@/lib/mail/sendSchema";

export const runtime = "nodejs";

function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

export async function POST(req: Request) {
  const auth = await requireOwnMailbox();
  if ("error" in auth) return NextResponse.json({ error: auth.error === 401 ? "Unauthorized" : "No mailbox" }, { status: auth.error });

  const parsed = sendMailSchema.safeParse(await req.json());
  if (!parsed.success) return NextResponse.json({ error: "Invalid input", issues: parsed.error.flatten() }, { status: 422 });
  const input = parsed.data;
  const mailbox = auth.mailbox;

  const from = `"${mailbox.displayName || mailbox.address}" <${mailbox.address}>`;
  const html = `<div style="font-family:Arial,sans-serif;font-size:14px;color:#1a1a1a;white-space:pre-wrap">${escapeHtml(input.body)}</div>`;
  const attachments = input.attachments.map((a) => ({
    filename: a.filename,
    content: Buffer.from(a.contentBase64, "base64"),
    contentType: a.contentType,
  }));
  const mail = { from, to: input.to, cc: input.cc || undefined, subject: input.subject, html, attachments };

  // Send via SMTP.
  try {
    const transport = nodemailer.createTransport(buildSmtpConfig(mailbox));
    await transport.sendMail(mail);
  } catch (e) {
    return NextResponse.json({ error: `Send failed: ${(e as Error).message}` }, { status: 502 });
  }

  // Best-effort: append the raw message to Sent so it shows there. Never fails the send.
  try {
    const raw: Buffer = await new Promise((resolve, reject) => {
      new MailComposer(mail).compile().build((err, message) => (err ? reject(err) : resolve(message)));
    });
    await appendToSent(mailbox, raw);
  } catch {
    // ignore — the message was already delivered
  }

  return NextResponse.json({ ok: true });
}
