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

// ---------------------------------------------------------------------------
// The production regression of 2026-07: every generation failed the leak gate.
//
// `extractDemoTokens` had always minted junk — sentence fragments, whole <title>
// strings, flattened nav menus — and it had always been harmless, because
// matching was a contiguous `indexOf` and those exact strings appear nowhere in
// a real file. Teaching the matcher to bridge markup (so a logo split across two
// <span>s would leak) made every one of them live at once: "Denver. SELECTED
// WORK Proof" matched `Denver.</p><h2>SELECTED WORK</h2><p>Proof`. ~40 phantom
// leaks per file went to the repair loop, and the model gutted the page trying
// to delete text that was never there.
//
// The strings below are VERBATIM from the demo_tokens of the two live
// templates. The markup reproduces where each one came from.
// ---------------------------------------------------------------------------

const NORTHPOINT_JUNK = [
  "Cherry Creek. We",
  "Denver. SELECTED WORK Proof",
  "Home Additions Additions",
  "Bathroom Remodeling Zero",
  "About Us - Northpoint Remodeling",
  "Remodeling Services in Cherry Creek - Northpoint Remodeling",
  "Explore Home Services Service Areas Contact Services Tiling Bathroom Remodeling Hardwood Floors Grouting",
  "Small Repairs The",
];

/** Adjacent inline <a>s — this is what flattens into one twelve-word "phrase". */
const NORTHPOINT_NAV = `<nav class="nav"><a href="index.html">Explore</a><a href="index.html">Home</a>
<a href="services.html">Services</a><a href="areas.html">Service Areas</a><a href="contact.html">Contact</a>
<a href="services.html">Services</a><a href="tiling.html">Tiling</a><a href="bath.html">Bathroom Remodeling</a>
<a href="floors.html">Hardwood Floors</a><a href="grout.html">Grouting</a></nav>`;

const npPage = (title: string, body: string) => `<!doctype html><html><head>
<title>${title}</title></head><body>
<header class="site-header"><a class="brand" href="index.html"><span>NORTHPOINT</span><span>REMODELING</span></a>
${NORTHPOINT_NAV}</header>
<main>${body}</main>
<footer><p>Northpoint Remodeling</p><p>(555) 210-4400</p>
<p><a href="mailto:hello@northpointremodel.com">hello@northpointremodel.com</a></p></footer>
</body></html>`;

const NORTHPOINT_TEMPLATE: Record<string, string> = {
  "index.html": npPage(
    "Northpoint Remodeling - Beautiful Denver Kitchens &amp; Bathrooms",
    `<h1>Kitchen and bath remodeling in Cherry Creek. We handle the whole job.</h1>
     <p>A design-build crew based in Denver.</p>
     <h2>SELECTED WORK</h2>
     <p>Proof that a remodel can run on schedule.</p>
     <div class="cards">
       <h3>Home Additions</h3><p>Additions that match the house you already have.</p>
       <h3>Bathroom Remodeling</h3><p>Zero surprises once the tile goes down.</p>
       <h3>Small Repairs</h3><p>The crew shows up for the little jobs too.</p>
     </div>`
  ),
  "about.html": npPage(
    "About Us - Northpoint Remodeling",
    `<h2>Who we are</h2><p>Twenty years of work in Cherry Creek. We answer the phone.</p>
     <div class="cards">
       <h3>Home Additions</h3><p>Additions built to last.</p>
       <h3>Bathroom Remodeling</h3><p>Zero shortcuts.</p>
       <h3>Small Repairs</h3><p>The same crew, every time.</p>
     </div>`
  ),
  "services.html": npPage(
    "Remodeling Services in Cherry Creek - Northpoint Remodeling",
    `<h2>What we do</h2><p>Serving Cherry Creek and Denver.</p>
     <h3>Small Repairs</h3><p>The list nobody else will take.</p>`
  ),
};

/** The second live template: the service-area list and the shop hours. */
const TACOMA_TEMPLATE: Record<string, string> = {
  "index.html": `<!doctype html><html><head><title>Cascadia Tile - Tacoma Tile &amp; Grout</title></head>
<body><main><h1>Tile and grout done right</h1>
<p>Proudly serving Pierce County.</p>
<div class="areas"><span>Seattle</span> <span>Tacoma</span> <span>Auburn</span> <span>Kent</span>
<span>Federal Way</span> <span>Renton</span> <span>Puyallup</span> <span>Sumner</span>
<span>Bonney Lake</span> <span>Maple Valley</span> <span>Covington</span> <span>Lake Tapps</span></div>
<p>Not sure if we reach you? Just ask.</p>
<p>Visit the shop in Tacoma</p><p>Mon–Fri 7am to 5pm</p></main></body></html>`,
  "about.html": `<!doctype html><html><head><title>About - Cascadia Tile</title></head>
<body><main><h2>Our story</h2><p>A crew based in Tacoma. We have grouted a lot of showers.</p>
<p>Visit the shop in Tacoma</p><p>Mon–Fri 7am to 5pm</p></main></body></html>`,
};

describe("extractDemoTokens does not mint the production junk", () => {
  const tokens = extractDemoTokens(NORTHPOINT_TEMPLATE);
  const lower = tokens.map((t) => t.toLowerCase());

  it.each(NORTHPOINT_JUNK)("never emits %j", (junk) => {
    expect(lower).not.toContain(junk.toLowerCase());
  });

  const tacoma = extractDemoTokens(TACOMA_TEMPLATE).map((x) => x.toLowerCase());
  it.each([
    "Pierce County. Seattle Tacoma Auburn Kent Federal Way Renton Puyallup Sumner Bonney Lake Maple Valley Covington Lake Tapps Not",
    "Tacoma Mon",
  ])("never emits %j from the second template", (junk) => {
    expect(tacoma).not.toContain(junk.toLowerCase());
    // nor any prefix of it that still spans two utterances
    expect(tacoma.some((t) => t.startsWith("pierce county ") || t.startsWith("tacoma mon"))).toBe(false);
  });

  // Contact details are their own proof and keep their punctuation; every
  // PHRASE token must be free of it.
  const phrases = tokens.filter((t) => /\s/.test(t));

  it("emits no phrase that spans sentence punctuation", () => {
    for (const t of phrases) expect(`${t} :: ${/[.!?:;|•]/.test(t)}`).toBe(`${t} :: false`);
  });

  it("emits no phrase longer than four words", () => {
    for (const t of phrases) {
      const n = t.split(/[^a-zA-Z0-9]+/).filter(Boolean).length;
      expect(`${t} :: ${n > 4}`).toBe(`${t} :: false`);
    }
  });

  it("still extracts the real identity — the whole point of the gate", () => {
    expect(lower).toContain("northpoint remodeling");
    expect(lower).toContain("northpoint");
    expect(tokens).toContain("(555) 210-4400");
    expect(tokens).toContain("hello@northpointremodel.com");
    expect(tokens).toContain("northpointremodel.com");
    expect(lower).toContain("cherry creek");
    expect(lower).toContain("denver");
  });

  it("keeps the real geography of the second template", () => {
    const t = extractDemoTokens(TACOMA_TEMPLATE).map((x) => x.toLowerCase());
    expect(t).toContain("tacoma");
    expect(t.some((x) => x.includes("pierce county"))).toBe(true);
  });

  it("keeps the brand-bearing title segment, not the decorated title", () => {
    expect(lower).not.toContain("about us - northpoint remodeling");
    expect(lower).toContain("northpoint remodeling");
  });

  it("drops a phrase that already contains a shorter phrase token", () => {
    expect(lower).not.toContain("northpoint remodeling - beautiful denver kitchens & bathrooms");
    // "Cherry Creek" is a token, so the title segment that wraps it is redundant
    expect(lower).toContain("cherry creek");
    expect(lower).not.toContain("remodeling services in cherry creek");
    // but a single-word token never deletes the phrase a human needs to read
    expect(lower).toContain("northpoint");
    expect(lower).toContain("northpoint remodeling");
  });

  it("keeps an email whole even though the domain is also a token", () => {
    expect(tokens).toContain("hello@northpointremodel.com");
    expect(tokens).toContain("northpointremodel.com");
  });
});

describe("findLeaks gap is inline-only and bounded", () => {
  it("still catches a logo split across elements", () => {
    const t = ["Northpoint Remodeling"];
    expect(findLeaks({ "a.html": "<span>NORTHPOINT</span><span>REMODELING</span>" }, t)).toHaveLength(1);
    expect(
      findLeaks({ "a.html": `<a href="/"><span class="a">North</span> <em>Point</em></a>` }, ["North Point"])
    ).toHaveLength(1);
  });

  it("does not bridge a block boundary — the phantom-leak bug", () => {
    expect(
      findLeaks({ "a.html": "<p>Denver.</p><h2>SELECTED WORK</h2><p>Proof of work</p>" }, [
        "Denver. SELECTED WORK Proof",
      ])
    ).toEqual([]);
    expect(
      findLeaks({ "a.html": "<h3>Home Additions</h3><p>Additions that fit.</p>" }, ["Home Additions Additions"])
    ).toEqual([]);
    expect(
      findLeaks({ "a.html": "<h3>Small Repairs</h3><p>The crew shows up.</p>" }, ["Small Repairs The"])
    ).toEqual([]);
    expect(findLeaks({ "a.html": "<p>Serving Denver</p><p>Kitchens by us</p>" }, ["Denver Kitchens"])).toEqual([]);
  });

  it("does not bridge a paragraph of inline markup either", () => {
    const filler = "<em>a</em><b>b</b><i>c</i><u>d</u><em>e</em><b>f</b>";
    expect(findLeaks({ "a.html": `<p>Northpoint ${filler} Remodeling</p>` }, ["Northpoint Remodeling"])).toEqual([]);
  });

  it("requires a contiguous match for a token carrying sentence punctuation", () => {
    const t = ["Cherry Creek. We"];
    expect(findLeaks({ "a.html": "<p>Cherry Creek.</p><p>We build.</p>" }, t)).toEqual([]);
    expect(findLeaks({ "a.html": "<p>Cherry Creek. We build.</p>" }, t)).toHaveLength(1);
  });

  it("still catches a genuine contiguous leak in visible copy", () => {
    expect(
      findLeaks({ "a.html": "<p>Built by Northpoint Remodeling since 2004.</p>" }, ["Northpoint Remodeling"])
    ).toHaveLength(1);
  });

  it("still refuses to match King inside working", () => {
    expect(findLeaks({ "a.html": "<p>living and working spaces</p>" }, ["King"])).toEqual([]);
  });
});

// The case that is failing in production RIGHT NOW: an honest generated page,
// written for a different business, must produce zero leaks.
//
// The page keeps the template's SHAPE — same nav, same section rhythm, same
// "SELECTED WORK" heading followed by a paragraph — because that is what the
// regenerator is required to preserve, and it is exactly the shape that the
// tag-bridging gap turned into forty phantom leaks.
describe("a clean generated page produces no leaks against the fixed token set", () => {
  const tokens = extractDemoTokens(NORTHPOINT_TEMPLATE);

  const generated = `<!doctype html><html><head>
<title>Warrior Contracting - Kitchen &amp; Bath Remodeling in Boise</title></head><body>
<header class="site-header"><a class="brand" href="index.html"><span>WARRIOR</span><span>CONTRACTING</span></a>
<nav class="nav"><a href="index.html">Explore</a><a href="index.html">Home</a>
<a href="services.html">Services</a><a href="areas.html">Service Areas</a><a href="contact.html">Contact</a>
<a href="services.html">Services</a><a href="tiling.html">Tiling</a><a href="bath.html">Bathroom Remodeling</a>
<a href="floors.html">Hardwood Floors</a><a href="grout.html">Grouting</a></nav></header>
<main><h1>Kitchen and bath remodeling in Boise. We handle the whole job.</h1>
<p>A design-build crew based in Boise.</p>
<h2>SELECTED WORK</h2><p>Proof that a remodel can run on schedule.</p>
<div class="cards">
  <h3>Garage Conversions</h3><p>Extra square footage without moving house.</p>
  <h3>Bathroom Remodeling</h3><p>Zero surprises once the tile goes down.</p>
  <h3>Punch Lists</h3><p>The crew shows up for the little jobs too.</p>
</div>
<p>Booking is easy and parking is free while we are working.</p></main>
<footer><p>Warrior Contracting</p><p>(208) 555-7100</p>
<p><a href="mailto:hello@warriorcontracting.com">hello@warriorcontracting.com</a></p></footer>
</body></html>`;

  it("finds nothing", () => {
    const leaks = findLeaks({ "index.html": generated }, tokens);
    expect(leaks.map((l) => `${l.token} :: ${l.excerpt}`)).toEqual([]);
  });

  it("but still finds the demo identity if it survives", () => {
    const leaky = generated.replace("Warrior Contracting</p>", "Northpoint Remodeling</p>");
    expect(findLeaks({ "index.html": leaky }, tokens).length).toBeGreaterThan(0);
  });
});
