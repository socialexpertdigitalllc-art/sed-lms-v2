import { z } from "zod";
import { LEAD_CATEGORIES, PRELEAD_STATUSES, SERVICE_OFFERED, SERVICE_TYPE } from "./types";

const optional = (inner: z.ZodTypeAny) =>
  z.preprocess((v) => (v === "" || v === undefined ? null : v), inner);

const optStr = optional(z.string().nullable());
const optNum = optional(z.coerce.number().nullable());

export const preLeadFieldsSchema = z.object({
  business_name: z.string().trim().min(1, "Business name is required"),
  lead_category: z.enum(LEAD_CATEGORIES),
  status: z.enum(PRELEAD_STATUSES),

  phone_number: optStr,
  email: optStr,
  owner_name: optStr,
  google_yelp_link: optStr,
  areas: z.array(z.string()).nullable().optional(),
  services: z.array(z.string()).nullable().optional(),
  service_offered: optional(z.enum(SERVICE_OFFERED).nullable()),
  service_type: optional(z.enum(SERVICE_TYPE).nullable()),
  pricing: optNum,
  follow_up_time: optStr,
  comments: optStr,
});

export const createPreLeadSchema = preLeadFieldsSchema;
export const updatePreLeadSchema = preLeadFieldsSchema.partial();

/** Follow-up action: status (+ optional category change + next follow-up time). */
export const followUpSchema = z.object({
  status: z.enum(PRELEAD_STATUSES),
  lead_category: optional(z.enum(LEAD_CATEGORIES).nullable()),
  follow_up_time: optStr,
});

export type PreLeadFields = z.infer<typeof preLeadFieldsSchema>;
