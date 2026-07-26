import { describe, it, expect } from "vitest";
import { buildPreview } from "@/lib/site-studio/preview/buildPreview";
import { CompiledTemplate, ContentDoc } from "@/lib/site-studio/schema";
import { PAGE_ATTR, SLOT_ATTR } from "@/lib/site-studio/render/annotate";

const dec = (b: Uint8Array) => new TextDecoder().decode(b);

const tpl: CompiledTemplate = {
  manifest: {
    engine: 3, name: "mini", version: 1,
    identity: { business_name: "Demo Co" },
    theme: { mode: "none", roles: {} },
    nav: [{ id: "nav_header", fragment: "nav_header", location: "header" }],
    pages: [
      {
        id: "index", file: "index.html", kind: "home", stampable: false, title_sample: "Demo Co",
        slots: [
          { id: "index_s1", type: "text", sample: "Welcome to Demo Co", html: false, max_chars: 60 },
          { id: "index_i1", type: "image", sample: "img/a.jpg", html: false },
        ],
        repeats: [],
      },
      {
        id: "svc", file: "service.html", kind: "service", stampable: true, title_sample: "Service",
        slots: [
          { id: "svc_s1", type: "text", sample: "About this service", html: false, max_chars: 60 },
          { id: "svc_i1", type: "image", sample: "img/b.jpg", html: false },
        ],
        repeats: [],
      },
    ],
  },
  pages: {
    "index.html": `<html><head><title>{{title}}</title><link rel="stylesheet" href="css/style.css"></head><body><ul><!--@nav:nav_header--></ul><h1>{{slot:index_s1}}</h1><img src="{{img:index_i1}}"><a href="{{link:svc}}">Our service</a><a href="https://example.com">External</a></body></html>`,
    "service.html": `<html><head><title>{{title}}</title><link rel="stylesheet" href="../css/style.css"></head><body><ul><!--@nav:nav_header--></ul><p>{{slot:svc_s1}}</p><img src="{{img:svc_i1}}"><a href="{{link:index}}">Home</a></body></html>`,
  },
  fragments: {
    nav_header: `<li><a href="{{nav:href}}">{{nav:title}}</a></li>`,
  },
  assets: {
    "css/style.css": new TextEncoder().encode("body{color:#000}"),
    "img/a.jpg": new TextEncoder().encode("fake-bytes-a"),
  },
};

const doc: ContentDoc = {
  identity: { business_name: "Acme & Sons" },
  theme: {},
  pages: [
    {
      page_id: "index", title: "Acme Home",
      slots: { index_s1: "Denver's finest plumbers", index_i1: "img/a.jpg" },
      repeats: {},
    },
    {
      page_id: "svc", output: "services/sewer.html", nav_title: "Sewer", title: "Sewer Repair",
      slots: { svc_s1: "We fix sewers.", svc_i1: "asset:missing-uuid" },
      repeats: {},
    },
  ],
};

describe("buildPreview", () => {
  it("returns the annotated HTML for just the requested page", () => {
    const r = buildPreview(tpl, doc, 0, "run-1");
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.html).toContain(`${PAGE_ATTR}="0"`);
    expect(r.html).toContain(`${SLOT_ATTR}="0:index_s1"`);
  });

  it("rewrites a same-directory asset reference to the preview asset route", () => {
    const r = buildPreview(tpl, doc, 0, "run-1");
    if (!r.ok) return;
    expect(r.html).toContain(`href="/api/site-studio/runs/run-1/preview?asset=css/style.css"`);
    expect(r.html).toContain(`src="/api/site-studio/runs/run-1/preview?asset=img/a.jpg"`);
  });

  it("rewrites a depth-adjusted (../) asset reference on a stamped page the same way", () => {
    const r = buildPreview(tpl, doc, 1, "run-1");
    if (!r.ok) return;
    expect(r.html).toContain(`href="/api/site-studio/runs/run-1/preview?asset=css/style.css"`);
  });

  it("turns an inter-page link into a #ss-page-<docIndex> hash for the shell to intercept", () => {
    const r = buildPreview(tpl, doc, 0, "run-1");
    if (!r.ok) return;
    expect(r.html).toContain(`href="#ss-page-1"`);
  });

  it("resolves the reverse inter-page link from the stamped page back to the index", () => {
    const r = buildPreview(tpl, doc, 1, "run-1");
    if (!r.ok) return;
    expect(r.html).toContain(`href="#ss-page-0"`);
  });

  it("leaves an external link completely alone", () => {
    const r = buildPreview(tpl, doc, 0, "run-1");
    if (!r.ok) return;
    expect(r.html).toContain(`href="https://example.com"`);
  });

  it("leaves an unresolved asset: pick alone but reports it in warnings, never blocking the render", () => {
    const r = buildPreview(tpl, doc, 1, "run-1");
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.html).toContain(`src="asset:missing-uuid"`);
    expect(r.warnings).toContainEqual(expect.stringContaining("svc_i1"));
    expect(r.warnings).toContainEqual(expect.stringContaining("asset:missing-uuid"));
  });

  it("a page with no unresolved picks reports no warnings", () => {
    const r = buildPreview(tpl, doc, 0, "run-1");
    if (!r.ok) return;
    expect(r.warnings).toEqual([]);
  });

  it("is pure: does not mutate the input doc", () => {
    const before = JSON.parse(JSON.stringify(doc));
    buildPreview(tpl, doc, 0, "run-1");
    buildPreview(tpl, doc, 1, "run-1");
    expect(doc).toEqual(before);
  });

  it("is pure: identical inputs produce identical output", () => {
    const a = buildPreview(tpl, doc, 0, "run-1");
    const b = buildPreview(tpl, doc, 0, "run-1");
    expect(a).toEqual(b);
  });

  it("refuses (ok:false, missing) when the doc is incomplete, exactly like renderSite", () => {
    const bad: ContentDoc = { ...doc, pages: [{ ...doc.pages[0], slots: { index_i1: "img/a.jpg" } }, doc.pages[1]] };
    const r = buildPreview(tpl, bad, 0, "run-1");
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.missing).toContainEqual({ page_id: "index", slot_id: "index_s1" });
  });

  it("throws on an out-of-range page index rather than silently doing nothing", () => {
    expect(() => buildPreview(tpl, doc, 99, "run-1")).toThrow();
  });
});
