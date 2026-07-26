import { describe, it, expect } from "vitest";
import { parse } from "node-html-parser";
import { isTextAsset, tokenizeAssetIdentity } from "@/lib/site-studio/compiler/assetIdentity";
import { Inventory } from "@/lib/site-studio/compiler/inventory";
import { compileTemplate } from "@/lib/site-studio/compiler/compile";
import { fixtureZip } from "./helpers/siteStudioFixtures";

const enc = (s: string) => new TextEncoder().encode(s);
const dec = (b: Uint8Array) => new TextDecoder().decode(b);

const inv = (assets: Record<string, string>): Inventory => ({
  pages: [{ file: "index.html", id: "index", kind: "home", root: parse("<body></body>") }],
  assets: Object.fromEntries(Object.entries(assets).map(([k, v]) => [k, enc(v)])),
  diagnostics: [],
});

describe("isTextAsset", () => {
  it("classifies js/css variants as text", () => {
    expect(isTextAsset("app.js")).toBe(true);
    expect(isTextAsset("widget.mjs")).toBe(true);
    expect(isTextAsset("widget.cjs")).toBe(true);
    expect(isTextAsset("css/site.css")).toBe(true);
  });
  it("does not classify images/fonts as text", () => {
    expect(isTextAsset("img/hero.jpg")).toBe(false);
    expect(isTextAsset("img/logo.PNG")).toBe(false);
    expect(isTextAsset("fonts/brand.woff2")).toBe(false);
    expect(isTextAsset("fonts/brand.ttf")).toBe(false);
  });
});

describe("tokenizeAssetIdentity", () => {
  it("replaces a literal identity occurrence in a .js asset with the shared {{id:*}} token", () => {
    const result = tokenizeAssetIdentity(
      inv({ "app.js": `var phone = "(512) 555-0147";` }),
      { phone: "(512) 555-0147" },
    );
    expect(dec(result.assets["app.js"])).toBe(`var phone = "{{id:phone}}";`);
    expect(result.tokenizedAssets).toEqual(["app.js"]);
  });

  it("replaces every occurrence in the file, not just the first", () => {
    const result = tokenizeAssetIdentity(
      inv({ "app.js": `console.log("Acme"); document.title = "Acme";` }),
      { business_name: "Acme" },
    );
    expect(dec(result.assets["app.js"])).toBe(`console.log("{{id:business_name}}"); document.title = "{{id:business_name}}";`);
  });

  it("tokenizes a .css asset the same way", () => {
    const result = tokenizeAssetIdentity(
      inv({ "site.css": `.badge::before { content: "Acme Corp"; }` }),
      { business_name: "Acme Corp" },
    );
    expect(dec(result.assets["site.css"])).toBe(`.badge::before { content: "{{id:business_name}}"; }`);
    expect(result.tokenizedAssets).toEqual(["site.css"]);
  });

  it("leaves a binary/image asset completely untouched", () => {
    const bytes = new Uint8Array([0xff, 0xd8, 0xff, 1, 2, 3]);
    const rawInv: Inventory = { pages: [], assets: { "img/hero.jpg": bytes }, diagnostics: [] };
    const result = tokenizeAssetIdentity(rawInv, { business_name: "Acme" });
    expect(result.assets["img/hero.jpg"]).toBe(bytes);
    expect(result.tokenizedAssets).toEqual([]);
  });

  it("does not list a text asset with no identity occurrence in tokenizedAssets", () => {
    const result = tokenizeAssetIdentity(inv({ "app.js": `console.log("hello");` }), { business_name: "Acme" });
    expect(result.tokenizedAssets).toEqual([]);
    expect(dec(result.assets["app.js"])).toBe(`console.log("hello");`);
  });

  it("word-bounds business_name/year so a substring of a longer token isn't corrupted", () => {
    const result = tokenizeAssetIdentity(
      inv({ "app.js": `var v = "Acme2024Widgets"; var y = "© 2024";` }),
      { business_name: "Acme", year: "2024" },
    );
    // "Acme" inside "Acme2024Widgets" is NOT a word-bounded match (followed by a digit) — left alone
    expect(dec(result.assets["app.js"])).toContain("Acme2024Widgets");
    // but the standalone "2024" IS tokenized
    expect(dec(result.assets["app.js"])).toContain(`"© {{id:year}}"`);
  });

  it("replaces an href-shaped value (email_href) before the bare value it contains, matching identity.ts's HTML pass order", () => {
    const result = tokenizeAssetIdentity(
      inv({ "app.js": `var link = "mailto:help@acme.com";` }),
      { email: "help@acme.com", email_href: "mailto:help@acme.com" },
    );
    expect(dec(result.assets["app.js"])).toBe(`var link = "{{id:email_href}}";`);
  });
});

describe("asset identity tokenization end to end (gearhead fixture)", () => {
  const result = compileTemplate(fixtureZip("gearhead"), "gearhead");

  it("compiles with zero blockers", () => {
    expect(result.diagnostics.filter((d) => d.level === "blocker")).toEqual([]);
    expect(result.ok).toBe(true);
  });

  it("records the tokenized text assets on the manifest", () => {
    expect(result.template.manifest.tokenizedAssets).toEqual(
      expect.arrayContaining(["js/site.js", "css/site.css"]),
    );
  });

  it("the compiled asset bytes carry the shared {{id:*}} tokens, not the raw demo identity", () => {
    const js = dec(result.template.assets["js/site.js"]);
    expect(js).toContain("{{id:business_name}}");
    expect(js).toContain("{{id:phone}}");
    expect(js).not.toContain("GearHead Garage");
    expect(js).not.toContain("(720) 555-0113");

    const css = dec(result.template.assets["css/site.css"]);
    expect(css).toContain("{{id:business_name}}");
    expect(css).not.toContain("GearHead Garage");
  });

  it("asset_identity_echo does not fire once tokenization has handled the occurrence", () => {
    expect(result.diagnostics.some((d) => d.code === "asset_identity_echo")).toBe(false);
  });
});
