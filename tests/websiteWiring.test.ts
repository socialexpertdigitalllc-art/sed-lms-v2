// @vitest-environment node
import { describe, it, expect, vi } from "vitest";
import { readFileSync } from "node:fs";

/**
 * The Website CMS only works end-to-end if several files agree — and most of
 * these failures are silent (a missing allowlist entry 307s the website's
 * server-side fetch to /login and the site quietly falls back to its baked-in
 * snapshot forever).
 */

describe("website cms wiring", () => {
  it("the middleware allowlists the public content API", () => {
    const src = readFileSync("lib/supabase/middleware.ts", "utf8");
    expect(src).toMatch(/path\.startsWith\("\/api\/public\/"\)/);
  });

  it("the sidebar links /website behind website.view", () => {
    const src = readFileSync("components/layout/Sidebar.tsx", "utf8");
    expect(src).toMatch(/href: "\/website", label: "Website".*perm: "website\.view"/);
  });

  it("migration 0081 seeds exactly the permission keys the catalog declares", () => {
    const sql = readFileSync("supabase/migrations/0081_website_cms.sql", "utf8");
    expect(sql).toContain("'website.view'");
    expect(sql).toContain("'website.manage'");
    expect(sql).toContain("website_settings");
  });
});

describe("seedWebsiteCms", () => {
  function fakeAdmin(counts: Record<string, number>, inserted: { table: string; rows: unknown[] }[]) {
    return {
      from: (table: string) => ({
        select: () => ({
          then: (resolve: (v: unknown) => unknown) =>
            Promise.resolve({ count: counts[table] ?? 0, error: null }).then(resolve),
        }),
        insert: (rows: unknown[]) => {
          inserted.push({ table, rows });
          return { then: (resolve: (v: unknown) => unknown) => Promise.resolve({ error: null }).then(resolve) };
        },
      }),
    } as never;
  }

  it("fills empty tables from the snapshot, merging service details", async () => {
    const { seedWebsiteCms } = await import("@/lib/website-cms/seed");
    const inserted: { table: string; rows: unknown[] }[] = [];
    const result = await seedWebsiteCms(fakeAdmin({}, inserted));
    expect(result.seeded).toEqual(["services", "offers", "portfolio"]);

    const services = inserted.find((i) => i.table === "website_services")!.rows as Record<string, unknown>[];
    expect(services.length).toBeGreaterThanOrEqual(9);
    const web = services.find((s) => s.slug === "website-development")!;
    expect(web.name).toBe("Website Development");
    expect(Array.isArray(web.tiers) && (web.tiers as unknown[]).length).toBe(3);
    // detail fields merged from serviceDetails snapshot
    expect((web.pains as unknown[]).length).toBeGreaterThan(0);
    expect((web.included as unknown[]).length).toBeGreaterThan(0);

    const portfolio = inserted.find((i) => i.table === "website_portfolio")!.rows as unknown[];
    expect(portfolio.length).toBeGreaterThanOrEqual(40);
  });

  it("never touches a table that already has rows", async () => {
    vi.resetModules();
    const { seedWebsiteCms } = await import("@/lib/website-cms/seed");
    const inserted: { table: string; rows: unknown[] }[] = [];
    const result = await seedWebsiteCms(
      fakeAdmin({ website_services: 9, website_offers: 1, website_portfolio: 51 }, inserted)
    );
    expect(result.seeded).toEqual([]);
    expect(result.skipped).toEqual(["services", "offers", "portfolio"]);
    expect(inserted).toEqual([]);
  });
});
