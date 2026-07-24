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
