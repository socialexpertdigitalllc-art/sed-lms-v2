import { describe, it, expect } from "vitest";
import { applyLogoToHtml, isSafeLogoUrl } from "@/lib/template-engine/logo";

const LOGO = "https://cdn.example.com/acme-logo.png";
const ARGS = { logoUrl: LOGO, businessName: "Acme Roofing" };

// A template with a real <img> logo slot in both header and footer.
const WITH_IMG = `<!DOCTYPE html>
<html lang="en"><head><title>Acme</title></head>
<body>
<header class="site-header"><a class="brand" href="index.html"><img src="assets/demo-logo.svg" alt=""><span class="site-title">Demo Co</span></a></header>
<main><p>hello</p></main>
<footer class="site-footer"><div class="footer-brand"><img src="assets/demo-logo-white.svg" alt="Demo Co"></div></footer>
</body></html>`;

// A template that does NOT look like the original: the brand area is a text
// wordmark with no <img> anywhere. This is the shape that silently dropped the
// lead's logo before the deterministic pass existed.
const WORDMARK_ONLY = `<!DOCTYPE html>
<html lang="en"><head><title>Acme</title></head>
<body>
<div class="topbar"><a class="site-title" href="/">Demo Co</a><nav><ul><li><a href="about.html">About</a></li></ul></nav></div>
<main><p>hello</p></main>
<div class="footer"><p class="site-title">Demo Co</p><p>&copy; 2026</p></div>
</body></html>`;

describe("isSafeLogoUrl", () => {
  it("accepts https, protocol-relative and relative URLs", () => {
    expect(isSafeLogoUrl(LOGO)).toBe(true);
    expect(isSafeLogoUrl("//cdn.example.com/a.png")).toBe(true);
    expect(isSafeLogoUrl("/assets/logo.png")).toBe(true);
    expect(isSafeLogoUrl("assets/logo.png")).toBe(true);
  });
  it("refuses anything that could execute or break out of the attribute", () => {
    expect(isSafeLogoUrl("javascript:alert(1)")).toBe(false);
    expect(isSafeLogoUrl('x.png" onerror="alert(1)')).toBe(false);
    expect(isSafeLogoUrl("data:image/svg+xml;base64,AAA")).toBe(false);
    expect(isSafeLogoUrl("")).toBe(false);
    expect(isSafeLogoUrl(undefined)).toBe(false);
  });
});

describe("applyLogoToHtml — template WITH an <img> slot", () => {
  it("points the header and footer images at the client's logo", () => {
    const out = applyLogoToHtml(WITH_IMG, ARGS);
    expect(out.header).toBe(true);
    expect(out.footer).toBe(true);
    expect(out.html).toContain(`<img src="${LOGO}" alt="Acme Roofing">`); // header (alt was empty)
    expect(out.html).not.toContain("assets/demo-logo.svg");
    expect(out.html).not.toContain("assets/demo-logo-white.svg");
    expect(out.html).toContain(`src="${LOGO}" alt="Demo Co"`); // footer alt preserved
  });
  it("does not insert a second image when a slot already exists", () => {
    const out = applyLogoToHtml(WITH_IMG, ARGS);
    expect(out.html).not.toContain("tev2-logo");
    expect((out.html.match(/<img /g) ?? []).length).toBe(2);
  });
  it("leaves the wordmark element itself untouched", () => {
    const out = applyLogoToHtml(WITH_IMG, ARGS);
    expect(out.html).toContain('<span class="site-title">Demo Co</span>');
  });
});

describe("applyLogoToHtml — wordmark-only template (the bug)", () => {
  it("INSERTS a logo into the header brand area", () => {
    const out = applyLogoToHtml(WORDMARK_ONLY, ARGS);
    expect(out.header).toBe(true);
    expect(out.html).toContain(
      `<a class="site-title" href="/"><img class="tev2-logo" src="${LOGO}" alt="Acme Roofing"`,
    );
  });
  it("INSERTS a logo into the footer brand area too", () => {
    const out = applyLogoToHtml(WORDMARK_ONLY, ARGS);
    expect(out.footer).toBe(true);
    const footer = out.html.slice(out.html.indexOf('class="footer"'));
    expect(footer).toContain("tev2-logo");
  });
  it("guards the header against an oversized logo", () => {
    const out = applyLogoToHtml(WORDMARK_ONLY, ARGS);
    expect(out.html).toContain('style="max-height:56px;width:auto;vertical-align:middle;"');
  });
  it("keeps the business name text (nothing is deleted)", () => {
    const out = applyLogoToHtml(WORDMARK_ONLY, ARGS);
    expect((out.html.match(/Demo Co/g) ?? []).length).toBe(2);
  });
  it("escapes the alt text rather than emitting raw markup", () => {
    const out = applyLogoToHtml(WORDMARK_ONLY, { logoUrl: LOGO, businessName: 'A&B "Best" <Roofing>' });
    expect(out.html).toContain("alt=\"A&amp;B &quot;Best&quot; &lt;Roofing&gt;\"");
  });
});

describe("applyLogoToHtml — no logo", () => {
  it("is byte-identical when logo_url is empty", () => {
    const out = applyLogoToHtml(WORDMARK_ONLY, { logoUrl: "", businessName: "Acme Roofing" });
    expect(out.html).toBe(WORDMARK_ONLY);
    expect(out.header).toBe(false);
    expect(out.footer).toBe(false);
  });
  it("is byte-identical when logo_url is unsafe", () => {
    const out = applyLogoToHtml(WITH_IMG, { logoUrl: "javascript:alert(1)", businessName: "Acme" });
    expect(out.html).toBe(WITH_IMG);
  });
  it("leaves a page with no header or footer alone", () => {
    const bare = "<html><body><main><p>hi</p></main></body></html>";
    expect(applyLogoToHtml(bare, ARGS).html).toBe(bare);
  });
});

describe("applyLogoToHtml — round-trip fidelity", () => {
  it("preserves doctype, comments, script and style bodies", () => {
    const src = `<!DOCTYPE html>
<html><head><style>a::after{content:"<b>"}</style></head>
<body><!-- keep me --><header class="site-header"><a class="brand" href="/">Demo Co</a></header>
<script>if(1<2){console.log("<x>")}</script></body></html>`;
    const out = applyLogoToHtml(src, ARGS).html;
    expect(out).toContain("<!DOCTYPE html>");
    expect(out).toContain("<!-- keep me -->");
    expect(out).toContain('<style>a::after{content:"<b>"}</style>');
    expect(out).toContain('<script>if(1<2){console.log("<x>")}</script>');
  });
});
