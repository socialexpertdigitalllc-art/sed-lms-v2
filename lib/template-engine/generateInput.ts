/**
 * Body schema for POST /api/template-engine/generate, extracted from the
 * route so it's unit-testable. Phase 3 change: the wizard never shows
 * tool/model pickers — v2 ignores gen.tool/gen.model entirely (runnerV2
 * hardcodes Gemini), but the columns are NOT NULL, so they default here.
 * `options` is new: the only supported knob is exclude_people (design §10
 * step 1 "Exclude photos with people", default ON).
 */
import { z } from "zod";
import { GEMINI_PRO_MODEL } from "@/lib/ai-tools/config";

export const generateInputSchema = z.object({
  leadId: z.string().uuid(),
  templateId: z.string().uuid(),
  pages: z.array(z.string().min(1)).min(1),
  tool: z.string().min(1).default("gemini"),
  model: z.string().min(1).default(GEMINI_PRO_MODEL),
  options: z
    .object({ exclude_people: z.boolean().default(true) })
    .default({ exclude_people: true }),
});

export type GenerateInput = z.infer<typeof generateInputSchema>;
