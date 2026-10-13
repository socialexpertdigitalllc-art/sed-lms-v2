import { z } from "zod";
import { RECEIPT_TERMS } from "@/lib/receipts/types";
import { computeTotals } from "@/lib/receipts/compute";

const isoDay = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Use a YYYY-MM-DD date");
const optText = (max: number) => z.string().trim().max(max).nullable().optional();
const isEmail = (v: string) => z.email().safeParse(v).success;
// Trim first, then check the format (a pasted " a@b.com " is still valid).
const email = z.string().trim().max(254).refine(isEmail, "Enter a valid email address");

export const receiptItemSchema = z.object({
  title: z.string().trim().min(1, "Every line needs a service name").max(160),
  description: z.string().trim().max(400).default(""),
  term: z.enum(RECEIPT_TERMS),
  qty: z.number().int().min(1).max(999),
  rate: z.number().min(0).max(999999.99),
});

export const createReceiptSchema = z
  .object({
    bill_to_name: z.string().trim().max(160).default(""),
    bill_to_business: z.string().trim().min(1, "Business name is required").max(200),
    bill_to_email: z
      .string()
      .trim()
      .max(254)
      .refine((v) => v === "" || isEmail(v), "Enter a valid email address")
      .nullable()
      .optional(),
    bill_to_phone: optText(40),
    project_title: z.string().trim().min(1).max(160),
    items: z.array(receiptItemSchema).min(1, "Add at least one service").max(30),
    discount: z.number().min(0).max(999999.99).default(0),
    tax_rate: z.number().min(0).max(100).default(0),
    paid_on: isoDay,
    payment_method: z.string().trim().min(1, "Pick a payment method").max(60),
    payment_reference: optText(120),
    notes: z.array(z.string().trim().min(1).max(300)).max(10).default([]),
  })
  .refine((r) => computeTotals(r.items, r.discount, r.tax_rate).total > 0, {
    message: "The total paid must be more than $0",
    path: ["items"],
  });
export type CreateReceiptInput = z.infer<typeof createReceiptSchema>;

export const sendReceiptSchema = z.object({
  to: email,
});

export const receiptSettingsSchema = z.object({
  signer_name: z.string().trim().max(80),
  mailbox_id: z.uuid().nullable(),
});
