import { describe, it, expect } from "vitest";
import { extractNicheTerms, MAX_NICHE_TERMS } from "@/lib/template-engine/nicheTerms";

// A template shaped like "First template" — the Denver remodeling template the
// real failure (Knights Auto Window Tint) was generated from. Recurring
// service vocabulary is repeated across at least two files/items each, exactly
// as a real template repeats it (an alt tag here, a heading there); one-off
// sentences and pure site chrome are NOT repeated, so they must not survive.
const INDEX_HTML = `<!doctype html>
<html><head><title>Home - First Template</title></head>
<body>
<h1>Welcome</h1>
<p>Full-service remodeling, start to finish.</p>
<p>Two decades turning houses into the home you actually wanted.</p>
<img src="img/kitchen.jpg" alt="Kitchen remodeling">
<img src="img/bath.jpg" alt="Bathroom remodeling">
<p>Our custom cabinetry work sets us apart from every subcontractor crew in town.</p>
<select><option>Kitchen remodel</option></select>
<a href="tel:5551234567">(555) 123-4567</a>
</body></html>`;

const SERVICES_HTML = `<html><body>
<h2>Services</h2>
<select><option>Kitchen remodel</option><option>Bathroom remodel</option></select>
<img src="img/k2.jpg" alt="Kitchen remodeling">
<p>Ask about our custom cabinetry options for your next project.</p>
<p>Every subcontractor we hire is licensed and insured.</p>
</body></html>`;

const GALLERY_HTML = `<html><body>
<h2>Gallery</h2>
<img src="img/b2.jpg" alt="Bathroom remodeling">
<p>Learn more about our process.</p>
<p>Get a quote today.</p>
</body></html>`;

const FIRST_TEMPLATE = {
  "index.html": INDEX_HTML,
  "services.html": SERVICES_HTML,
  "gallery.html": GALLERY_HTML,
};

describe("extractNicheTerms", () => {
  it("returns the recurring remodeling-service phrases", () => {
    const terms = extractNicheTerms(FIRST_TEMPLATE);
    expect(terms).toContain("kitchen remodeling");
    expect(terms).toContain("bathroom remodeling");
    expect(terms).toContain("kitchen remodel");
    expect(terms).toContain("custom cabinetry");
    expect(terms).toContain("every subcontractor");
  });

  it("does not return one-off sentences", () => {
    const terms = extractNicheTerms(FIRST_TEMPLATE);
    // Neither the whole one-off hero sentence nor any of its distinctive
    // sub-phrases recur anywhere else in the template, so none of them survive.
    expect(terms.some((t) => t.includes("full-service") || t.includes("full service"))).toBe(false);
    expect(terms.some((t) => t.includes("turning houses"))).toBe(false);
    expect(terms.some((t) => t.includes("decades turning"))).toBe(false);
  });

  it("does not return GENERIC_WORDS chrome, even when it recurs", () => {
    const terms = extractNicheTerms(FIRST_TEMPLATE);
    // "Learn more", "about our", "our process", "get a quote", "quote today" —
    // every word in each is site chrome / marketing filler, not a niche term.
    expect(terms).not.toContain("learn more");
    expect(terms).not.toContain("more about");
    expect(terms).not.toContain("about our");
    expect(terms).not.toContain("our process");
    expect(terms).not.toContain("get a quote");
    expect(terms).not.toContain("a quote today");
    expect(terms).not.toContain("quote today");
  });

  it("ignores contact hrefs, structural attributes and non-recurring junk", () => {
    const terms = extractNicheTerms(FIRST_TEMPLATE);
    expect(terms.some((t) => t.includes("555"))).toBe(false);
    expect(terms.every((t) => !/^[0-9\s]+$/.test(t))).toBe(true);
  });

  it("is deterministic and bounded", () => {
    const a = extractNicheTerms(FIRST_TEMPLATE);
    const b = extractNicheTerms(FIRST_TEMPLATE);
    expect(a).toEqual(b);
    expect(a.length).toBeLessThanOrEqual(MAX_NICHE_TERMS);
  });

  it("returns [] for a template with no recurring vocabulary", () => {
    expect(extractNicheTerms({ "index.html": `<p>Hello there, unique one-off copy.</p>` })).toEqual([]);
  });

  it("only reads HTML/JS — a stylesheet passed in contributes nothing", () => {
    const terms = extractNicheTerms({ ...FIRST_TEMPLATE, "style.css": ".kitchen-remodeling { color: red; }".repeat(5) });
    expect(terms).toContain("kitchen remodeling"); // still found via the HTML, not the CSS
  });

  it("recurring JS string literals are picked up the same way as HTML", () => {
    const js = `
const A = "Kitchen remodeling done right, every time.";
const B = "Kitchen remodeling is what we do best.";
`;
    const terms = extractNicheTerms({ "script.js": js });
    expect(terms).toContain("kitchen remodeling");
  });
});
