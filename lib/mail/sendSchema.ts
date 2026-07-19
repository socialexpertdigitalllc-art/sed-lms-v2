import { z } from "zod";

export const sendMailSchema = z.object({
  to: z.string().trim().email().max(320),
  cc: z.string().trim().max(2000).optional().default(""),
  subject: z.string().trim().max(500).default(""),
  body: z.string().max(100_000).default(""),
  attachments: z
    .array(
      z.object({
        filename: z.string().trim().min(1).max(255),
        contentBase64: z.string().max(15_000_000),
        contentType: z.string().trim().max(200).default("application/octet-stream"),
      })
    )
    .max(10)
    .optional()
    .default([]),
});
export type SendMailInput = z.infer<typeof sendMailSchema>;
