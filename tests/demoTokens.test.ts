import { describe, it, expect } from "vitest";
import { extractDemoTokens, findLeaks } from "@/lib/template-engine/demoTokens";

const html = `<html><head><title>Northpoint Remodeling - Denver Kitchens</title></head>
<body><h1>NORTHPOINT REMODELING</h1><p>Serving Cherry Creek and Denver.</p>
<a href="tel:+13035551234">(303) 555-1234</a>
<a href="mailto:hello@northpointremodel.com">email</a></body></html>`;
const js = `class NorthpointApp { } window.northpointApp = new NorthpointApp();`;

describe("extractDemoTokens", () => {
  it("finds the demo business name, city, phone, email and JS identifier", () => {
    const t = extractDemoTokens({ "index.html": html, "script.js": js });
    const lower = t.map((x) => x.toLowerCase());
    expect(lower).toContain("northpoint remodeling");
    expect(lower.some((x) => x.includes("cherry creek"))).toBe(true);
    expect(lower.some((x) => x.includes("denver"))).toBe(true);
    expect(t).toContain("(303) 555-1234");
    expect(t.some((x) => x.includes("northpointremodel.com"))).toBe(true);
    expect(t.some((x) => x.toLowerCase().includes("northpointapp"))).toBe(true);
  });
  it("does not emit trivially short or generic tokens", () => {
    const t = extractDemoTokens({ "index.html": html });
    expect(t.every((x) => x.length >= 4)).toBe(true);
    expect(t.map((s) => s.toLowerCase())).not.toContain("html");
  });
});

describe("findLeaks", () => {
  const tokens = ["Northpoint Remodeling", "Cherry Creek", "(303) 555-1234"];
  it("reports every file containing a demo token (case-insensitive)", () => {
    const leaks = findLeaks({ "a.html": "Welcome to northpoint remodeling!", "b.html": "clean" }, tokens);
    expect(leaks).toHaveLength(1);
    expect(leaks[0].file).toBe("a.html");
    expect(leaks[0].token).toBe("Northpoint Remodeling");
  });
  it("returns [] when the output is clean (the pass condition)", () => {
    expect(findLeaks({ "a.html": "Inside Out Painting, Brentwood NY" }, tokens)).toEqual([]);
  });
  it("catches a leak in JS as well as HTML", () => {
    expect(findLeaks({ "script.js": "window.northpointApp" }, ["northpointApp"])).toHaveLength(1);
  });
});

// The production failure this suite exists to prevent: a template whose demo
// business is "King Painting" yielded the token "King", which raw-substring
// matching found inside wor·king / boo·king / par·king — an unpassable gate.
describe("findLeaks word boundaries (the 'King' regression)", () => {
  const king = ["King"];
  it("does not leak on the real failing excerpt", () => {
    const leaks = findLeaks(
      { "index.html": `<p>...ess interior painting for living and working spaces.</p></div></a> <a class="` },
      king,
    );
    expect(leaks).toEqual([]);
  });
  it.each(["booking", "parking", "making", "looking", "taking", "kingdom", "viking"])(
    "does not match inside %s",
    (word) => {
      expect(findLeaks({ "a.html": `<p>We love ${word} here.</p>` }, king)).toEqual([]);
    },
  );
  it.each([
    ["King Painting", "<p>King Painting did the work.</p>"],
    ["possessive", "<p>King's crew arrived early.</p>"],
    ["all caps", "<h1>KING</h1>"],
    ["hyphenated", "<p>King-Painting LLC</p>"],
    ["tag-wrapped", "<h1>King</h1>"],
  ])("still catches %s", (_label, html) => {
    const leaks = findLeaks({ "index.html": html }, king);
    expect(leaks).toHaveLength(1);
    expect(leaks[0].token).toBe("King");
    expect(leaks[0].excerpt.length).toBeGreaterThan(0);
  });
  it("matches a multi-word token across collapsed whitespace and newlines", () => {
    const t = ["Northpoint Remodeling"];
    expect(findLeaks({ "a.html": "<p>Northpoint   Remodeling</p>" }, t)).toHaveLength(1);
    expect(findLeaks({ "a.html": "<p>Northpoint\n  Remodeling</p>" }, t)).toHaveLength(1);
    expect(findLeaks({ "a.html": "<span>NORTHPOINT</span><span>REMODELING</span>" }, t)).toHaveLength(1);
  });
  it("escapes regex metacharacters in tokens", () => {
    expect(findLeaks({ "a.html": "<p>(303) 555-1234</p>" }, ["(303) 555-1234"])).toHaveLength(1);
    expect(findLeaks({ "a.html": "<p>3035551234</p>" }, ["(303) 555-1234"])).toEqual([]);
    expect(findLeaks({ "a.html": "<p>hi@northpointremodel.com</p>" }, ["northpointremodel.com"])).toHaveLength(1);
    expect(findLeaks({ "a.html": "<p>northpointremodelXcom</p>" }, ["northpointremodel.com"])).toEqual([]);
  });
});

// Structural identifiers are required to be reproduced verbatim by the
// regenerator, so a "leak" inside one is a gate no correct output can pass.
describe("findLeaks ignores structural identifiers", () => {
  const t = ["King"];
  it.each([
    ['class', `<div class="king-hero"><p>Interior work</p></div>`],
    ['id', `<section id="king"><p>Interior work</p></section>`],
    ['data-*', `<div data-panel="king"><p>Interior work</p></div>`],
  ])("does not flag a token inside %s", (_label, html) => {
    expect(findLeaks({ "index.html": html }, t)).toEqual([]);
  });
  it("still flags the same token in visible text, href, alt and a comment", () => {
    expect(findLeaks({ "a.html": `<div class="king-hero"><h2>King</h2></div>` }, t)).toHaveLength(1);
    expect(findLeaks({ "a.html": `<a class="x" href="https://king.example.com">Site</a>` }, t)).toHaveLength(1);
    expect(findLeaks({ "a.html": `<img id="hero" src="king.jpg" alt="King crew">` }, t)).toHaveLength(1);
    expect(findLeaks({ "a.html": `<!-- King demo markup --><div id="king"></div>` }, t)).toHaveLength(1);
  });
  it("keeps the excerpt aligned with the original text", () => {
    const html = `<div class="king-hero-banner-wide"><p>Painted by King last spring.</p></div>`;
    const leaks = findLeaks({ "a.html": html }, t);
    expect(leaks).toHaveLength(1);
    expect(leaks[0].excerpt).toContain("Painted by King last spring");
  });
});

describe("extractDemoTokens token quality", () => {
  const kingHtml = `<html><head><title>King Painting - Interior Painting</title></head>
<body><h1>KING PAINTING</h1><p>Quality interior painting for living and working spaces.</p></body></html>`;
  const kingAbout = `<html><head><title>About - King Painting</title></head>
<body><h2>King Painting</h2><p>Booking is easy.</p></body></html>`;

  it("never emits a common English word on its own — it keeps the phrase", () => {
    const t = extractDemoTokens({ "index.html": kingHtml, "about.html": kingAbout });
    const lower = t.map((x) => x.toLowerCase());
    expect(lower).not.toContain("king");
    expect(lower).toContain("king painting");
  });
  it("the tokens it does emit cannot fail an honest page", () => {
    const t = extractDemoTokens({ "index.html": kingHtml, "about.html": kingAbout });
    const honest = {
      "index.html": `<h1>Inside Out Painting</h1><p>Quality interior painting for living and working spaces.</p>`,
    };
    expect(findLeaks(honest, t)).toEqual([]);
  });
  it("emits no token shorter than three characters", () => {
    const t = extractDemoTokens({ "index.html": kingHtml, "about.html": kingAbout });
    expect(t.every((x) => x.length >= 3)).toBe(true);
  });
});
