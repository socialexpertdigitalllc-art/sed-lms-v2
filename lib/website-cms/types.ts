// Website CMS — the dashboard is the content source for
// socialexpertdigitalllc.com. Row types mirror migration 0081; the
// "public" shapes mirror the website's src/data/content.ts exactly, so
// the site can swap its baked-in data for these responses untouched.

export interface PricingTier {
  name: string;
  price: number;
  priceNote: string;
  billingNote: string;
  features: string[];
  badge?: "Popular" | "Recommended";
}

export interface ServiceFAQ {
  question: string;
  answer: string;
}

export interface MarketComparison {
  label: string;
  marketPrice: string;
  ourPrice: string;
}

export interface IncludedItem {
  title: string;
  text: string;
}

export interface WebsiteServiceRow {
  id: string;
  slug: string;
  name: string;
  short_name: string;
  tagline: string;
  description: string;
  icon: string;
  features: string[];
  tiers: PricingTier[];
  quote_based: boolean;
  starting_at: string | null;
  market_comparison: MarketComparison;
  faqs: ServiceFAQ[];
  pain_heading: string;
  pains: string[];
  included: IncludedItem[];
  sort_order: number;
  active: boolean;
  created_at: string;
  updated_at: string;
}

export interface WebsiteOfferRow {
  id: string;
  title: string;
  banner_text: string;
  service_slug: string | null;
  active: boolean;
  sort_order: number;
  created_at: string;
  updated_at: string;
}

export interface WebsiteCouponRow {
  id: string;
  code: string;
  label: string;
  discount_type: "percent" | "fixed";
  amount: number;
  service_slugs: string[];
  active: boolean;
  expires_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface WebsiteTestimonialRow {
  id: string;
  client_name: string;
  business: string;
  quote: string;
  rating: number;
  approved: boolean;
  sort_order: number;
  created_at: string;
  updated_at: string;
}

export interface WebsitePortfolioRow {
  id: string;
  client_name: string;
  industry: string;
  state: string;
  live_url: string;
  screenshot: string | null;
  featured: boolean;
  active: boolean;
  sort_order: number;
  created_at: string;
  updated_at: string;
}

export interface WebsiteStats {
  sitesLaunched: number;
  activeClients: number;
  statesServed: number;
  yearsActive: number;
}

export interface WebsiteSettingsRow {
  singleton: boolean;
  stats: WebsiteStats;
  revalidate_url: string;
  revalidate_secret: string;
  api_key: string;
  updated_at: string;
}

// ---- Shapes the website consumes (mirror of its content.ts) ----

export interface PublicService {
  slug: string;
  name: string;
  shortName: string;
  tagline: string;
  description: string;
  icon: string;
  features: string[];
  tiers: PricingTier[];
  quoteBased?: boolean;
  startingAt?: string;
  marketComparison: MarketComparison;
  faqs: ServiceFAQ[];
}

export interface PublicServiceDetail {
  painHeading: string;
  pains: string[];
  included: IncludedItem[];
}

export function toPublicService(row: WebsiteServiceRow): PublicService {
  return {
    slug: row.slug,
    name: row.name,
    shortName: row.short_name,
    tagline: row.tagline,
    description: row.description,
    icon: row.icon,
    features: row.features ?? [],
    tiers: row.tiers ?? [],
    ...(row.quote_based ? { quoteBased: true } : {}),
    ...(row.starting_at ? { startingAt: row.starting_at } : {}),
    marketComparison: row.market_comparison ?? { label: "", marketPrice: "", ourPrice: "" },
    faqs: row.faqs ?? [],
  };
}

export function toPublicServiceDetail(row: WebsiteServiceRow): PublicServiceDetail {
  return {
    painHeading: row.pain_heading,
    pains: row.pains ?? [],
    included: row.included ?? [],
  };
}

/** Cache tags the website's /api/revalidate accepts. */
export const WEBSITE_TAGS = ["site-content", "offers", "portfolio", "testimonials", "stats"] as const;
export type WebsiteTag = (typeof WEBSITE_TAGS)[number];
