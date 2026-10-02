import type { z } from "zod";
import {
  serviceSchema,
  offerSchema,
  couponSchema,
  testimonialSchema,
  portfolioSchema,
} from "./schema";
import type { WebsiteTag } from "./types";

// One registry drives the whole CRUD API: /api/website/<collection>[/<id>].
// `tags` is what gets revalidated on the live site after a save; coupons
// have none because the site checks them live, never from the ISR cache.

export interface WebsiteCollection {
  table: string;
  schema: z.ZodType<Record<string, unknown>>;
  tags: WebsiteTag[];
  orderBy: { column: string; ascending: boolean }[];
}

export const WEBSITE_COLLECTIONS: Record<string, WebsiteCollection> = {
  services: {
    table: "website_services",
    schema: serviceSchema,
    tags: ["site-content"],
    orderBy: [
      { column: "sort_order", ascending: true },
      { column: "created_at", ascending: true },
    ],
  },
  offers: {
    table: "website_offers",
    schema: offerSchema,
    tags: ["offers"],
    orderBy: [
      { column: "sort_order", ascending: true },
      { column: "created_at", ascending: true },
    ],
  },
  coupons: {
    table: "website_coupons",
    schema: couponSchema,
    tags: [],
    orderBy: [{ column: "created_at", ascending: false }],
  },
  testimonials: {
    table: "website_testimonials",
    schema: testimonialSchema,
    tags: ["testimonials"],
    orderBy: [
      { column: "sort_order", ascending: true },
      { column: "created_at", ascending: true },
    ],
  },
  portfolio: {
    table: "website_portfolio",
    schema: portfolioSchema,
    tags: ["portfolio"],
    orderBy: [
      { column: "featured", ascending: false },
      { column: "sort_order", ascending: true },
      { column: "created_at", ascending: true },
    ],
  },
};
