// @vitest-environment node
import { describe, it, expect } from "vitest";
import { rewriteAssetRefs, injectBase, encodePathSegments } from "@/lib/site-builder/preview";

const BASE = "/api/site-builder/runs/run-1/preview/";

describe("encodePathSegments", () => {
  it("keeps slashes as separators but escapes each segment", () => {
    expect(encodePathSegments("css/style.css")).toBe("css/style.css");
    expect(encodePathSegments("img/a b.png")).toBe("img/a%20b.png");
  });
});

describe("rewriteAssetRefs", () => {
  it("rewrites a relative ref that names a known file to the preview route", () => {
    const html = `<link href="style.css"><script src="components.js"></script>`;
    const out = rewriteAssetRefs(html, ["style.css", "components.js"], BASE);
    expect(out).toContain(`href="${BASE}style.css"`);
    expect(out).toContain(`src="${BASE}components.js"`);
  });

  it("rewrites a root-absolute ref the same way (normalised, leading slash stripped)", () => {
    const html = `<link href="/style.css">`;
    const out = rewriteAssetRefs(html, ["style.css"], BASE);
    expect(out).toContain(`href="${BASE}style.css"`);
  });

  it("leaves external, anchor and unknown refs completely alone", () => {
    const html = `<a href="https://x.test">x</a><a href="#top">t</a><img src="not-in-template.png">`;
    const out = rewriteAssetRefs(html, ["style.css"], BASE);
    expect(out).toBe(html);
  });

  it("routes a subdirectory asset per-segment so the catch-all still matches", () => {
    const html = `<link href="css/style.css">`;
    const out = rewriteAssetRefs(html, ["css/style.css"], BASE);
    expect(out).toContain(`href="${BASE}css/style.css"`);
  });
});

describe("injectBase", () => {
  it("inserts the base tag immediately inside <head>", () => {
    const out = injectBase(`<!doctype html><html><head><title>x</title></head><body></body></html>`, BASE);
    expect(out).toContain(`<head><base href="${BASE}"><title>`);
  });

  it("synthesises a head when the page has <html> but no <head>", () => {
    const out = injectBase(`<html><body>hi</body></html>`, BASE);
    expect(out).toContain(`<html><head><base href="${BASE}"></head><body>`);
  });

  it("prepends the base tag when the page has neither head nor html", () => {
    const out = injectBase(`<section>fragment</section>`, BASE);
    expect(out).toBe(`<base href="${BASE}"><section>fragment</section>`);
  });
});
