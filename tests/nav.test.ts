import { describe, it, expect } from "vitest";
import { internalPageTarget, pruneNavToBuiltPages } from "@/lib/template-engine/nav";

// A template that does NOT look like the original: two navs (desktop + a
// separate mobile drawer), a <ul>/<li> menu, and a mix of link kinds. The
// client asked for everything EXCEPT gallery.html and blog.html.
const TEMPLATE = `<!DOCTYPE html>
<html lang="en"><head><title>Acme</title></head>
<body>
<header class="topbar">
  <a class="site-title" href="index.html">Acme</a>
  <nav class="primary-nav"><ul>
    <li><a href="index.html">Home</a></li>
    <li><a href="about.html">About</a></li>
    <li><a href="services.html">Services</a></li>
    <li><a href="gallery.html">Gallery</a></li>
    <li><a href="service-areas.html">Areas</a></li>
    <li><a href="./blog.html">Blog</a></li>
    <li><a href="#quote">Get a quote</a></li>
    <li><a href="https://facebook.com/acme">Facebook</a></li>
    <li><a href="mailto:hi@acme.com">Email</a></li>
    <li><a href="tel:+15551234">Call</a></li>
    <li><a href="assets/brochure.pdf">Brochure</a></li>
    <li><a href="contact.html">Contact</a></li>
  </ul></nav>
</header>
<div class="mobile-menu"><a href="about.html">About</a><a href="gallery.html">Gallery</a><a href="contact.html">Contact</a></div>
<main><p>See our <a href="gallery.html">gallery</a> of work.</p></main>
</body></html>`;

const BUILT = ["index.html", "about.html", "services.html", "service-areas.html", "contact.html", "style.css"];

describe("internalPageTarget", () => {
  it("resolves internal page links, normalizing ./ and /", () => {
    expect(internalPageTarget("gallery.html")).toBe("gallery.html");
    expect(internalPageTarget("./gallery.html")).toBe("gallery.html");
    expect(internalPageTarget("/gallery.html")).toBe("gallery.html");
    expect(internalPageTarget("Gallery.HTML")).toBe("gallery.html");
    expect(internalPageTarget("about.html#team")).toBe("about.html");
    expect(internalPageTarget("about.html?x=1")).toBe("about.html");
  });
  it("returns null for anything that is not an internal page", () => {
    expect(internalPageTarget("#quote")).toBeNull();
    expect(internalPageTarget("mailto:hi@acme.com")).toBeNull();
    expect(internalPageTarget("tel:+15551234")).toBeNull();
    expect(internalPageTarget("https://example.com/x.html")).toBeNull();
    expect(internalPageTarget("//cdn.example.com/x.html")).toBeNull();
    expect(internalPageTarget("assets/brochure.pdf")).toBeNull();
    expect(internalPageTarget("javascript:void(0)")).toBeNull();
    expect(internalPageTarget(undefined)).toBeNull();
  });
});

describe("pruneNavToBuiltPages", () => {
  const out = pruneNavToBuiltPages(TEMPLATE, BUILT);

  it("removes the WHOLE menu item for a page that was never built", () => {
    const nav = out.html.slice(out.html.indexOf('class="primary-nav"'), out.html.indexOf("</header>"));
    expect(nav).not.toContain(">Gallery<");
    expect(nav).not.toContain(">Blog<");
    expect(nav).not.toContain("gallery.html");
    expect(nav).not.toContain("blog.html");
    expect(out.removed.sort()).toEqual(["blog.html", "gallery.html"]);
  });

  it("leaves no empty <li> behind", () => {
    expect(out.html).not.toMatch(/<li>\s*<\/li>/);
    expect((out.html.match(/<li>/g) ?? []).length).toBe(10); // 12 minus gallery + blog
  });

  it("keeps every page that WAS built", () => {
    for (const page of ["index.html", "about.html", "services.html", "service-areas.html", "contact.html"]) {
      expect(out.html).toContain(`href="${page}"`);
    }
  });

  it("never touches external, anchor, mailto, tel or asset links", () => {
    expect(out.html).toContain('href="https://facebook.com/acme"');
    expect(out.html).toContain('href="#quote"');
    expect(out.html).toContain('href="mailto:hi@acme.com"');
    expect(out.html).toContain('href="tel:+15551234"');
    expect(out.html).toContain('href="assets/brochure.pdf"');
  });

  it("prunes the SECOND (mobile) nav too, not just the first", () => {
    const mobile = out.html.slice(out.html.indexOf('class="mobile-menu"'), out.html.indexOf("<main"));
    expect(mobile).toContain('href="about.html"');
    expect(mobile).toContain('href="contact.html"');
    expect(mobile).not.toContain("gallery.html");
  });

  it("leaves body-copy links alone — only menus are pruned", () => {
    expect(out.html).toContain('<p>See our <a href="gallery.html">gallery</a> of work.</p>');
  });

  it("is byte-identical when every menu link points at a built page", () => {
    const all = [...BUILT, "gallery.html", "blog.html"];
    const same = pruneNavToBuiltPages(TEMPLATE, all);
    expect(same.html).toBe(TEMPLATE);
    expect(same.removed).toEqual([]);
  });

  it("preserves doctype, comments and script bodies", () => {
    const src = `<!DOCTYPE html><html><body><!-- hi --><nav><ul><li><a href="index.html">H</a></li><li><a href="gallery.html">G</a></li></ul></nav><script>if(1<2){}</script></body></html>`;
    const r = pruneNavToBuiltPages(src, ["index.html"]);
    expect(r.html).toContain("<!DOCTYPE html>");
    expect(r.html).toContain("<!-- hi -->");
    expect(r.html).toContain("<script>if(1<2){}</script>");
    expect(r.html).not.toContain("gallery.html");
  });
});

describe("pruneNavToBuiltPages — the would-empty-the-menu guard", () => {
  const ORPHAN = `<html><body><nav class="primary-nav"><ul>
    <li><a href="gallery.html">Gallery</a></li>
    <li><a href="blog.html">Blog</a></li>
  </ul></nav></body></html>`;

  it("leaves a menu alone rather than emptying it, and reports why", () => {
    const r = pruneNavToBuiltPages(ORPHAN, ["index.html"]);
    expect(r.html).toBe(ORPHAN);
    expect(r.removed).toEqual([]);
    expect(r.keptEmptyGuard).toEqual(["gallery.html, blog.html"]);
  });

  it("still prunes a menu that keeps at least one item", () => {
    const r = pruneNavToBuiltPages(ORPHAN.replace('href="blog.html"', 'href="index.html"'), ["index.html"]);
    expect(r.removed).toEqual(["gallery.html"]);
    expect(r.keptEmptyGuard).toEqual([]);
  });

  it("weighs each menu separately — an orphaned mobile nav does not block the desktop one", () => {
    const two = `<html><body>
<nav class="primary-nav"><ul><li><a href="index.html">H</a></li><li><a href="gallery.html">G</a></li></ul></nav>
<nav class="mobile-nav"><ul><li><a href="gallery.html">G</a></li></ul></nav>
</body></html>`;
    const r = pruneNavToBuiltPages(two, ["index.html"]);
    expect(r.removed).toEqual(["gallery.html"]);
    expect(r.keptEmptyGuard.length).toBe(1);
    expect(r.html).toContain('<nav class="mobile-nav"><ul><li><a href="gallery.html">G</a></li></ul></nav>');
  });
});
