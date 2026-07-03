import { z } from "zod";

// POST body for the streaming generate endpoint.
export const generateSchema = z.object({
  prompt: z.string().trim().min(20, "Prompt is too short"),
  model: z.string().trim().min(1),
  maxTokens: z.coerce.number().int().min(256).max(64000),
  temperature: z.coerce.number().min(0).max(2).default(0.7),
});

const fileSchema = z.object({
  name: z.string().trim().min(1).max(120),
  code: z.string(),
});

// POST body for the save endpoint (called after a stream completes).
export const saveGenerationSchema = z.object({
  files: z.array(fileSchema).min(1, "No files to save").max(40),
  model: z.string().trim().min(1),
  businessName: z.string().trim().max(200).optional().nullable(),
  leadId: z.string().uuid().optional().nullable(),
  numPages: z.coerce.number().int().min(0).optional().nullable(),
  pageTypes: z.array(z.string()).optional().default([]),
  tokensUsed: z.coerce.number().int().min(0).optional().nullable(),
  totalTimeMs: z.coerce.number().int().min(0).optional().nullable(),
  inputTimeMs: z.coerce.number().int().min(0).optional().nullable(),
  aiTimeMs: z.coerce.number().int().min(0).optional().nullable(),
  status: z.enum(["success", "failed"]).default("success"),
  errors: z.string().optional().nullable(),
});

export type GenerateBody = z.infer<typeof generateSchema>;
export type SaveGenerationBody = z.infer<typeof saveGenerationSchema>;
