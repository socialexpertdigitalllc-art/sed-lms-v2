import type { createAdminClient } from "@/lib/supabase/admin";
import { services, offers, portfolio } from "./snapshot/content";
import { serviceDetails } from "./snapshot/serviceDetails";

// Seeds the CMS tables from the website's baked-in content snapshot
// (lib/website-cms/snapshot/, copied verbatim from sed-llc-website
// src/data/). Only ever fills EMPTY tables — rerunning after edits
// changes nothing, so the button is always safe to press.

type Admin = ReturnType<typeof createAdminClient>;

async function isEmpty(admin: Admin, table: string): Promise<boolean> {
  const { count, error } = await admin.from(table).select("*", { count: "exact", head: true });
  if (error) throw new Error(`${table}: ${error.message}`);
  return (count ?? 0) === 0;
}

export async function seedWebsiteCms(admin: Admin): Promise<{ seeded: string[]; skipped: string[] }> {
  const seeded: string[] = [];
  const skipped: string[] = [];

  if (await isEmpty(admin, "website_services")) {
    const rows = services.map((s, i) => {
      const detail = serviceDetails[s.slug];
      return {
        slug: s.slug,
        name: s.name,
        short_name: s.shortName,
        tagline: s.tagline,
        description: s.description,
        icon: s.icon,
        features: s.features,
        tiers: s.tiers,
        quote_based: s.quoteBased ?? false,
        starting_at: s.startingAt ?? null,
        market_comparison: s.marketComparison,
        faqs: s.faqs,
        pain_heading: detail?.painHeading ?? "",
        pains: detail?.pains ?? [],
        included: detail?.included ?? [],
        sort_order: i,
        active: true,
      };
    });
    const { error } = await admin.from("website_services").insert(rows);
    if (error) throw new Error(`website_services: ${error.message}`);
    seeded.push("services");
  } else skipped.push("services");

  if (await isEmpty(admin, "website_offers")) {
    const rows = offers.map((o, i) => ({
      title: o.title,
      banner_text: o.bannerText,
      service_slug: o.serviceSlug,
      active: o.active,
      sort_order: i,
    }));
    if (rows.length > 0) {
      const { error } = await admin.from("website_offers").insert(rows);
      if (error) throw new Error(`website_offers: ${error.message}`);
    }
    seeded.push("offers");
  } else skipped.push("offers");

  if (await isEmpty(admin, "website_portfolio")) {
    const rows = portfolio.map((p, i) => ({
      client_name: p.clientName,
      industry: p.industry,
      state: p.state,
      live_url: p.liveUrl,
      screenshot: p.screenshot ?? null,
      featured: p.featured,
      active: true,
      sort_order: i,
    }));
    const { error } = await admin.from("website_portfolio").insert(rows);
    if (error) throw new Error(`website_portfolio: ${error.message}`);
    seeded.push("portfolio");
  } else skipped.push("portfolio");

  // Stats need no seeding: the migration default already matches the
  // website snapshot (100 / 80 / 12 / 2).

  return { seeded, skipped };
}
