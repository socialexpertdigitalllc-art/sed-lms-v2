import { z } from "zod";

// Editors submit the full row shape; jsonb columns arrive as parsed JSON.

const tierSchema = z.object({
  name: z.string().trim().min(1).max(80),
  price: z.number().min(0).max(1_000_000),
  priceNote: z.string().trim().max(60).default(""),
  billingNote: z.string().trim().max(300).default(""),
  features: z.array(z.string().trim().min(1).max(300)).max(40).default([]),
  badge: z.enum(["Popular", "Recommended"]).optional(),
});

const faqSchema = z.object({
  question: z.string().trim().min(1).max(300),
  answer: z.string().trim().min(1).max(2000),
});

const includedSchema = z.object({
  title: z.string().trim().min(1).max(200),
  text: z.string().trim().min(1).max(1000),
});

export const serviceSchema = z.object({
  slug: z
    .string()
    .trim()
    .min(1)
    .max(80)
    .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, "lowercase letters, digits and dashes"),
  name: z.string().trim().min(1).max(120),
  short_name: z.string().trim().max(80).default(""),
  tagline: z.string().trim().max(300).default(""),
  description: z.string().trim().max(2000).default(""),
  icon: z.string().trim().max(60).default(""),
  features: z.array(z.string().trim().min(1).max(300)).max(60).default([]),
  tiers: z.array(tierSchema).max(10).default([]),
  quote_based: z.boolean().default(false),
  starting_at: z.string().trim().max(120).nullish().transform((v) => (v ? v : null)),
  market_comparison: z
    .object({
      label: z.string().trim().max(200).default(""),
      marketPrice: z.string().trim().max(120).default(""),
      ourPrice: z.string().trim().max(120).default(""),
    })
    .default({ label: "", marketPrice: "", ourPrice: "" }),
  faqs: z.array(faqSchema).max(30).default([]),
  pain_heading: z.string().trim().max(200).default(""),
  pains: z.array(z.string().trim().min(1).max(400)).max(20).default([]),
  included: z.array(includedSchema).max(30).default([]),
  sort_order: z.number().int().min(0).max(10_000).default(0),
  active: z.boolean().default(true),
});

export const offerSchema = z.object({
  title: z.string().trim().min(1).max(200),
  banner_text: z.string().trim().max(300).default(""),
  service_slug: z.string().trim().max(80).nullish().transform((v) => (v ? v : null)),
  active: z.boolean().default(false),
  sort_order: z.number().int().min(0).max(10_000).default(0),
});

export const couponSchema = z.object({
  code: z
    .string()
    .trim()
    .min(2)
    .max(64)
    .regex(/^[A-Za-z0-9_-]+$/, "letters, digits, dashes and underscores")
    .transform((v) => v.toUpperCase()),
  label: z.string().trim().max(200).default(""),
  discount_type: z.enum(["percent", "fixed"]).default("percent"),
  amount: z.number().min(0).max(1_000_000),
  service_slugs: z.array(z.string().trim().min(1).max(80)).max(20).default([]),
  active: z.boolean().default(true),
  expires_at: z.string().trim().nullish().transform((v) => (v ? v : null)),
});

export const testimonialSchema = z.object({
  client_name: z.string().trim().min(1).max(120),
  business: z.string().trim().max(200).default(""),
  quote: z.string().trim().min(1).max(2000),
  rating: z.number().int().min(1).max(5).default(5),
  approved: z.boolean().default(false),
  sort_order: z.number().int().min(0).max(10_000).default(0),
});

export const portfolioSchema = z.object({
  client_name: z.string().trim().min(1).max(200),
  industry: z.string().trim().max(120).default(""),
  state: z.string().trim().max(60).default(""),
  live_url: z.string().trim().max(500).default(""),
  screenshot: z.string().trim().max(500).nullish().transform((v) => (v ? v : null)),
  featured: z.boolean().default(false),
  active: z.boolean().default(true),
  sort_order: z.number().int().min(0).max(10_000).default(0),
});

export const settingsSchema = z.object({
  stats: z.object({
    sitesLaunched: z.number().int().min(0).max(1_000_000),
    activeClients: z.number().int().min(0).max(1_000_000),
    statesServed: z.number().int().min(0).max(50),
    yearsActive: z.number().int().min(0).max(200),
  }),
  revalidate_url: z
    .string()
    .trim()
    .max(500)
    .refine((v) => v === "" || /^https?:\/\//.test(v), "must be an http(s) URL"),
  revalidate_secret: z.string().trim().max(200),
  api_key: z.string().trim().max(200),
});
