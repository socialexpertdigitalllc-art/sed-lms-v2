import { z } from "zod";
import { LEAD_STATUSES, SITE_TYPES } from "./types";

/** Empty string / undefined → null, then validate with `inner` (which must allow null). */
const optional = (inner: z.ZodTypeAny) =>
  z.preprocess((v) => (v === "" || v === undefined ? null : v), inner);

const optStr = optional(z.string().nullable());
const optNum = optional(z.coerce.number().nullable());
const optInt = optional(z.coerce.number().int().nullable());

export const leadFieldsSchema = z.object({
  business_name: z.string().trim().min(1, "Business name is required"),
  status: z.enum(LEAD_STATUSES),
  agent_id: optional(z.string().uuid().nullable()),

  business_phone: optStr,
  business_email: optStr,
  business_profile_link: optStr,
  website_link: optStr,
  logo_link: optStr,
  map_embed_link: optStr,

  site_type: optional(z.enum(SITE_TYPES).nullable()),
  platform: optStr,
  services: z.array(z.string()).nullable().optional(),
  service_areas: z.array(z.string()).nullable().optional(),
  has_service_areas: z.boolean().nullable().optional(),
  client_experience: optInt,
  num_webpages: optInt,
  specify_pages: z.array(z.string()).nullable().optional(),
  color_scheme: optStr,

  price_quoted: optNum,
  yearly_price: optStr,
  follow_up_time: optStr,
  direct_line_saved: z.boolean().nullable().optional(),
  fresh_or_followup: optStr,
  reference_link: optStr,
  image_links: z.array(z.string()).nullable().optional(),
  rating: optional(z.coerce.number().int().min(1).max(10).nullable()),
  comments: optStr,

  design_reference_links: z.array(z.string().url()).max(3).nullable().optional(),
  add_ons: z
    .array(z.object({ id: z.string(), label: z.string(), price: z.number().nullable() }))
    .nullable()
    .optional(),
  no_email: z.boolean().optional(),
  logo_via_sms: z.boolean().optional(),
  color_same_as_logo: z.boolean().optional(),
  closed_by: z.string().uuid().nullable().optional(),
});

export const createLeadSchema = leadFieldsSchema;
export const updateLeadSchema = leadFieldsSchema.partial();

export type LeadFields = z.infer<typeof leadFieldsSchema>;
export type CreateLeadInput = z.input<typeof createLeadSchema>;
