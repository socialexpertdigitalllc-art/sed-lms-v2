import { z } from "zod";

export const createContractSchema = z.object({
  lead_id: z.string().uuid(),
  mailbox_id: z.string().uuid(),
  template_key: z.string().trim().min(1).max(60).default("standard"),
  google_template_id: z.string().uuid().nullable().optional(),
  message_body: z.string().trim().max(5000).default(""),
  // Agent-editable pricing (discounts). Omitted = keep the lead's value.
  one_time_price: z.number().nonnegative().nullable().optional(),
  yearly_price: z.number().nonnegative().nullable().optional(),
  // "upload": the agent's own PDF (sent as multipart) instead of a template.
  source: z.enum(["template", "upload"]).default("template"),
  // How the client pays (lib/contracts/payments.ts). Validated against the
  // final one-time price by parsePaymentPlan, not here.
  payment_plan: z.unknown().optional(),
});
export type CreateContractInput = z.infer<typeof createContractSchema>;

export const signatureSchema = z.object({
  typed_name: z.string().trim().max(120).nullable().optional(),
});
