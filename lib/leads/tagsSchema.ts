import { z } from "zod";
import { TAG_COLOR_KEYS } from "@/lib/leads/tagColors";

const colorSchema = z
  .string()
  .refine((c) => TAG_COLOR_KEYS.includes(c), "Unknown color");

export const createTagSchema = z.object({
  name: z.string().trim().min(1).max(40),
  color: colorSchema.default("slate"),
});

export const updateTagSchema = z
  .object({
    name: z.string().trim().min(1).max(40).optional(),
    color: colorSchema.optional(),
  })
  .refine((o) => o.name !== undefined || o.color !== undefined, "Nothing to update");

export const leadTagsSchema = z.object({
  tagIds: z.array(z.string().uuid()),
});

/** POST /api/tags/shares — share the caller's tags with a user or department. */
export const tagShareSchema = z.object({
  target_type: z.enum(["user", "department"]),
  target_id: z.string().uuid(),
});

export type CreateTagInput = z.infer<typeof createTagSchema>;
