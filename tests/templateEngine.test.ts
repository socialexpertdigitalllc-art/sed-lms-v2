import { describe, it, expect } from "vitest";
import { unzipToMap, zipFromMap } from "@/lib/template-engine/zip";
import { classifyPage, buildManifest, validateTemplate } from "@/lib/template-engine/manifest";
import { businessSlug, websiteId } from "@/lib/template-engine/slug";
import type { PageKind, TemplateManifest } from "@/lib/template-engine/types";

const enc = new TextEncoder();

describe("zip", () => {
  it("round-trips a file map", () => {
    const input = {
      "index.html": enc.encode("<title>a</title>"),
      "css/style.css": enc.encode("body{}"),
    };
    const files = unzipToMap(zipFromMap(input));
    expect(Object.keys(files).sort()).toEqual(["css/style.css", "index.html"]);
    expect(new TextDecoder().decode(files["index.html"])).toBe("<title>a</title>");
  });

  it("strips a single shared root folder", () => {
    const zipped = zipFromMap({
      "site-template/index.html": enc.encode("<title>a</title>"),
      "site-template/css/style.css": enc.encode("body{}"),
    });
    expect(Object.keys(unzipToMap(zipped)).sort()).toEqual(["css/style.css", "index.html"]);
  });

  it("keeps paths when entries do not all share one root", () => {
    const zipped = zipFromMap({
      "index.html": enc.encode("x"),
      "css/style.css": enc.encode("y"),
    });
    expect(Object.keys(unzipToMap(zipped)).sort()).toEqual(["css/style.css", "index.html"]);
  });

  it("drops directory entries (and still strips the root)", () => {
    const zipped = zipFromMap({
      "folder/": new Uint8Array(0),
      "folder/a.txt": enc.encode("x"),
    });
    expect(Object.keys(unzipToMap(zipped))).toEqual(["a.txt"]);
  });

  it("rejects entries containing ..", () => {
    const zipped = zipFromMap({ "../evil.txt": enc.encode("x") });
    expect(() => unzipToMap(zipped)).toThrow(/unsafe path/i);
  });
});

describe("classifyPage", () => {
  const cases: [string, PageKind][] = [
    ["index.html", "home"],
    ["HOME.HTML", "home"],
    ["pages/Index.htm", "home"],
    ["about.html", "about"],
    ["About-Us.html", "about"],
    ["services.html", "services_hub"],
    ["our-services.html", "services_hub"],
    ["service.html", "service_detail"],
    ["service-detail.html", "service_detail"],
    ["individual-service.html", "service_detail"],
    ["service-page.html", "service_detail"],
    ["service-areas.html", "areas_hub"],
    ["service_areas.html", "areas_hub"],
    ["areas.html", "areas_hub"],
    ["area.html", "area_detail"],
    ["area-detail.html", "area_detail"],
    ["individual-area.html", "area_detail"],
    ["gallery.html", "gallery"],
    ["portfolio.html", "gallery"],
    ["contact.html", "contact"],
    ["contact-us.html", "contact"],
    ["blog.html", "other"],
    ["404.html", "other"],
  ];
  it.each(cases)("%s -> %s", (file, kind) => {
    expect(classifyPage(file)).toBe(kind);
  });
});

describe("buildManifest", () => {
  const files: Record<string, Uint8Array> = {
    "index.html": enc.encode("<html><head><title>  Acme   Home </title></head><body></body></html>"),
    "about.html": enc.encode("<html><head></head><body>no title here</body></html>"),
    "css/style.css": enc.encode("body{}"),
    "js/main.js": enc.encode("console.log(1)"),
    "js/components.js": enc.encode("// header/footer injector"),
    "images/hero.jpg": new Uint8Array([1, 2, 3]),
    "fonts/font.woff2": new Uint8Array([9]),
  };

  it("classifies pages, extracts titles, and splits components.js out of js[]", () => {
    const m = buildManifest(files);
    expect(m.pages).toEqual([
      { file: "about.html", title: "about", kind: "about" },
      { file: "index.html", title: "Acme Home", kind: "home" },
    ]);
    expect(m.css).toEqual(["css/style.css"]);
    expect(m.js).toEqual(["js/main.js"]);
    expect(m.components).toBe("js/components.js");
    expect(m.imageFiles).toEqual(["images/hero.jpg"]);
    expect(m.assets).toEqual(["fonts/font.woff2"]);
    const expectedBytes = Object.values(files).reduce((n, b) => n + b.byteLength, 0);
    expect(m.totalBytes).toBe(expectedBytes);
  });

  it("uses null components when no components.js exists", () => {
    const m = buildManifest({ "index.html": enc.encode("<title>x</title>"), "js/app.js": enc.encode("1") });
    expect(m.components).toBeNull();
    expect(m.js).toEqual(["js/app.js"]);
  });
});

describe("validateTemplate", () => {
  const ok: TemplateManifest = {
    pages: [{ file: "index.html", title: "Home", kind: "home" }],
    css: [],
    js: [],
    components: null,
    assets: [],
    imageFiles: [],
    totalBytes: 1000,
  };
  it("returns null for a valid manifest", () => {
    expect(validateTemplate(ok)).toBeNull();
  });
  it("errors when there are no pages", () => {
    expect(validateTemplate({ ...ok, pages: [] })).toMatch(/no html pages/i);
  });
  it("errors when extracted size exceeds 60MB", () => {
    expect(validateTemplate({ ...ok, totalBytes: 61 * 1024 * 1024 })).toMatch(/60MB/);
  });
});

describe("businessSlug", () => {
  it("lowercases, strips accents to ascii, and hyphenates", () => {
    expect(businessSlug("Sunset Café!")).toBe("sunset-cafe");
  });
  it("collapses punctuation runs into single hyphens", () => {
    expect(businessSlug("ABC Plumbing & Heating, LLC")).toBe("abc-plumbing-heating-llc");
    expect(businessSlug("  Spaced   Out  Name ")).toBe("spaced-out-name");
  });
  it("falls back to 'site' when nothing survives", () => {
    expect(businessSlug("")).toBe("site");
    expect(businessSlug("!!! ---")).toBe("site");
  });
  it("caps at 40 chars without a trailing hyphen", () => {
    const long = businessSlug("A".repeat(80) + " " + "B".repeat(30));
    expect(long).toBe("a".repeat(40));
    expect(businessSlug("a".repeat(39) + " bcd")).toBe("a".repeat(39));
  });
});

describe("websiteId", () => {
  it("is 6 chars of base36", () => {
    for (let i = 0; i < 20; i++) expect(websiteId()).toMatch(/^[a-z0-9]{6}$/);
  });
  it("varies between calls", () => {
    const ids = new Set(Array.from({ length: 10 }, () => websiteId()));
    expect(ids.size).toBeGreaterThan(1);
  });
});
