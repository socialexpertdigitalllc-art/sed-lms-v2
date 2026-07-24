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
