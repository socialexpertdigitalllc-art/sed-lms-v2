import { describe, it, expect } from "vitest";
import { inventory } from "@/lib/site-studio/compiler/inventory";
import { extractNav } from "@/lib/site-studio/compiler/nav";
import { fixtureFiles } from "./helpers/siteStudioFixtures";
import { NAV_HREF, NAV_TITLE } from "@/lib/site-studio/tokens";

describe("extractNav (plumberpro)", () => {
  const inv = inventory(fixtureFiles("plumberpro"));
  const { regions, fragments } = extractNav(inv);

  it("finds header and footer nav regions shared across pages", () => {
    const locations = regions.map((r) => r.location).sort();
    expect(locations).toEqual(["footer", "header"]);
  });
  it("fragment carries nav tokens", () => {
    const frag = fragments[regions[0].fragment];
    expect(frag).toContain(NAV_TITLE);
    expect(frag).toContain(NAV_HREF);
  });
  it("every page now holds nav markers, no literal menu items", () => {
    for (const p of inv.pages) {
      const html = p.root.toString();
      expect(html).toContain("<!--@nav:");
      expect(html).not.toMatch(/<li><a href="about\.html">About<\/a><\/li>/);
    }
  });
});

describe("extractNav (bakery — div nav is not detected)", () => {
  const inv = inventory(fixtureFiles("bakery"));
  const { regions, diagnostics } = extractNav(inv);
  it("detects nothing and warns", () => {
    expect(regions).toHaveLength(0);
    expect(diagnostics.some((d) => d.code === "nav_not_detected" && d.level === "warn")).toBe(true);
  });
});
