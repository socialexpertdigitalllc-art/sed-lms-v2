import { z } from "zod";
import { TOOL_IDS } from "./config";

const variableSchema = z.object({
  key: z.string().regex(/^[a-zA-Z][a-zA-Z0-9_]*$/, "key must be a valid identifier"),
  label: z.string().trim().min(1),
  type: z.enum(["text", "textarea", "number", "list"]),
  fallback: z.string(),
  lead_column: z.string().min(1).nullable(),
  join: z.string(),
});

const settingsSchema = z.object({
  max_tokens: z.number().int().min(256).max(64000),
  temperature: z.number().min(0).max(2),
  default_pages: z.number().int().min(1).max(20),
  auto_download: z.boolean(),
  auto_generate: z.boolean(),
  auto_engine: z
    .object({ provider: z.enum(TOOL_IDS as [string, ...string[]]), model: z.string().min(1) })
    .nullable(),
  ready_required: z.array(z.string()),
});

export const wgeConfigSchema = z.object({
  system_prompt: z.string().trim().min(10),
  prompt_template: z.string().trim().min(20),
  variables: z.array(variableSchema).min(1).max(60),
  settings: settingsSchema,
});

export type WgeConfigInput = z.infer<typeof wgeConfigSchema>;
