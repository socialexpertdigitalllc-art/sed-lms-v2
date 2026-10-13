// Pure receipt helpers: money, dates, totals, prefill and suggested notes.
// No server or React imports, so the modal and the routes share one source of
// truth (the server always recomputes totals; it never trusts the client's).

import type { Lead } from "@/lib/leads/types";
import { parsePrice } from "@/lib/contracts/merge";
import {
  TERM_LABEL,
  type ReceiptDoc,
  type ReceiptItem,
  type ReceiptRow,
  type ReceiptTerm,
  type ReceiptTotals,
} from "@/lib/receipts/types";

export function round2(n: number): number {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}

export function lineAmount(item: Pick<ReceiptItem, "qty" | "rate">): number {
  return round2(item.qty * item.rate);
}

/** Discount is a flat amount (clamped to the subtotal); tax applies after it. */
export function computeTotals(items: ReceiptItem[], discount = 0, taxRate = 0): ReceiptTotals {
  const subtotal = round2(items.reduce((sum, i) => sum + lineAmount(i), 0));
  const d = round2(Math.min(Math.max(discount, 0), subtotal));
  const rate = Math.min(Math.max(taxRate, 0), 100);
  const taxAmount = round2(((subtotal - d) * rate) / 100);
  return { subtotal, discount: d, taxRate: rate, taxAmount, total: round2(subtotal - d + taxAmount) };
}

const USD = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" });
export function formatMoney(n: number): string {
  return USD.format(n);
}

/** "One-time", "Monthly", "Yearly". */
export function termLabel(term: ReceiptTerm): string {
  return TERM_LABEL[term];
}

/** "Custom Website Development (One-Time)" — the term rides on the title, as on the sample. */
export function itemDisplayTitle(item: Pick<ReceiptItem, "title" | "term">): string {
  return `${item.title} (${termLabel(item.term)})`;
}

// ---- Dates. Receipts deal in calendar days (YYYY-MM-DD), never instants. ----

const ISO_DAY = /^(\d{4})-(\d{2})-(\d{2})$/;

function parseDay(iso: string): { y: number; m: number; d: number } {
  const match = ISO_DAY.exec(iso);
  if (!match) throw new Error(`Not a YYYY-MM-DD date: ${iso}`);
  return { y: Number(match[1]), m: Number(match[2]), d: Number(match[3]) };
}

/** Add months, clamping to the last day of the target month (Jan 31 + 1 → Feb 28). */
export function addMonths(iso: string, months: number): string {
  const { y, m, d } = parseDay(iso);
  const target = new Date(Date.UTC(y, m - 1 + months, 1));
  const lastDay = new Date(Date.UTC(target.getUTCFullYear(), target.getUTCMonth() + 1, 0)).getUTCDate();
  target.setUTCDate(Math.min(d, lastDay));
  return target.toISOString().slice(0, 10);
}

/** "October 13, 2026". */
export function formatLongDate(iso: string): string {
  const { y, m, d } = parseDay(iso);
  return new Date(Date.UTC(y, m - 1, d)).toLocaleDateString("en-US", {
    month: "long",
    day: "numeric",
    year: "numeric",
    timeZone: "UTC",
  });
}

/** "Oct 13, 2026". */
export function formatShortDate(iso: string): string {
  const { y, m, d } = parseDay(iso.slice(0, 10));
  return new Date(Date.UTC(y, m - 1, d)).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    timeZone: "UTC",
  });
}

/** Today's calendar date where the code runs (the browser, for the modal's default). */
export function todayIso(now: Date = new Date()): string {
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, "0");
  const d = String(now.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

// ---- Prefill from the lead ----

const SITE_TYPE_TITLE: Record<string, string> = {
  "Custom Website": "Custom Website Development",
  Redesign: "Website Redesign",
  "E-Commerce": "E-Commerce Website Development",
  "Landing Page": "Landing Page Design & Build",
};

/** Stable per lead; matches the "#1a2b3c4d" id shown on the lead page. */
export function projectRef(leadId: string): string {
  return `WEB-${leadId.slice(0, 8).toUpperCase()}`;
}

export function billToName(lead: Pick<Lead, "owner_name" | "business_name">): string {
  return (lead.owner_name ?? "").trim() || lead.business_name;
}

/**
 * The lead's own pricing as receipt lines: the build at the quoted one-time
 * price, the yearly plan if there is one, and each priced add-on. Staff edit
 * from here; a lead with no prices yields a single blank line to fill in.
 */
export function prefillItems(
  lead: Pick<Lead, "site_type" | "num_webpages" | "price_quoted" | "yearly_price" | "add_ons">
): ReceiptItem[] {
  const items: ReceiptItem[] = [];
  const pages = lead.num_webpages && lead.num_webpages > 0 ? lead.num_webpages : null;

  items.push({
    title: SITE_TYPE_TITLE[lead.site_type ?? ""] ?? "Website Development",
    description: pages
      ? `Design, development and launch of a ${pages}-page website, built mobile-first with on-page SEO and a working contact form.`
      : "Design, development and launch of a custom website, built mobile-first with on-page SEO and a working contact form.",
    term: "one_time",
    qty: 1,
    rate: parsePrice(lead.price_quoted) ?? 0,
  });

  const yearly = parsePrice(lead.yearly_price);
  if (yearly) {
    items.push({
      title: "Domain, Hosting & Maintenance",
      description: "Domain renewal, managed hosting, SSL certificate and ongoing maintenance for one year.",
      term: "yearly",
      qty: 1,
      rate: yearly,
    });
  }

  for (const addOn of lead.add_ons ?? []) {
    const price = parsePrice(addOn.price);
    if (!addOn.label?.trim() || !price) continue;
    items.push({ title: addOn.label.trim(), description: "", term: "one_time", qty: 1, rate: price });
  }

  return items;
}

// ---- Coverage notes ----

/**
 * One line per recurring item saying when it renews and for how much, plus a
 * line for one-time items. Staff can edit these before the receipt is issued.
 */
export function suggestNotes(items: ReceiptItem[], paidOn: string): string[] {
  const notes: string[] = [];
  for (const item of items) {
    if (!item.title.trim()) continue;
    const amount = formatMoney(lineAmount(item));
    if (item.term === "yearly") {
      notes.push(`${item.title}: renews yearly. Next renewal on ${formatLongDate(addMonths(paidOn, 12))} at ${amount}.`);
    } else if (item.term === "monthly") {
      notes.push(`${item.title}: billed monthly. Next payment of ${amount} is due ${formatLongDate(addMonths(paidOn, 1))}.`);
    }
  }
  if (items.some((i) => i.term === "one_time" && i.title.trim())) {
    notes.push("One-time items are paid in full. Nothing further is due for them.");
  }
  return notes;
}

/** "Paid via Zelle (ref 8842) on October 13, 2026." — always printed, never edited. */
export function paymentLine(method: string, reference: string | null, paidOn: string): string {
  const ref = reference?.trim() ? ` (ref ${reference.trim()})` : "";
  return `Paid via ${method}${ref} on ${formatLongDate(paidOn)}.`;
}

// ---- Row → printable document ----

export function receiptDocFromRow(row: ReceiptRow): ReceiptDoc {
  const items = (row.items ?? []).map((i) => ({ ...i, qty: Number(i.qty), rate: Number(i.rate) }));
  return {
    receiptNo: row.receipt_no,
    issuedOn: row.created_at.slice(0, 10),
    billToName: row.bill_to_name,
    billToBusiness: row.bill_to_business,
    billToEmail: row.bill_to_email,
    billToPhone: row.bill_to_phone,
    projectTitle: row.project_title,
    projectRef: row.project_ref,
    items,
    totals: {
      subtotal: Number(row.subtotal),
      discount: Number(row.discount),
      taxRate: Number(row.tax_rate),
      taxAmount: Number(row.tax_amount),
      total: Number(row.total),
    },
    paidOn: row.paid_on,
    paymentMethod: row.payment_method,
    paymentReference: row.payment_reference,
    notes: row.notes ?? [],
    signerName: row.signer_name,
  };
}

/** File name a client will see: "receipt-SED-2026-1013-1001.pdf". */
export function receiptFileName(receiptNo: string, ext: "pdf" | "png"): string {
  return `receipt-${receiptNo.replace(/[^A-Za-z0-9-]+/g, "-")}.${ext}`;
}
