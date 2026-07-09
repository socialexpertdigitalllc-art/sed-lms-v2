import { z } from "zod";
import { FEEDBACK_TYPES } from "@/lib/feedback/types";
export const createFeedbackSchema = z.object({
  type: z.enum(FEEDBACK_TYPES),
  title: z.string().trim().min(1).max(200),
  description: z.string().trim().max(4000).nullable().optional(),
});
export const resolveFeedbackSchema = z.object({ resolution_note: z.string().trim().max(2000).nullable().optional() });
export type CreateFeedbackInput = z.infer<typeof createFeedbackSchema>;
