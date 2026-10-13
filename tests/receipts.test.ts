// @vitest-environment node
import { describe, it, expect } from "vitest";
import {
  addMonths,
  billToName,
  computeTotals,
  formatLongDate,
  formatMoney,
  formatShortDate,
  itemDisplayTitle,
  paymentLine,
  prefillItems,
  projectRef,
  receiptDocFromRow,
  receiptFileName,
  suggestNotes,
} from "@/lib/receipts/compute";
import { createReceiptSchema, sendReceiptSchema } from "@/lib/receipts/schema";
import type { ReceiptItem, ReceiptRow } from "@/lib/receipts/types";

const build: ReceiptItem = { title: "Custom Website Development", description: "", term: "one_time", qty: 1, rate: 200 };
const hosting: ReceiptItem = { title: "Domain, Hosting & Maintenance", description: "", term: "yearly", qty: 1, rate: 50 };
const seo: ReceiptItem = { title: "Local SEO", description: "", term: "monthly", qty: 1, rate: 200 };

describe("computeTotals", () => {
  it("sums lines like the sample receipt ($200 + $50 + $200 = $450)", () => {
    expect(computeTotals([build, hosting, seo])).toEqual({ subtotal: 450, discount: 0, taxRate: 0, taxAmount: 0, total: 450 });
  });
  it("applies a flat discount before tax", () => {
    const t = computeTotals([build, hosting], 50, 10);
    expect(t.subtotal).toBe(250);
    expect(t.taxAmount).toBe(20); // 10% of 200
    expect(t.total).toBe(220);
  });
  it("clamps a discount larger than the subtotal and rounds to cents", () => {
    expect(computeTotals([build], 999).total).toBe(0);
    expect(computeTotals([{ ...build, qty: 3, rate: 33.333 }]).subtotal).toBe(100);
  });
});

describe("dates", () => {
  it("adds months and clamps to the end of shorter months", () => {
    expect(addMonths("2026-10-13", 1)).toBe("2026-11-13");
    expect(addMonths("2026-10-13", 12)).toBe("2027-10-13");
    expect(addMonths("2027-01-31", 1)).toBe("2027-02-28");
    expect(addMonths("2028-02-29", 12)).toBe("2029-02-28");
  });
  it("formats calendar days without a timezone shift", () => {
    expect(formatLongDate("2026-10-13")).toBe("October 13, 2026");
    expect(formatLongDate("2026-01-01")).toBe("January 1, 2026");
    expect(formatShortDate("2026-10-13")).toBe("Oct 13, 2026");
  });
});

describe("prefillItems", () => {
  const lead = {
    site_type: "Custom Website",
    num_webpages: 5,
    price_quoted: 549,
    yearly_price: "$99",
    add_ons: [
      { id: "a", label: "Logo design", price: 50 },
      { id: "b", label: "Unpriced add-on", price: null },
    ],
  };
  it("turns the lead's prices into one-time, yearly and add-on lines", () => {
    const items = prefillItems(lead);
    expect(items.map((i) => [i.title, i.term, i.rate])).toEqual([
      ["Custom Website Development", "one_time", 549],
      ["Domain, Hosting & Maintenance", "yearly", 99],
      ["Logo design", "one_time", 50],
    ]);
    expect(items[0].description).toContain("5-page");
  });
  it("gives a blank-priced build line when the lead has no prices", () => {
    const items = prefillItems({ site_type: null, num_webpages: null, price_quoted: null, yearly_price: "None", add_ons: null });
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({ title: "Website Development", term: "one_time", rate: 0 });
  });
});

describe("suggestNotes / paymentLine", () => {
  it("states renewal dates and amounts for recurring items", () => {
    const notes = suggestNotes([build, hosting, seo], "2026-10-13");
    expect(notes).toEqual([
      "Domain, Hosting & Maintenance: renews yearly. Next renewal on October 13, 2027 at $50.00.",
      "Local SEO: billed monthly. Next payment of $200.00 is due November 13, 2026.",
      "One-time items are paid in full. Nothing further is due for them.",
    ]);
  });
  it("prints the payment method, optional reference and date", () => {
    expect(paymentLine("Zelle", "8842", "2026-10-13")).toBe("Paid via Zelle (ref 8842) on October 13, 2026.");
    expect(paymentLine("Cash", null, "2026-10-13")).toBe("Paid via Cash on October 13, 2026.");
  });
});

describe("labels", () => {
  it("formats money, titles, refs, names and file names", () => {
    expect(formatMoney(1599)).toBe("$1,599.00");
    expect(itemDisplayTitle(hosting)).toBe("Domain, Hosting & Maintenance (Yearly)");
    expect(projectRef("1a2b3c4d-0000-4000-8000-000000000000")).toBe("WEB-1A2B3C4D");
    expect(billToName({ owner_name: "  ", business_name: "Ace Plumbing" })).toBe("Ace Plumbing");
    expect(billToName({ owner_name: "Dana Ruiz", business_name: "Ace Plumbing" })).toBe("Dana Ruiz");
    expect(receiptFileName("SED-2026-1013-1001", "png")).toBe("receipt-SED-2026-1013-1001.png");
  });
});

describe("createReceiptSchema", () => {
  const valid = {
    bill_to_name: "Dana Ruiz",
    bill_to_business: "Ace Plumbing",
    bill_to_email: " dana@aceplumbing.com ",
    bill_to_phone: "(555) 010-2000",
    project_title: "Digital Services Package",
    items: [build, hosting],
    paid_on: "2026-10-13",
    payment_method: "Zelle",
  };
  it("accepts a valid receipt and trims the email", () => {
    const r = createReceiptSchema.safeParse(valid);
    expect(r.success).toBe(true);
    if (r.success) {
      expect(r.data.bill_to_email).toBe("dana@aceplumbing.com");
      expect(r.data.discount).toBe(0);
      expect(r.data.notes).toEqual([]);
    }
  });
  it("allows a lead with no email", () => {
    expect(createReceiptSchema.safeParse({ ...valid, bill_to_email: "" }).success).toBe(true);
    expect(createReceiptSchema.safeParse({ ...valid, bill_to_email: null }).success).toBe(true);
  });
  it("rejects a bad email, no items, a blank service and a $0 total", () => {
    expect(createReceiptSchema.safeParse({ ...valid, bill_to_email: "not-an-email" }).success).toBe(false);
    expect(createReceiptSchema.safeParse({ ...valid, items: [] }).success).toBe(false);
    expect(createReceiptSchema.safeParse({ ...valid, items: [{ ...build, title: " " }] }).success).toBe(false);
    expect(createReceiptSchema.safeParse({ ...valid, items: [{ ...build, rate: 0 }] }).success).toBe(false);
    expect(createReceiptSchema.safeParse({ ...valid, items: [build], discount: 200 }).success).toBe(false);
  });
  it("rejects an unknown term and a malformed date", () => {
    expect(createReceiptSchema.safeParse({ ...valid, items: [{ ...build, term: "weekly" }] }).success).toBe(false);
    expect(createReceiptSchema.safeParse({ ...valid, paid_on: "10/13/2026" }).success).toBe(false);
  });
  it("send schema trims and validates the address", () => {
    expect(sendReceiptSchema.safeParse({ to: " a@b.co " }).success).toBe(true);
    expect(sendReceiptSchema.safeParse({ to: "nope" }).success).toBe(false);
  });
});

describe("receiptDocFromRow", () => {
  it("coerces numeric columns that Postgres returns as strings", () => {
    const row = {
      id: "r1", lead_id: "l1", receipt_no: "SED-2026-1013-1001", created_by: null,
      bill_to_name: "Dana", bill_to_business: "Ace", bill_to_email: null, bill_to_phone: null,
      project_title: "Digital Services Package", project_ref: "WEB-1A2B3C4D",
      items: [{ ...build, rate: "200.00" as unknown as number, qty: "1" as unknown as number }],
      subtotal: "200.00", discount: "0.00", tax_rate: "0.00", tax_amount: "0.00", total: "200.00", currency: "USD",
      paid_on: "2026-10-13", payment_method: "Cash", payment_reference: null, notes: [], signer_name: "",
      pdf_path: null, sent_to: null, sent_at: null, sent_by: null, mailbox_id: null,
      created_at: "2026-10-13T15:04:05.000Z",
    } satisfies ReceiptRow;
    const doc = receiptDocFromRow(row);
    expect(doc.totals.total).toBe(200);
    expect(doc.items[0].rate).toBe(200);
    expect(doc.issuedOn).toBe("2026-10-13");
  });
});

describe("buildReceiptEmail", () => {
  it("summarizes the receipt and escapes client-supplied text", async () => {
    const { buildReceiptEmail } = await import("@/lib/receipts/email");
    const items = [build, { ...hosting, title: "Hosting <b>& care</b>" }];
    const { subject, html, text } = buildReceiptEmail({
      receiptNo: "SED-2026-1013-1001", issuedOn: "2026-10-13",
      billToName: "Dana Ruiz", billToBusiness: "Ace", billToEmail: "dana@example.com", billToPhone: null,
      projectTitle: "Digital Services Package", projectRef: "WEB-1A2B3C4D",
      items, totals: computeTotals(items), paidOn: "2026-10-13",
      paymentMethod: "Zelle", paymentReference: null, notes: [], signerName: "",
    });
    expect(subject).toBe("Payment receipt SED-2026-1013-1001 from Social Expert Digital LLC");
    expect(html).toContain("Hi Dana,");
    expect(html).toContain("$250.00");
    expect(html).not.toContain("<b>& care</b>");
    expect(html).toContain("Hosting &lt;b&gt;&amp; care&lt;/b&gt;");
    expect(text).toContain("Total paid: $250.00");
  });
});
