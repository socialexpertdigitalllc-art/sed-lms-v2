import { describe, it, expect } from "vitest";
import { renderSite } from "@/lib/site-studio/render/renderer";
import { CompiledTemplate, ContentDoc } from "@/lib/site-studio/schema";

const dec = (b: Uint8Array) => new TextDecoder().decode(b);

const tpl: CompiledTemplate = {
  manifest: {
    engine: 3, name: "mini", version: 1,
    identity: { business_name: "Demo Co", phone: "(111) 111-1111" },
    theme: { mode: "css_vars", roles: { brand: { var: "--main", hex: "#112233" } } },
    nav: [{ id: "nav_header", fragment: "nav_header", location: "header" }],
    pages: [
      {
        id: "index", file: "index.html", kind: "home", stampable: false, title_sample: "Demo Co",
        slots: [
          { id: "index_s1", type: "text", sample: "Welcome to Demo Co", html: false, max_chars: 60 },
          { id: "index_i1", type: "image", sample: "img/a.jpg", html: false },
        ],
        repeats: [{
          id: "index_r1", fragment: "index_r1", min: 1, max: 12,
          slots: [{ id: "index_r1_s1", type: "text", sample: "Card A", html: false, max_chars: 40 }],
          samples: [{ index_r1_s1: "Card A" }],
        }],
      },
      { id: "svc", file: "service.html", kind: "service", stampable: true, title_sample: "Service", slots: [{ id: "svc_s1", type: "text", sample: "About this service", html: false, max_chars: 60 }], repeats: [] },
    ],
  },
  pages: {
    "index.html": `<html><head><title>{{title}}</title></head><body><ul><!--@nav:nav_header--></ul><h1>{{slot:index_s1}}</h1><img src="{{img:index_i1}}"><div class="cards"><!--@repeat:index_r1--></div><p>{{id:business_name}} — {{id:phone}}</p><a href="{{link:svc}}">svc</a></body></html>`,
    "service.html": `<html><head><title>{{title}}</title></head><body><ul><!--@nav:nav_header--></ul><p>{{slot:svc_s1}}</p></body></html>`,
  },
  fragments: {
    nav_header: `<li><a href="{{nav:href}}">{{nav:title}}</a></li>`,
    index_r1: `<div class="card">{{slot:index_r1_s1}}</div>`,
  },
  assets: { "css/style.css": new TextEncoder().encode(":root{--main:#112233}\nh1{color:var(--main)}") },
};

const doc: ContentDoc = {
  identity: { business_name: "Acme & Sons", phone: "(303) 555-9999" },
  theme: { brand: "#ff0000" },
  pages: [
    {
      page_id: "index", title: "Acme & Sons | Denver",
      slots: { index_s1: "Denver's <finest> plumbers", index_i1: "img/acme.jpg" },
      repeats: { index_r1: [{ index_r1_s1: "Sewer" }, { index_r1_s1: "Heaters" }] },
    },
    { page_id: "svc", output: "services/sewer.html", nav_title: "Sewer", title: "Sewer Repair", slots: { svc_s1: "We fix sewers." }, repeats: {} },
  ],
};

describe("renderSite", () => {
  const result = renderSite(tpl, doc);
  it("renders ok", () => { expect(result.ok).toBe(true); });
  if (!result.ok) return;
  const index = dec(result.files["index.html"]);

  it("fills identity, escaped slots, images, title", () => {
    expect(index).toContain("Acme &amp; Sons — (303) 555-9999");
    expect(index).toContain("Denver's &lt;finest&gt; plumbers");
    expect(index).toContain(`src="img/acme.jpg"`);
    expect(index).toContain("<title>Acme &amp; Sons | Denver</title>");
  });
  it("stamps repeats once per row", () => {
    expect(index.match(/class="card"/g)).toHaveLength(2);
    expect(index).toContain("Sewer");
    expect(index).toContain("Heaters");
  });
  it("renders nav from built non-stampable pages only", () => {
    expect(index).toContain(`<li><a href="index.html">Acme &amp; Sons | Denver</a></li>`);
    expect(index).not.toContain(`<li><a href="services/sewer.html">`);
  });
  it("resolves internal links to built outputs", () => {
    expect(index).toContain(`href="services/sewer.html"`);
    expect(Object.keys(result.files)).toContain("services/sewer.html");
  });
  it("applies css_vars theme via injected override stylesheet", () => {
    expect(Object.keys(result.files)).toContain("studio-theme.css");
    expect(dec(result.files["studio-theme.css"])).toContain("--main: #ff0000");
    expect(index).toContain(`<link rel="stylesheet" href="studio-theme.css">`);
  });
  it("output contains no leftover tokens or markers", () => {
    for (const f of Object.values(result.files)) expect(dec(f)).not.toMatch(/\{\{|<!--@/);
  });
});

const tplWithNavItems: CompiledTemplate = {
  manifest: {
    engine: 3, name: "mini2", version: 1,
    identity: {},
    theme: { mode: "none", roles: {} },
    nav: [{
      id: "nav_header", fragment: "nav_header", location: "header",
      items: [
        { page_id: "index", href: "index.html", label: "Home" },
        { page_id: "ghost", href: "ghost.html", label: "Ghost" },
        { page_id: "about", href: "about.html", label: "About" },
      ],
    }],
    pages: [
      { id: "index", file: "index.html", kind: "home", stampable: false, title_sample: "Index Title", slots: [], repeats: [] },
      { id: "about", file: "about.html", kind: "about", stampable: false, title_sample: "About Title", slots: [], repeats: [] },
      { id: "extra", file: "extra.html", kind: "generic", stampable: false, title_sample: "Extra Title", slots: [], repeats: [] },
      { id: "svc", file: "service.html", kind: "service", stampable: true, title_sample: "Service Title", slots: [], repeats: [] },
    ],
  },
  pages: {
    "index.html": `<html><body><ul><!--@nav:nav_header--></ul></body></html>`,
    "about.html": `<html><body><ul><!--@nav:nav_header--></ul></body></html>`,
    "extra.html": `<html><body><ul><!--@nav:nav_header--></ul></body></html>`,
    "service.html": `<html><body><ul><!--@nav:nav_header--></ul></body></html>`,
  },
  fragments: { nav_header: `<li><a href="{{nav:href}}">{{nav:title}}</a></li>` },
  assets: {},
};

const docWithNavItems: ContentDoc = {
  identity: {},
  theme: {},
  pages: [
    { page_id: "index", title: "Index Page", slots: {}, repeats: {} },
    { page_id: "about", title: "About Page", slots: {}, repeats: {} },
    { page_id: "extra", title: "Extra Page", slots: {}, repeats: {} },
    { page_id: "svc", title: "Service Page", slots: {}, repeats: {} },
  ],
};

describe("renderSite (nav region with items: order, prune, fan-out)", () => {
  const result = renderSite(tplWithNavItems, docWithNavItems);
  it("renders ok", () => { expect(result.ok).toBe(true); });
  if (!result.ok) return;
  const index = dec(result.files["index.html"]);

  it("renders in region-item order using item labels", () => {
    expect(index).toContain(
      `<li><a href="index.html">Home</a></li><li><a href="about.html">About</a></li>`,
    );
  });
  it("skips a region item whose page_id isn't built", () => {
    expect(index).not.toContain("Ghost");
  });
  it("appends a built non-stampable page not present in items, after the item-ordered ones", () => {
    expect(index).toContain(
      `<li><a href="about.html">About</a></li><li><a href="extra.html">Extra Page</a></li>`,
    );
    expect(index).not.toContain("Service Page");
  });
});

const tplStampableInItems: CompiledTemplate = {
  manifest: {
    engine: 3, name: "mini3", version: 1,
    identity: {},
    theme: { mode: "none", roles: {} },
    nav: [{
      id: "nav_header", fragment: "nav_header", location: "header",
      items: [
        { page_id: "index", href: "index.html", label: "Home" },
        { page_id: "svc", href: "service.html", label: "Our Service" },
      ],
    }],
    pages: [
      { id: "index", file: "index.html", kind: "home", stampable: false, title_sample: "Index Title", slots: [], repeats: [] },
      { id: "svc", file: "service.html", kind: "service", stampable: true, title_sample: "Service Title", slots: [], repeats: [] },
      { id: "extra", file: "extra.html", kind: "generic", stampable: true, title_sample: "Extra Title", slots: [], repeats: [] },
    ],
  },
  pages: {
    "index.html": `<html><body><ul><!--@nav:nav_header--></ul></body></html>`,
    "service.html": `<html><body><ul><!--@nav:nav_header--></ul></body></html>`,
    "extra.html": `<html><body><ul><!--@nav:nav_header--></ul></body></html>`,
  },
  fragments: { nav_header: `<li><a href="{{nav:href}}">{{nav:title}}</a></li>` },
  assets: {},
};

const docStampableInItems: ContentDoc = {
  identity: {},
  theme: {},
  pages: [
    { page_id: "index", title: "Index Page", slots: {}, repeats: {} },
    { page_id: "svc", title: "Service Page", slots: {}, repeats: {} },
    { page_id: "extra", title: "Extra Page", slots: {}, repeats: {} },
  ],
};

describe("renderSite (nav region items honor explicit stampable pages)", () => {
  const result = renderSite(tplStampableInItems, docStampableInItems);
  it("renders ok", () => { expect(result.ok).toBe(true); });
  if (!result.ok) return;
  const index = dec(result.files["index.html"]);

  it("renders a region.items entry whose page is now stampable — nav-linked service pages are the normal case", () => {
    expect(index).toContain(`<li><a href="index.html">Home</a></li><li><a href="service.html">Our Service</a></li>`);
  });
  it("does not fan-out a stampable page that isn't listed in region.items", () => {
    expect(index).not.toContain("Extra Page");
    expect(index).not.toContain("extra.html");
  });
});

describe("renderSite refusals", () => {
  it("refuses and names missing slots", () => {
    const bad: ContentDoc = { ...doc, pages: [{ ...doc.pages[0], slots: { index_i1: "x.jpg" } }] };
    const r = renderSite(tpl, bad);
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.missing).toContainEqual({ page_id: "index", slot_id: "index_s1" });
  });
  it("refuses unknown page ids", () => {
    const r = renderSite(tpl, { ...doc, pages: [{ page_id: "nope", title: "x", slots: {}, repeats: {} }] });
    expect(r.ok).toBe(false);
  });
  it("refuses missing identity keys referenced by the template", () => {
    const r = renderSite(tpl, { ...doc, identity: { business_name: "Acme" } });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.missing.some((m) => m.slot_id === "id:phone")).toBe(true);
  });
});

describe("renderSite nav href prefixing", () => {
  const navTpl: CompiledTemplate = {
    manifest: {
      engine: 3, name: "mini2", version: 1,
      identity: { business_name: "Demo Co" },
      theme: { mode: "none", roles: {} },
      nav: [{
        id: "nav_header", fragment: "nav_header", location: "header",
        items: [
          { page_id: "p1", href: "p1.html", label: "P1" },
          { page_id: null, href: "//cdn.example.com/widget", label: "CDN" },
          { page_id: null, href: "javascript:void(0)", label: "Toggle" },
        ],
      }],
      pages: [
        { id: "p1", file: "p1.html", kind: "home", stampable: false, title_sample: "P1", slots: [], repeats: [] },
        { id: "sub", file: "page.html", kind: "generic", stampable: false, title_sample: "Sub", slots: [], repeats: [] },
      ],
    },
    pages: {
      "p1.html": `<html><head><title>{{title}}</title></head><body><ul><!--@nav:nav_header--></ul></body></html>`,
      "page.html": `<html><head><title>{{title}}</title></head><body><ul><!--@nav:nav_header--></ul></body></html>`,
    },
    fragments: { nav_header: `<li><a href="{{nav:href}}">{{nav:title}}</a></li>` },
    assets: {},
  };
  const navDoc: ContentDoc = {
    identity: { business_name: "Acme" },
    theme: {},
    pages: [
      { page_id: "p1", title: "P1", slots: {}, repeats: {} },
      { page_id: "sub", output: "sub/page.html", title: "Sub", slots: {}, repeats: {} },
    ],
  };

  it("renders scheme/protocol-relative nav hrefs verbatim on a subpage (no ../ prepended)", () => {
    const r = renderSite(navTpl, navDoc);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const sub = dec(r.files["sub/page.html"]);
    // page link gets the depth prefix...
    expect(sub).toContain(`<a href="../p1.html">P1</a>`);
    // ...but scheme/protocol-relative links render verbatim, never corrupted with ../
    expect(sub).toContain(`<a href="//cdn.example.com/widget">CDN</a>`);
    expect(sub).toContain(`<a href="javascript:void(0)">Toggle</a>`);
    expect(sub).not.toContain(`..//cdn.example.com`);
    expect(sub).not.toContain(`../javascript:`);
  });
});

/**
 * Regression coverage for a real latent bug: a "text" slot whose token lands
 * inside an HTML ATTRIBUTE (compiler/slots.ts's <img alt="{{slot:...}}">,
 * marked with SlotDef.attr = "alt") went through fillSlot/escapeText, which
 * only escapes & < > — safe for element text, not for an attribute value.
 * An alt value containing a bare `"` broke out of the attribute; one
 * shaped like `foo" onmouseover="..."` injected a live attribute. Neither
 * was ever exploited (no Site Studio site had shipped), but Phase 4a starts
 * deploying, so this closes it before that happens. Fixed by tokens.ts's
 * `fillSlotValue`, which routes any slot with `.attr` set through
 * `escapeHtml` (attribute-safe: & < > " ') instead.
 */
describe("renderSite escapes attribute-bound slots (alt text) safely", () => {
  const altTpl: CompiledTemplate = {
    manifest: {
      engine: 3, name: "alt-mini", version: 1,
      identity: {},
      theme: { mode: "none", roles: {} },
      nav: [],
      pages: [{
        id: "index", file: "index.html", kind: "home", stampable: false, title_sample: "Index",
        slots: [
          { id: "hero", type: "image", sample: "img/hero.jpg", html: false },
          { id: "hero_alt", type: "text", sample: "A hero image", html: false, max_chars: 60, attr: "alt" },
        ],
        repeats: [],
      }],
    },
    pages: {
      "index.html": `<html><head><title>{{title}}</title></head><body><img src="{{img:hero}}" alt="{{slot:hero_alt}}"></body></html>`,
    },
    fragments: {},
    assets: {},
  };
  const docWithAlt = (altText: string): ContentDoc => ({
    identity: {},
    theme: {},
    pages: [{ page_id: "index", title: "Index", slots: { hero: "img/hero.jpg", hero_alt: altText }, repeats: {} }],
  });

  it("escapes a quote-bearing alt value instead of corrupting the tag", () => {
    const r = renderSite(altTpl, docWithAlt(`Fish & Chips, "the best" in town`));
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const html = dec(r.files["index.html"]);
    expect(html).toContain(`alt="Fish &amp; Chips, &quot;the best&quot; in town"`);
    // exactly one alt attribute survives — the value never broke out of its quotes
    expect(html.match(/ alt="/g)).toHaveLength(1);
  });

  it("does not let an alt value inject a live attribute", () => {
    const r = renderSite(altTpl, docWithAlt(`foo" onmouseover="alert(1)`));
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const html = dec(r.files["index.html"]);
    expect(html).not.toContain(`onmouseover="alert(1)"`);
    expect(html).toContain(`alt="foo&quot; onmouseover=&quot;alert(1)"`);
  });
});

/**
 * Render-time substitution of {{id:*}} tokens inside tokenized text assets
 * (compiler/assetIdentity.ts marks which asset paths carry them via
 * manifest.tokenizedAssets). The critical property under test: the
 * substituted value must be escaped for the ASSET'S context (JS string vs
 * CSS string) — not HTML-escaped, and not dropped in raw — or a hostile
 * business name breaks the asset's syntax and takes down the whole
 * deployed site.
 */
/**
 * The {{brand}} block (Phase 4c, Task 5) — swaps a client's logo <img> in
 * for the template's header/footer wordmark, falling back to the escaped
 * business name when no logo is supplied. The no-logo, "demo identity"
 * branch must reproduce the manifest-captured `brand.sample` text
 * byte-for-byte (this is what keeps the round-trip/golden render pinned
 * even though the wordmark's demo text, e.g. "NORTHPOINT", is a stylized
 * short form that differs from the full `identity.business_name`, e.g.
 * "Northpoint Remodeling").
 */
describe("renderSite: {{brand}} block", () => {
  const brandTpl: CompiledTemplate = {
    manifest: {
      engine: 3, name: "brand-mini", version: 1,
      identity: { business_name: "Northpoint Remodeling" },
      brand: { sample: "NORTHPOINT" },
      theme: { mode: "none", roles: {} },
      nav: [],
      pages: [{ id: "index", file: "index.html", kind: "home", stampable: false, title_sample: "Northpoint Remodeling", slots: [], repeats: [] }],
    },
    pages: {
      "index.html": `<html><head><title>{{title}}</title></head><body><header><span id="np-logo-txt">{{brand}}</span></header></body></html>`,
    },
    fragments: {},
    assets: {},
  };
  const docFor = (identity: Record<string, string>): ContentDoc => ({
    identity, theme: {},
    pages: [{ page_id: "index", title: "Northpoint Remodeling", slots: {}, repeats: {} }],
  });

  it("reproduces the captured demo sample verbatim when rendering the demo/sample identity (round trip)", () => {
    const r = renderSite(brandTpl, docFor({ business_name: "Northpoint Remodeling" }));
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(dec(r.files["index.html"])).toContain('<span id="np-logo-txt">NORTHPOINT</span>');
  });

  it("falls back to the escaped real business name when it differs from the demo identity and no logo is set", () => {
    const r = renderSite(brandTpl, docFor({ business_name: `Bob's Plumbing & Sons` }));
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(dec(r.files["index.html"])).toContain('<span id="np-logo-txt">Bob&#39;s Plumbing &amp; Sons</span>');
  });

  it("emits an <img> with escaped src/alt when the doc identity carries a logo", () => {
    const r = renderSite(brandTpl, { ...docFor({ business_name: "Acme & Sons" }), identity: { business_name: "Acme & Sons", logo: "https://cdn.example.com/logo.png?x=1&y=2" } });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const html = dec(r.files["index.html"]);
    expect(html).toContain('<span id="np-logo-txt"><img src="https://cdn.example.com/logo.png?x=1&amp;y=2" alt="Acme &amp; Sons"></span>');
  });

  it("does not let a hostile logo URL or business name break out of the attribute", () => {
    const r = renderSite(brandTpl, {
      ...docFor({}),
      identity: { business_name: `foo" onerror="alert(1)`, logo: `x.png" onerror="alert(1)` },
    });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const html = dec(r.files["index.html"]);
    expect(html).not.toContain('onerror="alert(1)"');
    expect(html).toContain(`<img src="x.png&quot; onerror=&quot;alert(1)" alt="foo&quot; onerror=&quot;alert(1)">`);
  });

  it("refuses when a template uses {{brand}} but the doc has no business_name at all", () => {
    const r = renderSite(brandTpl, { identity: {}, theme: {}, pages: [{ page_id: "index", title: "X", slots: {}, repeats: {} }] });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.missing.some((m) => m.slot_id === "id:business_name")).toBe(true);
  });

  it("a template with no {{brand}} token is unaffected (manifest.brand absent)", () => {
    const r = renderSite(tpl, doc);
    expect(r.ok).toBe(true);
  });
});

describe("renderSite substitutes identity tokens inside tokenized assets", () => {
  const assetTpl: CompiledTemplate = {
    manifest: {
      engine: 3, name: "asset-mini", version: 1,
      identity: { business_name: "Demo Co", phone: "(111) 111-1111" },
      theme: { mode: "none", roles: {} },
      nav: [],
      pages: [{ id: "index", file: "index.html", kind: "home", stampable: false, title_sample: "Demo Co", slots: [], repeats: [] }],
      tokenizedAssets: ["js/site.js", "css/site.css"],
    },
    pages: { "index.html": `<html><head><title>{{title}}</title></head><body></body></html>` },
    fragments: {},
    assets: {
      "js/site.js": new TextEncoder().encode(`var NAME = "{{id:business_name}}"; var PHONE = "{{id:phone}}";`),
      "css/site.css": new TextEncoder().encode(`.badge::before { content: "{{id:business_name}}"; }`),
      "img/logo.png": new TextEncoder().encode("not-really-a-png-but-untouched"),
    },
  };
  const docFor = (identity: Record<string, string>): ContentDoc => ({
    identity, theme: {},
    pages: [{ page_id: "index", title: "Demo Co", slots: {}, repeats: {} }],
  });

  it("substitutes a clean value into the JS asset", () => {
    const r = renderSite(assetTpl, docFor({ business_name: "Acme Co", phone: "(303) 555-9999" }));
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(dec(r.files["js/site.js"])).toBe(`var NAME = "Acme Co"; var PHONE = "(303) 555-9999";`);
  });

  it("JS-escapes a hostile business name instead of producing a syntax error", () => {
    const r = renderSite(assetTpl, docFor({ business_name: `Bob's Plumbing & Sons`, phone: "(303) 555-9999" }));
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const js = dec(r.files["js/site.js"]);
    expect(js).toBe(`var NAME = "Bob\\'s Plumbing & Sons"; var PHONE = "(303) 555-9999";`);
    // and the escaped output is actually valid, evaluable JS
    // eslint-disable-next-line no-new-func
    const fn = new Function(`${js} return NAME;`);
    expect(fn()).toBe(`Bob's Plumbing & Sons`);
  });

  it("CSS-escapes the same hostile value in the CSS asset", () => {
    const r = renderSite(assetTpl, docFor({ business_name: `Bob's Plumbing & Sons`, phone: "(303) 555-9999" }));
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(dec(r.files["css/site.css"])).toBe(`.badge::before { content: "Bob\\'s Plumbing & Sons"; }`);
  });

  it("leaves an asset not listed in tokenizedAssets untouched", () => {
    const r = renderSite(assetTpl, docFor({ business_name: "Acme Co", phone: "(303) 555-9999" }));
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(dec(r.files["img/logo.png"])).toBe("not-really-a-png-but-untouched");
  });

  it("refuses when an identity key referenced only inside a tokenized asset is missing from the Content Doc", () => {
    const r = renderSite(assetTpl, docFor({ business_name: "Acme Co" })); // phone missing
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.missing.some((m) => m.slot_id === "id:phone")).toBe(true);
  });
});
