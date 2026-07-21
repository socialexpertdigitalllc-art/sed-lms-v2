import { describe, it, expect } from "vitest";
import { extractTranslatable } from "@/lib/template-engine/textExtract";

// A page shaped like the real templates: doctype, comments, meta, SVG, void
// tags, an inline <script>, a split logo, entities and a tel:/mailto: pair.
const PAGE = `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <title>Home - Northpoint Remodeling</title>
  <meta name="description" content="Kitchen &amp; bath remodeling in Denver.">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta property="og:title" content="Northpoint Remodeling">
  <link rel="stylesheet" href="style.css">
</head>
<body class="page-home" data-page="home">
  <!-- header -->
  <header class="site-header">
    <a class="brand" href="index.html"><span>NORTHPOINT</span><span>REMODELING</span></a>
    <nav id="nav" data-nav><a href="about.html">About Us</a></nav>
  </header>
  <main>
    <h1 class="hero__title">Beautiful kitchens, built right</h1>
    <p>Call <a href="tel:5552104400">(555) 210-4400</a> or email <a href="mailto:hello@northpointremodel.com">hello@northpointremodel.com</a>.</p>
    <img src="img/hero.jpg" alt="A remodeled kitchen" width="1200">
    <svg viewBox="0 0 24 24" class="icon"><circle cx="12" cy="12" r="10"/><path d="M4 4h16"/></svg>
    <input type="text" placeholder="Your name" aria-label="Your name">
    <button data-cta onclick="siteApp.open()">Book now</button>
    <p>&mdash; 24/7 &mdash;</p>
  </main>
  <script>
    var greeting = "Hello from Northpoint";
    if (1 < 2) { console.log("ok"); }
  </script>
</body>
</html>
`;

describe("extractTranslatable — round trip", () => {
  it("apply({}) returns the document byte-identical", () => {
    expect(extractTranslatable(PAGE).apply({})).toBe(PAGE);
  });

  it("apply(identityMap) returns the document byte-identical", () => {
    const ex = extractTranslatable(PAGE);
    const identity = Object.fromEntries(ex.items.map((i) => [i.id, i.text]));
    expect(ex.apply(identity)).toBe(PAGE);
  });

  it("round-trips a fragment with a void tag, a comment and a raw <script>", () => {
    const frag = `<!-- x --><br><img src="a.png"><script>if (a<b) c="d";</script><p>Hi</p>`;
    const ex = extractTranslatable(frag);
    expect(ex.apply({})).toBe(frag);
  });
});

describe("extractTranslatable — what is extracted", () => {
  const ex = extractTranslatable(PAGE);
  const texts = ex.items.map((i) => i.text);

  it("takes visible text nodes", () => {
    expect(texts).toContain("Beautiful kitchens, built right");
    expect(texts).toContain("About Us");
    expect(texts).toContain("Book now");
    expect(texts).toContain("NORTHPOINT");
  });

  it("takes <title>, meta description and og:*", () => {
    expect(ex.items.find((i) => i.kind === "title")?.text).toBe("Home - Northpoint Remodeling");
    expect(texts).toContain("Kitchen & bath remodeling in Denver.");
    expect(texts).toContain("Northpoint Remodeling");
  });

  it("takes alt, placeholder and aria-label", () => {
    expect(texts).toContain("A remodeled kitchen");
    expect(ex.items.filter((i) => i.text === "Your name")).toHaveLength(2);
  });

  it("takes mailto: and tel: hrefs as contacts", () => {
    const contacts = ex.items.filter((i) => i.kind === "contact").map((i) => i.text);
    expect(contacts).toEqual(["tel:5552104400", "mailto:hello@northpointremodel.com"]);
  });

  it("never takes class / id / data-* values or structural attributes", () => {
    for (const bad of ["page-home", "site-header", "hero__title", "nav", "home", "style.css", "img/hero.jpg", "0 0 24 24", "text", "1200"]) {
      expect(texts).not.toContain(bad);
    }
  });

  it("never takes <script> or <style> bodies, or the doctype", () => {
    expect(texts.some((t) => t.includes("var greeting"))).toBe(false);
    expect(texts.some((t) => t.includes("console.log"))).toBe(false);
    expect(texts.some((t) => t.toLowerCase().includes("doctype"))).toBe(false);
  });

  it("skips whitespace-only, pure-punctuation and digit-only nodes", () => {
    expect(texts.some((t) => t.trim() === "")).toBe(false);
    expect(texts).not.toContain("— 24/7 —");
    expect(texts).not.toContain("1200"); // an attribute value, and digits only
  });

  it("makes an exception for a bare phone number, which the identity pass must reach", () => {
    expect(texts).toContain("(555) 210-4400");
  });

  it("does not extract non-contact URLs", () => {
    expect(texts).not.toContain("index.html");
    expect(texts).not.toContain("about.html");
  });
});

describe("extractTranslatable — apply", () => {
  it("writes replacements back and escapes them for their position", () => {
    const html = `<p>Old copy</p><img alt="Old alt"><meta name="description" content="Old meta">`;
    const ex = extractTranslatable(html);
    const byText = Object.fromEntries(ex.items.map((i) => [i.text, i.id]));
    const out = ex.apply({
      [byText["Old copy"]]: "New & <better> copy",
      [byText["Old alt"]]: 'A "wide" shot',
      [byText["Old meta"]]: "Meta & more",
    });
    expect(out).toBe(
      `<p>New &amp; &lt;better&gt; copy</p><img alt="A &quot;wide&quot; shot"><meta name="description" content="Meta &amp; more">`,
    );
  });

  it("keeps the original text for an omitted, blank or non-string value", () => {
    const html = `<p>One</p><p>Two</p><p>Three</p>`;
    const ex = extractTranslatable(html);
    const [a, b, c] = ex.items;
    const out = ex.apply({ [a.id]: "Uno", [b.id]: "   ", [c.id]: null });
    expect(out).toBe(`<p>Uno</p><p>Two</p><p>Three</p>`);
  });

  it("preserves the surrounding indentation of a text node", () => {
    const html = `<p>\n      Padded copy\n    </p>`;
    const ex = extractTranslatable(html);
    expect(ex.items[0].text).toBe("Padded copy");
    expect(ex.apply({ [ex.items[0].id]: "New copy" })).toBe(`<p>\n      New copy\n    </p>`);
  });
});
