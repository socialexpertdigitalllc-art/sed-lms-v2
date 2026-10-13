import { escapeHtml } from "@/lib/forms/email";
import { RECEIPT_COMPANY } from "@/lib/receipts/company";
import { formatLongDate, formatMoney, itemDisplayTitle, lineAmount } from "@/lib/receipts/compute";
import type { ReceiptDoc } from "@/lib/receipts/types";

const NAVY = "#1b2a4e";
const MUTED = "#5b6475";

/** The message that carries the receipt PDF. Pure, so it is unit-tested. */
export function buildReceiptEmail(doc: ReceiptDoc): { subject: string; html: string; text: string } {
  const c = RECEIPT_COMPANY;
  const greetingName = (doc.billToName || doc.billToBusiness).split(/\s+/)[0] || "there";
  const total = formatMoney(doc.totals.total);
  const paidOn = formatLongDate(doc.paidOn);
  const subject = `Payment receipt ${doc.receiptNo} from ${c.name}`;

  const rows = doc.items
    .map(
      (i) => `<tr>
          <td style="padding:6px 0;border-bottom:1px solid #e3e7ef;color:#1f2433">${escapeHtml(itemDisplayTitle(i))}</td>
          <td style="padding:6px 0;border-bottom:1px solid #e3e7ef;color:#1f2433;text-align:right;white-space:nowrap">${formatMoney(lineAmount(i))}</td>
        </tr>`
    )
    .join("");

  const html = `<div style="background:#f3f5fa;padding:24px 12px;font-family:Arial,Helvetica,sans-serif">
  <div style="max-width:560px;margin:0 auto;background:#ffffff;border:1px solid #e3e7ef">
    <div style="background:${NAVY};padding:16px 22px">
      <div style="color:#ffffff;font-size:18px;font-weight:bold">${escapeHtml(c.name)}</div>
      <div style="color:#c9d1e6;font-size:11px;letter-spacing:1px;margin-top:2px">PAYMENT RECEIPT</div>
    </div>
    <div style="padding:22px;font-size:14px;line-height:1.55;color:#1f2433">
      <p style="margin:0 0 12px">Hi ${escapeHtml(greetingName)},</p>
      <p style="margin:0 0 16px">Thank you for your payment. Your receipt is attached as a PDF. Here's a summary:</p>
      <table role="presentation" style="width:100%;border-collapse:collapse;font-size:14px">
        ${rows}
        <tr>
          <td style="padding:10px 0 0;font-weight:bold;color:${NAVY}">Total paid</td>
          <td style="padding:10px 0 0;font-weight:bold;color:${NAVY};text-align:right">${total}</td>
        </tr>
      </table>
      <p style="margin:16px 0 0;font-size:13px;color:${MUTED}">
        Receipt ${escapeHtml(doc.receiptNo)} · Paid via ${escapeHtml(doc.paymentMethod)} on ${paidOn}
      </p>
      <p style="margin:18px 0 0">If anything looks wrong, just reply to this email.</p>
      <p style="margin:12px 0 0">Thanks again,<br>${escapeHtml(c.name)}</p>
    </div>
    <div style="border-top:1px solid #e3e7ef;padding:12px 22px;font-size:12px;color:${MUTED}">
      ${escapeHtml(c.email)} · ${escapeHtml(c.phone)} · ${escapeHtml(c.website)}
    </div>
  </div>
</div>`;

  const text = [
    `Hi ${greetingName},`,
    "",
    "Thank you for your payment. Your receipt is attached as a PDF.",
    "",
    ...doc.items.map((i) => `${itemDisplayTitle(i)}: ${formatMoney(lineAmount(i))}`),
    `Total paid: ${total}`,
    "",
    `Receipt ${doc.receiptNo} · Paid via ${doc.paymentMethod} on ${paidOn}`,
    "",
    "If anything looks wrong, just reply to this email.",
    "",
    "Thanks again,",
    c.name,
    `${c.email} · ${c.phone} · ${c.website}`,
  ].join("\n");

  return { subject, html, text };
}
