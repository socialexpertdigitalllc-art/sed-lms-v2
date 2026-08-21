import { z } from "zod";
import { FU_STATUSES } from "./followups";
import { LEAD_STATUSES } from "./types";

const opt = <T extends z.ZodTypeAny>(inner: T) =>
  z.preprocess((v) => (v === "" || v === undefined ? null : v), inner);

export const logFollowUpSchema = z.object({
  fu_status: z.enum(FU_STATUSES),
  comments: opt(z.string().nullable()),
  next_follow_up_time: opt(z.string().nullable()),
  /** Strict boolean: a "specific time" badge must never come from a truthy string. */
  is_specific_time: z.boolean().optional(),
  status_change: opt(z.enum(LEAD_STATUSES).nullable()),
});
export type LogFollowUpInput = z.infer<typeof logFollowUpSchema>;
