import { z } from "zod";

export const linkMailboxSchema = z.object({
  user_id: z.string().uuid(),
  email_address: z.string().trim().email().max(200),
  display_name: z.string().trim().max(120).default(""),
  password: z.string().min(1).max(500),
  imap_host: z.string().trim().min(1).max(200).optional(),
  imap_port: z.number().int().positive().max(65535).optional(),
  smtp_host: z.string().trim().min(1).max(200).optional(),
  smtp_port: z.number().int().positive().max(65535).optional(),
});
export type LinkMailboxInput = z.infer<typeof linkMailboxSchema>;
