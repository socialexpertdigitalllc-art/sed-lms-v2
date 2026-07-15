import { z } from "zod";

/**
 * Content model — the editable source of truth for a generated site (spec §6).
 *
 * One Gemini Pro call produces this JSON; the operator edits it; whole-file
 * regeneration and the verification gates all consume it, which is what keeps a
 * single phone number / service list / testimonial set consistent across every
 * page. Deliberately structured-but-lenient: `.min(1)` only where an empty value
 * would break the site (identity name, at least one service, each service's
 * image query), permissive elsewhere so a good-faith planner response is never
 * rejected over a trivial omission. Unknown keys are stripped (zod default).
 */

export const serviceSchema = z.object({
  key: z.string().min(1), // slug — reused as the image slot id and service_key
  name: z.string().min(1),
  short: z.string(),
  long: z.string(),
  bullets: z.array(z.string()).default([]),
  image_query: z.string().min(1), // required: the image slot is built from this
});

export const imageBriefSchema = z.object({
  slot_id: z.string().min(1),
  kind: z.string().min(1), // 'hero' | 'service' | 'gallery' | 'about' (kept loose)
  query: z.string().min(1),
  must_show: z.string().optional(),
  avoid: z.string().optional(),
});

export const identitySchema = z.object({
  name: z.string().min(1),
  tagline: z.string().default(""),
  positioning: z.string().default(""),
  phone: z.string().optional(),
  email: z.string().optional(),
  areas: z.array(z.string()).default([]),
  // Gemini may emit the years as a number (20) or a string ("20+"); accept both.
  years: z.union([z.number(), z.string()]).optional(),
  license_line: z.string().optional(),
});

export const heroSchema = z.object({
  eyebrow: z.string().default(""),
  headline_parts: z.array(z.string()).default([]),
  subcopy: z.string().default(""),
  cta_primary: z.string().default(""),
  cta_secondary: z.string().default(""),
});

export const statSchema = z.object({
  value: z.union([z.string(), z.number()]),
  label: z.string(),
});

export const testimonialSchema = z.object({
  quote: z.string(),
  name: z.string(),
  meta: z.string().default(""),
  initials: z.string().default(""),
});

export const faqSchema = z.object({
  q: z.string(),
  a: z.string(),
});

export const aboutSchema = z.object({
  story: z.string().default(""),
  why_us: z.array(z.string()).default([]),
});

export const pageSchema = z.object({
  title: z.string(),
  meta_description: z.string(),
  sections: z.record(z.string(), z.unknown()).optional(),
});

export const contentModelSchema = z.object({
  identity: identitySchema,
  hero: heroSchema,
  services: z.array(serviceSchema).min(1), // an empty site is never valid
  stats: z.array(statSchema).default([]),
  testimonials: z.array(testimonialSchema).default([]),
  faq: z.array(faqSchema).default([]),
  about: aboutSchema,
  pages: z.record(z.string(), pageSchema),
  image_briefs: z.array(imageBriefSchema).default([]),
});

export type ContentModel = z.infer<typeof contentModelSchema>;
export type Service = z.infer<typeof serviceSchema>;
export type ImageBrief = z.infer<typeof imageBriefSchema>;

/**
 * A minimal schema-valid model to seed the operator's editor before the planner
 * runs (or if they choose to write copy by hand). One placeholder service keeps
 * it valid without pretending to be real content.
 */
export function emptyContentModel(name: string): ContentModel {
  const n = name.trim() || "New Business";
  return {
    identity: { name: n, tagline: "", positioning: "", areas: [] },
    hero: { eyebrow: "", headline_parts: [], subcopy: "", cta_primary: "", cta_secondary: "" },
    services: [
      { key: "service-1", name: "Service", short: "", long: "", bullets: [], image_query: `${n} service` },
    ],
    stats: [],
    testimonials: [],
    faq: [],
    about: { story: "", why_us: [] },
    pages: { "index.html": { title: n, meta_description: "" } },
    image_briefs: [],
  };
}
