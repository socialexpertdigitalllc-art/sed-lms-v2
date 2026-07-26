import { describe, it, expect } from "vitest";
import { resolveSubdomain, InvalidSlugError } from "@/lib/site-studio/deploy/slug";

const DA_DOMAIN = "da900.is.cc";

describe("resolveSubdomain — one live site per lead", () => {
  it("a website_link that parses to a subdomain of daDomain redeploys onto that EXACT sub, reused:true", () => {
    const result = resolveSubdomain({
      leadWebsiteLink: `https://acme-plumbing.${DA_DOMAIN}/`,
      siteSlug: "totally-different-slug-abc123",
      daDomain: DA_DOMAIN,
    });
    expect(result).toEqual({ sub: "acme-plumbing", reused: true });
  });

  it("a website_link pointing at an unrelated (the client's own) domain is ignored — falls back to siteSlug", () => {
    const result = resolveSubdomain({
      leadWebsiteLink: "https://www.acmeplumbing.com/",
      siteSlug: "acme-plumbing-x1y2z3",
      daDomain: DA_DOMAIN,
    });
    expect(result).toEqual({ sub: "acme-plumbing-x1y2z3", reused: false });
  });

  it("no website_link at all falls back to siteSlug, reused:false", () => {
    const result = resolveSubdomain({
      leadWebsiteLink: null,
      siteSlug: "acme-plumbing-x1y2z3",
      daDomain: DA_DOMAIN,
    });
    expect(result).toEqual({ sub: "acme-plumbing-x1y2z3", reused: false });
  });

  it("an empty-string website_link is treated the same as no link", () => {
    const result = resolveSubdomain({ leadWebsiteLink: "", siteSlug: "acme-x1y2z3", daDomain: DA_DOMAIN });
    expect(result).toEqual({ sub: "acme-x1y2z3", reused: false });
  });

  it("the bare DA domain itself (no subdomain part) is not a client site — falls back to siteSlug", () => {
    const result = resolveSubdomain({
      leadWebsiteLink: `https://${DA_DOMAIN}/`,
      siteSlug: "acme-x1y2z3",
      daDomain: DA_DOMAIN,
    });
    expect(result).toEqual({ sub: "acme-x1y2z3", reused: false });
  });

  it("the returned sub is lowercased even when siteSlug carries upper case", () => {
    const result = resolveSubdomain({ leadWebsiteLink: null, siteSlug: "ACME-Plumbing-X1Y2Z3", daDomain: DA_DOMAIN });
    expect(result.sub).toBe("acme-plumbing-x1y2z3");
  });

  it("non alphanumeric-or-hyphen characters in siteSlug are collapsed to single hyphens", () => {
    const result = resolveSubdomain({ leadWebsiteLink: null, siteSlug: "acme & sons!! plumbing__co", daDomain: DA_DOMAIN });
    expect(result.sub).toMatch(/^[a-z0-9-]+$/);
    expect(result.sub).not.toMatch(/--/);
  });

  it("never leaves a leading or trailing hyphen", () => {
    const result = resolveSubdomain({ leadWebsiteLink: null, siteSlug: "--acme-plumbing--", daDomain: DA_DOMAIN });
    expect(result.sub[0]).not.toBe("-");
    expect(result.sub[result.sub.length - 1]).not.toBe("-");
  });

  it("caps the sub at 63 chars and re-strips any trailing hyphen the truncation exposes", () => {
    // engine.ts derives site_slug as `${slugify(business_name)}-${randomBase36(6)}`,
    // and slugify alone caps at 60 chars, so the full site_slug can run past 63.
    const longSlug = "a".repeat(58) + "-" + "b".repeat(20); // 79 chars, hyphen sits right at the cut point
    const result = resolveSubdomain({ leadWebsiteLink: null, siteSlug: longSlug, daDomain: DA_DOMAIN });
    expect(result.sub.length).toBeLessThanOrEqual(63);
    expect(result.sub[result.sub.length - 1]).not.toBe("-");
  });

  it("refuses loudly on an empty siteSlug with no website_link — never produces an empty subdomain", () => {
    expect(() => resolveSubdomain({ leadWebsiteLink: null, siteSlug: "", daDomain: DA_DOMAIN })).toThrow(InvalidSlugError);
  });

  it("refuses loudly on a siteSlug that is pure punctuation (sanitizes to empty)", () => {
    expect(() => resolveSubdomain({ leadWebsiteLink: null, siteSlug: "!!!___...", daDomain: DA_DOMAIN })).toThrow(InvalidSlugError);
  });

  it("refuses on a null/undefined siteSlug with no website_link", () => {
    expect(() => resolveSubdomain({ leadWebsiteLink: undefined, siteSlug: null, daDomain: DA_DOMAIN })).toThrow(InvalidSlugError);
  });

  it("uses the kept subFromWebsiteLink to parse — a nested subdomain of a client site is not a redeploy target", () => {
    const result = resolveSubdomain({
      leadWebsiteLink: `https://staging.acme-plumbing.${DA_DOMAIN}/`,
      siteSlug: "acme-plumbing-x1y2z3",
      daDomain: DA_DOMAIN,
    });
    expect(result).toEqual({ sub: "acme-plumbing-x1y2z3", reused: false });
  });
});
