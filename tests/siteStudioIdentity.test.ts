import { describe, it, expect } from "vitest";
import { parse } from "node-html-parser";
import { inventory, Inventory } from "@/lib/site-studio/compiler/inventory";
import { extractIdentity } from "@/lib/site-studio/compiler/identity";
import { fixtureFiles } from "./helpers/siteStudioFixtures";

const buildInv = (html: string): Inventory => ({
  pages: [{ file: "index.html", id: "index", kind: "home", root: parse(html) }],
  assets: {},
  diagnostics: [],
});

describe("extractIdentity (plumberpro)", () => {
  const inv = inventory(fixtureFiles("plumberpro"));
  const { identity, diagnostics } = extractIdentity(inv);
  const all = inv.pages.map((p) => p.root.toString()).join("\n");

  it("captures the sample values", () => {
    expect(identity.business_name).toBe("PlumberPro");
    expect(identity.phone).toBe("(512) 555-0147");
    expect(identity.email).toBe("help@plumberpro.com");
    expect(identity.map_embed).toContain("google.com/maps");
  });
  it("no raw identity remains in any page", () => {
    expect(all).not.toContain("PlumberPro");
    expect(all).not.toContain("(512) 555-0147");
    expect(all).not.toContain("help@plumberpro.com");
    expect(all).not.toContain("google.com/maps");
  });
  it("tokenized instead", () => {
    expect(all).toContain("{{id:business_name}}");
    expect(all).toContain("{{id:phone}}");
    expect(all).toContain("{{id:email}}");
    expect(all).toContain("{{id:map_embed}}");
  });
  it("warns that name detection is heuristic", () => {
    expect(diagnostics.some((d) => d.code === "identity_name_heuristic" && d.level === "warn")).toBe(true);
  });
});

describe("extractIdentity (brand block detection, Phase 4c Task 5)", () => {
  const html = (bodyExtra = "") => `<html><head><title>Northpoint Remodeling - Beautiful Denver Kitchens</title></head>
<body>
  <header id="np-nav">
    <a href="index.html"><span id="np-logo-dot"></span><span id="np-logo-txt">NORTHPOINT</span></a>
  </header>
  <div id="np-loader"><span>NORTHPOINT</span></div>
  <footer>
    <div><span></span><span>NORTHPOINT</span></div>
    <p>Northpoint Remodeling proudly serves the Denver metro.</p>
    <h3>The Northpoint Guarantee</h3>
  </footer>
  ${bodyExtra}
</body></html>`;

  it("tags the header id=logo wordmark and the footer text-prefix wordmark with {{brand}}, capturing the demo text as the sample", () => {
    const inv = buildInv(html());
    const { identity, brand } = extractIdentity(inv);
    expect(identity.business_name).toBe("Northpoint Remodeling");
    expect(brand?.sample).toBe("NORTHPOINT");
    const out = inv.pages[0].root.toString();
    expect(out.match(/\{\{brand\}\}/g)).toHaveLength(2);
    // the preloader's bare NORTHPOINT (no header/footer landmark) is left alone —
    // out of scope for the header/footer brand block requirement
    expect(out).toContain('<div id="np-loader"><span>NORTHPOINT</span></div>');
    // the footer's full-sentence mention still tokenizes normally as business_name
    expect(out).toContain("{{id:business_name}} proudly serves");
    // "The Northpoint Guarantee" is a normal (non-brand) heading, left for the
    // ordinary text-slot pass — not this identity pass's concern
    expect(out).toContain("<h3>The Northpoint Guarantee</h3>");
  });

  it("preserves attributes on the tagged element", () => {
    const inv = buildInv(html());
    extractIdentity(inv);
    const out = inv.pages[0].root.toString();
    expect(out).toContain('<span id="np-logo-txt">{{brand}}</span>');
    expect(out).toContain('<span id="np-logo-dot"></span>');
  });

  it("a plain exact-name match with a logo class (plumberpro-shaped) is also tagged", () => {
    const inv = buildInv(`<html><head><title>Acme Co | Plumbing</title></head><body>
      <header><a class="logo" href="index.html">Acme Co</a></header>
    </body></html>`);
    const { brand } = extractIdentity(inv);
    expect(brand?.sample).toBe("Acme Co");
    expect(inv.pages[0].root.toString()).toContain('<a class="logo" href="index.html">{{brand}}</a>');
  });

  it("does not tag a decorative empty logo-hook element (nothing to preserve as a sample)", () => {
    const inv = buildInv(html());
    extractIdentity(inv);
    const out = inv.pages[0].root.toString();
    expect(out).toContain('<span id="np-logo-dot"></span>');
  });

  it("a second brand-ish element whose text differs from the first captured sample is left untouched and reported", () => {
    const inv = buildInv(`<html><head><title>Acme Co | Plumbing</title></head><body>
      <header><a class="logo" href="index.html">Acme Co</a></header>
      <footer><span class="brand">Different Text</span></footer>
    </body></html>`);
    const { brand, diagnostics } = extractIdentity(inv);
    expect(brand?.sample).toBe("Acme Co");
    expect(inv.pages[0].root.toString()).toContain("Different Text");
    expect(diagnostics.some((d) => d.code === "identity_brand_mismatch" && d.level === "warn")).toBe(true);
  });

  it("emits no brand at all when no candidate is found", () => {
    const inv = buildInv(`<html><head><title>Acme Co | Plumbing</title></head><body><header><nav></nav></header></body></html>`);
    const { brand } = extractIdentity(inv);
    expect(brand).toBeUndefined();
  });
});

describe("extractIdentity (bakery)", () => {
  const inv = inventory(fixtureFiles("bakery"));
  const { identity } = extractIdentity(inv);
  it("captures year from the copyright line", () => {
    expect(identity.year).toBe("2024");
    expect(inv.pages[0].root.toString()).toContain("{{id:year}}");
  });
  it("does not match the phone inside longer digit runs", () => {
    expect(identity.phone).toBe("(503) 555-0022");
  });
});

describe("extractIdentity (real tel: hrefs, multi-value warns, year ranges, country codes)", () => {
  it("discovers a real E.164 tel: href instead of a synthesized one", () => {
    const inv = buildInv(
      `<html><head><title>Acme</title></head><body><a href="tel:+15125550147">Call</a><p>Call us at (512) 555-0147</p></body></html>`,
    );
    const { identity } = extractIdentity(inv);
    const out = inv.pages[0].root.toString();
    expect(out).not.toContain("tel:+15125550147");
    expect(out).not.toContain("512");
    expect(identity.phone_href).toBe("tel:+15125550147");
  });

  it("warns when multiple distinct phone numbers are found", () => {
    const inv = buildInv(
      `<html><head><title>Acme</title></head><body><p>Call (512) 555-0147 or (512) 555-0148</p></body></html>`,
    );
    const { diagnostics } = extractIdentity(inv);
    expect(diagnostics.some((d) => d.code === "identity_phone_multiple" && d.level === "warn")).toBe(true);
  });

  it("tokenizes only the end year of a copyright range", () => {
    const inv = buildInv(`<html><head><title>Acme</title></head><body><p>© 2019-2024 Acme</p></body></html>`);
    const { identity, diagnostics } = extractIdentity(inv);
    expect(identity.year).toBe("2024");
    expect(inv.pages[0].root.toString()).toContain("2019-{{id:year}}");
    expect(diagnostics.some((d) => d.code === "identity_year_range" && d.level === "warn")).toBe(true);
  });

  it("tokenizes a phone number written with a +1 country code prefix", () => {
    const inv = buildInv(`<html><head><title>Acme</title></head><body><p>Call +1 512-555-0147 today</p></body></html>`);
    extractIdentity(inv);
    const out = inv.pages[0].root.toString();
    expect(out).not.toContain("+1");
    expect(out).toContain("{{id:phone}}");
  });
});
