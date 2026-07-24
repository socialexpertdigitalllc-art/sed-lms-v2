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

const enc = (s: string) => new TextEncoder().encode(s);

describe("extractNav (body content list is not claimed as nav)", () => {
  const html = `<html><body>
    <header>
      <nav>
        <ul class="menu">
          <li><a href="index.html">Home</a></li>
          <li><a href="about.html">About</a></li>
        </ul>
      </nav>
    </header>
    <main>
      <ul>
        <li><a href="area-1.html">Area 1</a></li>
        <li><a href="area-2.html">Area 2</a></li>
        <li><a href="area-3.html">Area 3</a></li>
      </ul>
    </main>
  </body></html>`;
  const inv = inventory({ "index.html": enc(html) });
  const { regions, diagnostics } = extractNav(inv);

  it("claims only the header nav, leaves the content list untouched", () => {
    expect(regions).toHaveLength(1);
    expect(regions[0].location).toBe("header");
    const out = inv.pages[0].root.toString();
    expect(out).toContain('<li><a href="area-1.html">Area 1</a></li>');
    expect(diagnostics.some((d) => d.code === "nav_candidate_skipped" && d.level === "info")).toBe(true);
  });
});

describe("extractNav (multi-column footer with distinct link sets)", () => {
  const html = `<html><body>
    <footer>
      <ul class="menu">
        <li><a href="services.html">Services</a></li>
        <li><a href="pricing.html">Pricing</a></li>
      </ul>
      <ul class="menu">
        <li><a href="privacy.html">Privacy</a></li>
        <li><a href="terms.html">Terms</a></li>
      </ul>
      <ul class="menu">
        <li><a href="facebook.html">Facebook</a></li>
        <li><a href="twitter.html">Twitter</a></li>
      </ul>
    </footer>
  </body></html>`;
  const inv = inventory({ "index.html": enc(html) });
  const { regions, diagnostics } = extractNav(inv);

  it("claims only the first column, leaves the rest untouched, and warns nav_ambiguous", () => {
    expect(regions).toHaveLength(1);
    expect(regions[0].location).toBe("footer");
    const out = inv.pages[0].root.toString();
    expect(out).toContain('<li><a href="privacy.html">Privacy</a></li>');
    expect(out).toContain('<li><a href="facebook.html">Facebook</a></li>');
    expect(diagnostics.filter((d) => d.code === "nav_ambiguous" && d.level === "warn")).toHaveLength(2);
  });
});

describe("extractNav (dropdown submenu degrades to nav_not_detected)", () => {
  const html = `<html><body>
    <header>
      <nav>
        <ul class="menu">
          <li><a href="services.html">Services</a>
            <ul>
              <li><a href="services-a.html">Service A</a></li>
              <li><a href="services-b.html">Service B</a></li>
            </ul>
          </li>
          <li><a href="about.html">About</a></li>
          <li><a href="contact.html">Contact</a></li>
        </ul>
      </nav>
    </header>
  </body></html>`;
  const inv = inventory({ "index.html": enc(html) });
  const { regions, diagnostics } = extractNav(inv);

  it("claims nothing and warns nav_not_detected", () => {
    expect(regions).toHaveLength(0);
    expect(diagnostics.some((d) => d.code === "nav_not_detected" && d.level === "warn")).toBe(true);
  });
});

describe("extractNav (active-class stripped from shared fragment)", () => {
  const html = `<html><body>
    <header>
      <nav>
        <ul class="menu">
          <li class="active"><a class="active" href="index.html">Home</a></li>
          <li><a href="about.html">About</a></li>
        </ul>
      </nav>
    </header>
  </body></html>`;
  const inv = inventory({ "index.html": enc(html) });
  const { regions, fragments } = extractNav(inv);

  it("fragment carries no active/current class token", () => {
    const frag = fragments[regions[0].fragment];
    expect(frag).not.toMatch(/\bactive\b/i);
  });
});
