import { NextResponse } from "next/server";
import nodemailer from "nodemailer";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getUserPermissions } from "@/lib/permissions/resolver";
import { getMailboxById } from "@/lib/mail/mailbox";
import { buildSmtpConfig } from "@/lib/mail/config";
import { renderContractPdf } from "@/lib/contracts/ContractDocument";
import { signatureRenderArgs } from "@/lib/contracts/pdf";
import type { ContractRow } from "@/lib/contracts/types";

export const runtime = "nodejs";

function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

export async function POST(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const perms = await getUserPermissions(user.id);
  if (!perms.has("contracts.send")) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const admin = createAdminClient();
  const { data: c } = await admin.from("contracts").select("*").eq("id", id).maybeSingle();
  if (!c) return NextResponse.json({ error: "Contract not found" }, { status: 404 });
  const contract = c as ContractRow;

  if (contract.status === "sent") return NextResponse.json({ error: "Contract already sent — resend creates a new record" }, { status: 409 });
  if (!contract.mailbox_id) return NextResponse.json({ error: "No sending mailbox on this contract" }, { status: 409 });
  if (!contract.recipient_email) return NextResponse.json({ error: "No recipient email on this contract" }, { status: 409 });

  const mailbox = await getMailboxById(contract.mailbox_id);
  if (!mailbox) return NextResponse.json({ error: "Sending mailbox not found" }, { status: 409 });

  // Render the final PDF from the immutable snapshot.
  const sig = await signatureRenderArgs(contract.created_by ?? user.id);
  const pdf = await renderContractPdf(
    {
      business_name: contract.business_name, business_phone: contract.business_phone,
      business_email: contract.business_email, one_time_price: contract.one_time_price,
      yearly_price: contract.yearly_price, agent_name: contract.agent_name, contract_date: contract.contract_date,
    },
    sig,
    contract.template_key
  );

  // Send via SMTP. Any failure leaves the contract a draft (never a false "sent").
  try {
    const transport = nodemailer.createTransport(buildSmtpConfig(mailbox));
    const bodyHtml = `<div style="font-family:Arial,sans-serif;font-size:14px;color:#1a1a1a;white-space:pre-wrap">${escapeHtml(contract.message_body || "Please find your contract attached.")}</div>`;
    await transport.sendMail({
      from: `"${mailbox.displayName || mailbox.address}" <${mailbox.address}>`,
      to: contract.recipient_email,
      subject: `Website Services Agreement — ${contract.business_name}`,
      html: bodyHtml,
      attachments: [{ filename: `contract-${contract.business_name.replace(/[^a-z0-9]+/gi, "-").toLowerCase()}.pdf`, content: pdf, contentType: "application/pdf" }],
    });
  } catch (e) {
    return NextResponse.json({ error: `Send failed: ${(e as Error).message}` }, { status: 502 });
  }

  // Persist the PDF and flip to sent only after a successful send.
  const pdfPath = `${contract.id}.pdf`;
  await admin.storage.from("contracts").upload(pdfPath, new Uint8Array(pdf), { contentType: "application/pdf", upsert: true });

  const sentAt = new Date().toISOString();
  const { data: updated, error } = await admin
    .from("contracts")
    .update({ status: "sent", sent_at: sentAt, pdf_path: pdfPath })
    .eq("id", contract.id)
    .eq("status", "draft") // guard against a concurrent double-send
    .select("*")
    .single();
  if (error || !updated) return NextResponse.json({ error: "Sent, but failed to record status — check the contract" }, { status: 500 });

  await admin.from("activity_log").insert({
    user_id: user.id, action: "contract.sent", entity_type: "contract", entity_id: contract.id,
    new_value: { recipient_email: contract.recipient_email, sent_at: sentAt },
  });

  return NextResponse.json({ contract: updated });
}
