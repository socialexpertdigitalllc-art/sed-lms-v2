import { z } from "zod";
import { PAYMENT_CATEGORIES } from "@/lib/payments/types";

const httpsUrl = z.string().trim().url().refine((u) => u.startsWith("https://"), "URL must be https");

export const paymentLinkSchema = z.object({
  label: z.string().trim().min(1).max(120),
  amount: z.number().positive().max(999999.99),
  category: z.enum(PAYMENT_CATEGORIES),
  url: httpsUrl,
  notes: z.string().trim().max(1000).nullable().optional(),
});

export const paymentLinkPatchSchema = z.object({
  label: z.string().trim().min(1).max(120).optional(),
  amount: z.number().positive().max(999999.99).optional(),
  category: z.enum(PAYMENT_CATEGORIES).optional(),
  url: httpsUrl.optional(),
  notes: z.string().trim().max(1000).nullable().optional(),
  is_active: z.boolean().optional(),
  sort: z.number().int().optional(),
});
export type PaymentLinkInput = z.infer<typeof paymentLinkSchema>;
