// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from "vitest";

// The public content API for socialexpertdigitalllc.com: key gating, the
// exact shapes the website's content.ts expects, and coupon judgement.

const holder = vi.hoisted(() => ({
  apiKey: "",
  stats: { sitesLaunched: 100, activeClients: 80, statesServed: 12, yearsActive: 2 },
  rows: {} as Record<string, { data: unknown; error: unknown }>,
}));

vi.mock("@/lib/website-cms/settings", () => ({
  getWebsiteSettings: async () => ({
    singleton: true,
    stats: holder.stats,
    revalidate_url: "",
    revalidate_secret: "",
    api_key: holder.apiKey,
    updated_at: "",
  }),
  invalidateWebsiteSettingsCache: () => {},
}));

vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => ({
    from: (table: string) => {
      const result = () => holder.rows[table] ?? { data: [], error: null };
      const b: Record<string, unknown> = {};
      for (const m of ["select", "eq", "order"]) b[m] = () => b;
      b.maybeSingle = async () => {
        const r = result();
        const data = Array.isArray(r.data) ? (r.data[0] ?? null) : r.data;
        return { data, error: r.error };
      };
      b.then = (resolve: (v: unknown) => unknown) => Promise.resolve(result()).then(resolve);
      return b;
    },
  }),
}));

import { GET as siteContent } from "@/app/api/public/site-content/route";
import { GET as offers } from "@/app/api/public/offers/route";
import { GET as stats } from "@/app/api/public/stats/route";
import { POST as validateCoupon } from "@/app/api/public/coupons/validate/route";
import { judgeCoupon } from "@/lib/website-cms/public";
import type { WebsiteCouponRow } from "@/lib/website-cms/types";

const get = (headers: Record<string, string> = {}) => new Request("http://t/x", { headers });
const post = (body: unknown, headers: Record<string, string> = {}) =>
  new Request("http://t/x", {
    method: "POST",
    headers: { "content-type": "application/json", ...headers },
    body: JSON.stringify(body),
  });

const serviceRow = {
  id: "s1",
  slug: "website-development",
  name: "Website Development",
  short_name: "Websites",
  tagline: "t",
  description: "d",
  icon: "globe",
  features: ["a"],
  tiers: [{ name: "Tier 1", price: 249, priceNote: "one-time", billingNote: "b", features: ["x"] }],
  quote_based: false,
  starting_at: null,
  market_comparison: { label: "l", marketPrice: "$2500", ourPrice: "$249" },
  faqs: [{ question: "q", answer: "a" }],
  pain_heading: "Sound familiar?",
  pains: ["p1"],
  included: [{ title: "i", text: "t" }],
  sort_order: 0,
  active: true,
  created_at: "",
  updated_at: "",
};

beforeEach(() => {
  holder.apiKey = "";
  holder.rows = {
    website_services: { data: [serviceRow], error: null },
    website_offers: { data: [{ id: "o1", title: "T", banner_text: "B", service_slug: null, active: true, sort_order: 0 }], error: null },
    website_coupons: { data: [], error: null },
  };
});

describe("public key gate", () => {
  it("reads are open while no key is configured", async () => {
    expect((await siteContent(get())).status).toBe(200);
  });
  it("a configured key is demanded and checked", async () => {
    holder.apiKey = "k1";
    expect((await siteContent(get())).status).toBe(401);
    expect((await siteContent(get({ "x-sed-key": "wrong" }))).status).toBe(401);
    expect((await siteContent(get({ "x-sed-key": "k1" }))).status).toBe(200);
  });
});

describe("GET /api/public/site-content", () => {
  it("serves the website's content.ts shape (camelCase, details keyed by slug)", async () => {
    const res = await siteContent(get());
    const json = await res.json();
    expect(json.services).toHaveLength(1);
    const s = json.services[0];
    expect(s).toMatchObject({
      slug: "website-development",
      shortName: "Websites",
      marketComparison: { ourPrice: "$249" },
    });
    expect(s.quote_based).toBeUndefined();
    expect(s.quoteBased).toBeUndefined(); // only present when true
    expect(json.serviceDetails["website-development"]).toEqual({
      painHeading: "Sound familiar?",
      pains: ["p1"],
      included: [{ title: "i", text: "t" }],
    });
  });

  it("a missing table (migration not applied) answers 503, never 500", async () => {
    holder.rows.website_services = { data: null, error: { message: "relation does not exist" } };
    expect((await siteContent(get())).status).toBe(503);
  });
});

describe("GET /api/public/offers and /stats", () => {
  it("offers come back camelCased", async () => {
    const json = await (await offers(get())).json();
    expect(json.offers).toEqual([{ title: "T", bannerText: "B", serviceSlug: null, active: true }]);
  });
  it("stats come from website_settings", async () => {
    const json = await (await stats(get())).json();
    expect(json.stats.sitesLaunched).toBe(100);
  });
});

describe("coupon validation", () => {
  const coupon = (over: Partial<WebsiteCouponRow> = {}): WebsiteCouponRow => ({
    id: "c1",
    code: "SAVE20",
    label: "20% off",
    discount_type: "percent",
    amount: 20,
    service_slugs: [],
    active: true,
    expires_at: null,
    created_at: "",
    updated_at: "",
    ...over,
  });

  it("judges active/expiry/service scope", () => {
    expect(judgeCoupon(coupon(), null)).toMatchObject({ valid: true, label: "20% off", amount: 20 });
    expect(judgeCoupon(coupon({ active: false }), null)).toMatchObject({ valid: false });
    expect(judgeCoupon(coupon({ expires_at: "2000-01-01T00:00:00Z" }), null)).toMatchObject({ valid: false });
    expect(judgeCoupon(coupon({ service_slugs: ["seo"] }), "seo")).toMatchObject({ valid: true });
    expect(judgeCoupon(coupon({ service_slugs: ["seo"] }), "website-development")).toMatchObject({ valid: false });
    expect(judgeCoupon(coupon({ service_slugs: ["seo"] }), null)).toMatchObject({ valid: false });
    expect(judgeCoupon(null, null)).toMatchObject({ valid: false });
  });

  it("falls back to a generated label", () => {
    expect(judgeCoupon(coupon({ label: "", discount_type: "fixed", amount: 50 }), null)).toMatchObject({
      valid: true,
      label: "$50 off",
    });
  });

  it("the route uppercases the code and answers invalid for unknown codes", async () => {
    const res = await validateCoupon(post({ code: "nope", service: null }));
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ valid: false });
  });

  it("an empty code is a 422", async () => {
    expect((await validateCoupon(post({ code: "" }))).status).toBe(422);
  });
});
