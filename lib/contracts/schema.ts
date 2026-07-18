import { z } from "zod";

export const createContractSchema = z.object({
  lead_id: z.string().uuid(),
  mailbox_id: z.string().uuid(),
  template_key: z.string().trim().min(1).max(60).default("standard"),
  message_body: z.string().trim().max(5000).default(""),
});
export type CreateContractInput = z.infer<typeof createContractSchema>;

export const signatureSchema = z.object({
  typed_name: z.string().trim().max(120).nullable().optional(),
});
