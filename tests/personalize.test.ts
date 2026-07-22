import { describe, it, expect, vi, beforeEach } from "vitest";

// The single seam: no live AI call is ever made in these tests.
const callForTask = vi.fn();
vi.mock("@/lib/ai-tools/providers/run", () => ({
  callForTask: (...a: unknown[]) => callForTask(...a),
}));

const {
  personalizeFile,
  classifyDemoTokens,
  clientIdentityOf,
  buildIdentityRules,
  substituteIdentity,
  planBatches,
  parseBatchResponse,
  applyImagesToHtml,
  buildScrubMachine,
  scrubText,
  batchPrompt,
  forbiddenForBatch,
  MAX_ITEMS_PER_BATCH,
} = await import("@/lib/template-engine/personalize");
const { runGates } = await import("@/lib/template-engine/gates");
const { findLeaks } = await import("@/lib/template-engine/demoTokens");

const DEMO_TOKENS = [
  "Northpoint Remodeling",
  "Northpoint",
  "(555) 210-4400",
  "5552104400",
  "hello@northpointremodel.com",
  "northpointremodel.com",
  "Cherry Creek",
];

const CONTENT_MODEL = {
  identity: {
    name: "Warrior Contracting",
    tagline: "Built to last",
    phone: "(720) 888-1212",
    email: "info@warriorcontracting.com",
    areas: ["Boulder"],
  },
  services: [{ key: "kitchens", name: "Kitchen remodels", short: "", long: "", bullets: [], image_query: "kitchen" }],
};

const PAGE = `<!doctype html>
<html lang="en">
<head>
  <title>Home - Northpoint Remodeling</title>
  <meta name="description" content="Remodeling by Northpoint Remodeling in Cherry Creek.">
</head>
<body class="page-home" data-page="home">
  <header class="site-header">
    <a class="brand" href="index.html"><span>NORTHPOINT</span><span>REMODELING</span></a>
  </header>
  <main>
    <h1 class="hero__title">Beautiful kitchens by Northpoint Remodeling</h1>
    <p>Call <a href="tel:5552104400">(555) 210-4400</a> or email <a href="mailto:hello@northpointremodel.com">hello@northpointremodel.com</a>.</p>
    <p>Visit northpointremodel.com for more.</p>
    <img src="img/hero.jpg" alt="A Northpoint kitchen" width="1200">
    <svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="10"/><path d="M4 4h16"/></svg>
    <button data-cta onclick="siteApp.open()">Book now</button>
  </main>
  <script>var x = 1;</script>
</body>
</html>
`;

const SCRIPT = `class SiteApp {
  constructor() {
    this.phone = "(555) 210-4400";
    this.email = "hello@northpointremodel.com";
    this.brand = "Northpoint Remodeling";
    this.testimonials = [{ quote: "Northpoint remodeled our kitchen.", name: "Dana R." }];
    this.root = document.querySelector(".site-header");
  }
  bindFaq() {
    document.querySelectorAll("[data-faq]").forEach((el) => el.classList.toggle("is-open"));
  }
}
window.siteApp = new SiteApp();
`;

/** A model that echoes every id back unchanged (a well-behaved, lazy model). */
function echoModel() {
  callForTask.mockImplementation(async (_task, _sys, prompt: string) => {
    const items = JSON.parse(/STRINGS \(\d+\)[^\n]*\n(\[[\s\S]*?\])\n\nReturn ONLY/.exec(prompt)![1]);
    const out: Record<string, string> = {};
    for (const i of items) out[i.id] = i.text;
    return { text: JSON.stringify(out), tokens: 0, providerKey: "mock", model: "mock" };
  });
}

beforeEach(() => {
  callForTask.mockReset();
});

describe("demo identity classification", () => {
  it("splits tokens into emails, domains, phones and brand", () => {
    const demo = classifyDemoTokens(DEMO_TOKENS);
    expect(demo.emails).toEqual(["hello@northpointremodel.com"]);
    expect(demo.domains).toEqual(["northpointremodel.com"]);
    expect(demo.phones).toEqual(["(555) 210-4400", "5552104400"]);
    expect(demo.brands).toEqual(["Northpoint Remodeling", "Northpoint"]);
    // Geography has no 1:1 client equivalent: the model handles it.
    expect(demo.brands).not.toContain("Cherry Creek");
  });

  it("derives the client's identity, including the tel: shape and the domain", () => {
    const client = clientIdentityOf(CONTENT_MODEL);
    expect(client.name).toBe("Warrior Contracting");
    expect(client.firstWord).toBe("Warrior");
    expect(client.phoneDigits).toBe("7208881212");
    expect(client.domain).toBe("warriorcontracting.com");
  });
});

describe("deterministic pre-pass", () => {
  const rules = buildIdentityRules(classifyDemoTokens(DEMO_TOKENS), clientIdentityOf(CONTENT_MODEL));

  it("replaces phone, email, domain and business name, case-insensitively", () => {
    expect(substituteIdentity("Call (555) 210-4400 now", rules)).toBe("Call (720) 888-1212 now");
    expect(substituteIdentity("tel:5552104400", rules)).toBe("tel:7208881212");
    expect(substituteIdentity("mailto:hello@northpointremodel.com", rules)).toBe("mailto:info@warriorcontracting.com");
    expect(substituteIdentity("Visit northpointremodel.com", rules)).toBe("Visit warriorcontracting.com");
    expect(substituteIdentity("Northpoint Remodeling builds", rules)).toBe("Warrior Contracting builds");
    expect(substituteIdentity("NORTHPOINT", rules)).toBe("Warrior");
  });

  it("never matches inside a longer word", () => {
    expect(substituteIdentity("northpointremodeling-street", rules)).toBe("northpointremodeling-street");
  });

  it("produces no rule for a class the client has no value for", () => {
    const noPhone = buildIdentityRules(classifyDemoTokens(DEMO_TOKENS), clientIdentityOf({ identity: { name: "X Co" } }));
    expect(substituteIdentity("(555) 210-4400", noPhone)).toBe("(555) 210-4400");
  });
});

describe("batching", () => {
  it("bounds every request by item count and by characters", () => {
    const items = Array.from({ length: 250 }, (_, i) => ({ id: `t${i}`, text: `Some copy number ${i}` }));
    const batches = planBatches(items);
    expect(batches.length).toBeGreaterThan(3);
    for (const b of batches) {
      expect(b.items.length).toBeLessThanOrEqual(MAX_ITEMS_PER_BATCH);
    }
    expect(batches.flatMap((b) => b.items).length).toBe(250);
  });

  it("gives an oversized string its own request rather than splitting it", () => {
    const items = [{ id: "a", text: "x".repeat(9000) }, { id: "b", text: "short copy" }];
    const batches = planBatches(items);
    expect(batches[0].items.map((i) => i.id)).toEqual(["a"]);
    expect(batches[1].items.map((i) => i.id)).toEqual(["b"]);
  });

  it("a real page produces multiple bounded requests", async () => {
    echoModel();
    const big = `<body>${Array.from({ length: 300 }, (_, i) => `<p>Paragraph number ${i} about remodeling work.</p>`).join("")}</body>`;
    const out = await personalizeFile({
      file: "big.html",
      source: big,
      contentModel: CONTENT_MODEL,
      imagesForFile: [],
      demoTokens: DEMO_TOKENS,
    });
    expect(out.stats.batches).toBeGreaterThan(4);
    expect(callForTask).toHaveBeenCalledTimes(out.stats.batches);
    for (const call of callForTask.mock.calls) {
      expect(String(call[2]).length).toBeLessThan(12000);
    }
  });
});

describe("parseBatchResponse", () => {
  it("accepts the plain object, a fenced object and an array of records", () => {
    expect(parseBatchResponse('{"t1":"A","t2":"B"}')).toEqual({ t1: "A", t2: "B" });
    expect(parseBatchResponse('```json\n{"t1":"A"}\n```')).toEqual({ t1: "A" });
    expect(parseBatchResponse('[{"id":"t1","text":"A"}]')).toEqual({ t1: "A" });
    expect(parseBatchResponse("sorry, I cannot")).toEqual({});
  });
});

describe("personalizeFile — HTML", () => {
  it("evicts the demo identity deterministically even when the model omits every id", async () => {
    callForTask.mockResolvedValue({ text: "{}", tokens: 0, providerKey: "mock", model: "mock" });
    const out = await personalizeFile({
      file: "index.html",
      source: PAGE,
      contentModel: CONTENT_MODEL,
      imagesForFile: [{ url: "https://cdn.test/hero.jpg", kind: "hero", slot_id: "hero" }],
      demoTokens: DEMO_TOKENS,
    });
    expect(out.text).toContain("(720) 888-1212");
    expect(out.text).toContain("tel:7208881212");
    expect(out.text).toContain("mailto:info@warriorcontracting.com");
    expect(out.text).toContain("Warrior Contracting");
    expect(out.text).not.toMatch(/northpoint/i);
    expect(out.stats.rewritten).toBe(0);
    expect(out.stats.deterministic).toBeGreaterThan(0);
  });

  it("keeps the original text for the ids the model omits, blanking nothing", async () => {
    callForTask.mockImplementation(async (_t, _s, prompt: string) => {
      const items = JSON.parse(/STRINGS \(\d+\)[^\n]*\n(\[[\s\S]*?\])\n\nReturn ONLY/.exec(prompt)![1]);
      const out: Record<string, string> = {};
      // Answer only half the ids — the classic small-model failure.
      items.slice(0, Math.ceil(items.length / 2)).forEach((i: { id: string }) => (out[i.id] = "Rewritten copy"));
      return { text: JSON.stringify(out), tokens: 0, providerKey: "mock", model: "mock" };
    });
    const out = await personalizeFile({
      file: "index.html",
      source: PAGE,
      contentModel: CONTENT_MODEL,
      imagesForFile: [],
      demoTokens: DEMO_TOKENS,
    });
    expect(out.stats.rewritten).toBeGreaterThan(0);
    expect(out.stats.keptOriginal).toBeGreaterThan(0);
    expect(out.text).not.toMatch(/><\/(?:p|h1|button|title)>/); // nothing blanked
    expect(out.text).toContain("Book now"); // a tail id the model skipped
  });

  it("throws when EVERY batch fails — a provider outage must not ship an unedited page", async () => {
    callForTask.mockRejectedValue(new Error("fetch failed"));
    await expect(
      personalizeFile({
        file: "index.html",
        source: PAGE,
        contentModel: CONTENT_MODEL,
        imagesForFile: [],
        demoTokens: DEMO_TOKENS,
      }),
    ).rejects.toThrow(/all \d+ model batch/);
  });

  it("passes a repair note through to the model", async () => {
    echoModel();
    await personalizeFile({
      file: "index.html",
      source: PAGE,
      contentModel: CONTENT_MODEL,
      imagesForFile: [],
      demoTokens: DEMO_TOKENS,
      repairNote: 'leaked token "Cherry Creek"',
    });
    expect(String(callForTask.mock.calls[0][2])).toContain('leaked token "Cherry Creek"');
  });
});

describe("personalizeFile — JS", () => {
  it("substitutes identity inside string literals and leaves the code alone", async () => {
    callForTask.mockResolvedValue({ text: "{}", tokens: 0, providerKey: "mock", model: "mock" });
    const out = await personalizeFile({
      file: "script.js",
      source: SCRIPT,
      contentModel: CONTENT_MODEL,
      imagesForFile: [],
      demoTokens: DEMO_TOKENS,
    });
    expect(out.text).toContain('this.phone = "(720) 888-1212";');
    expect(out.text).toContain('this.email = "info@warriorcontracting.com";');
    expect(out.text).toContain('this.brand = "Warrior Contracting";');
    expect(out.text).toContain('document.querySelector(".site-header")');
    expect(out.text).toContain('document.querySelectorAll("[data-faq]")');
    expect(out.text).toContain("window.siteApp = new SiteApp();");
    expect(out.text).not.toMatch(/northpoint/i);
  });
});

describe("applyImagesToHtml", () => {
  it("swaps img src/srcset in document order, cycling the list, and skips the logo", () => {
    const html = `<img class="logo" src="img/logo.png" alt="Logo"><img src="img/a.jpg" srcset="img/a.jpg 1x, img/a@2x.jpg 2x"><img src="img/b.jpg"><img src="img/c.jpg">`;
    const out = applyImagesToHtml(html, ["https://cdn/1.jpg", "https://cdn/2.jpg"]);
    expect(out.html).toContain(`class="logo" src="img/logo.png"`);
    expect(out.html).toContain(`src="https://cdn/1.jpg" srcset="https://cdn/1.jpg"`);
    expect(out.html).toContain(`<img src="https://cdn/2.jpg">`);
    expect(out.html).toContain(`<img src="https://cdn/1.jpg">`); // cycled
    expect(out.count).toBe(4); // src+srcset on the first, src on each of the others
  });

  it("rewrites an inline background image and escapes the url", () => {
    const html = `<div style="background-image:url('img/hero.jpg');color:red"></div>`;
    const out = applyImagesToHtml(html, ["https://cdn/x.jpg?a=1&b=2"]);
    expect(out.html).toBe(`<div style="background-image:url('https://cdn/x.jpg?a=1&amp;b=2');color:red"></div>`);
  });

  it("is a no-op with no images", () => {
    const html = `<img src="img/a.jpg">`;
    expect(applyImagesToHtml(html, []).html).toBe(html);
  });
});

describe("end to end: zero structure drift, zero leaks", () => {
  it("a personalised page and script pass both gates", async () => {
    // A model that rewrites everything it is given — the maximal-change case.
    callForTask.mockImplementation(async (_t, _s, prompt: string) => {
      const items = JSON.parse(/STRINGS \(\d+\)[^\n]*\n(\[[\s\S]*?\])\n\nReturn ONLY/.exec(prompt)![1]);
      const out: Record<string, string> = {};
      for (const i of items as { id: string }[]) out[i.id] = `Warrior Contracting copy ${i.id}`;
      return { text: JSON.stringify(out), tokens: 0, providerKey: "mock", model: "mock" };
    });

    const page = await personalizeFile({
      file: "index.html",
      source: PAGE,
      contentModel: CONTENT_MODEL,
      imagesForFile: [{ url: "https://cdn.test/hero.jpg", kind: "hero", slot_id: "hero" }],
      demoTokens: DEMO_TOKENS,
    });
    const script = await personalizeFile({
      file: "script.js",
      source: SCRIPT,
      contentModel: CONTENT_MODEL,
      imagesForFile: [],
      demoTokens: DEMO_TOKENS,
    });

    const gate = runGates({
      template: { "index.html": PAGE, "script.js": SCRIPT },
      output: { "index.html": page.text, "script.js": script.text },
      demoTokens: DEMO_TOKENS,
    });
    expect(gate.leaks).toEqual([]);
    expect(gate.structure.filter((s) => !s.ok)).toEqual([]);
    expect(gate.ok).toBe(true);
    // and the template's images are gone
    expect(page.text).not.toContain("img/hero.jpg");
  });
});

describe("places the extractors deliberately skip, which the leak gate still reads", () => {
  it("evicts the demo identity from HTML comments, inline scripts and JS comments", async () => {
    callForTask.mockResolvedValue({ text: "{}", tokens: 0, providerKey: "mock", model: "mock" });
    const page = `<body>
  <!-- Northpoint Remodeling header, call (555) 210-4400 -->
  <div class="x">Copy</div>
  <script>
    // Northpoint config
    window.CONFIG = { phone: "(555) 210-4400", site: "northpointremodel.com" };
  </script>
  <script src="script.js"></script>
</body>`;
    const out = await personalizeFile({
      file: "index.html",
      source: page,
      contentModel: CONTENT_MODEL,
      imagesForFile: [],
      demoTokens: DEMO_TOKENS,
    });
    expect(out.text).not.toMatch(/northpoint/i);
    expect(out.text).not.toContain("(555) 210-4400");
    expect(out.text).toContain("window.CONFIG = {");
    expect(out.text).toContain(`<script src="script.js"></script>`);
    expect(out.text).toContain(`phone: "(720) 888-1212"`);
  });

  it("evicts it from a .js file's comments too", async () => {
    callForTask.mockResolvedValue({ text: "{}", tokens: 0, providerKey: "mock", model: "mock" });
    const out = await personalizeFile({
      file: "script.js",
      source: `/* Northpoint Remodeling — built 2019 */\nconst n = 1; // call (555) 210-4400\n`,
      contentModel: CONTENT_MODEL,
      imagesForFile: [],
      demoTokens: DEMO_TOKENS,
    });
    expect(out.text).toBe(`/* Warrior Contracting — built 2019 */\nconst n = 1; // call (720) 888-1212\n`);
  });
});

// The real production failure: a Denver *remodeling* template rebuilt for
// "Knights Auto Window Tint", a window-tint shop that lists NO service areas.
// After the model pass the structure was perfect; what hard-failed the leak gate
// was surviving demo IDENTITY — neighbourhoods, a fictional family, and two demo
// service headings.
const DEMO_KNIGHTS = [
  "Northpoint Remodeling",
  "Northpoint",
  "(555) 210-4400",
  "5552104400",
  "hello@northpointremodel.com",
  "northpointremodel.com",
  "Cherry Creek",
  "Denver",
  "LoDo",
  "Wash Park",
  "Maple Grove",
  "Centennial",
  "Oak Park",
  "Cedar Heights",
  "The Alvarez Family",
  "Home Additions",
  "Basement Finishing",
];

// service_areas: null → no client area to swap a demo neighbourhood for.
const KNIGHTS_MODEL = {
  identity: {
    name: "Knights Auto Window Tint",
    tagline: "Cooler rides, clearer views",
    phone: "(303) 555-9000",
    email: "info@knightstint.com",
    areas: [] as string[],
  },
  services: [
    { key: "auto", name: "Automotive Window Tinting", short: "", long: "", bullets: [], image_query: "car tint" },
    { key: "ceramic", name: "Ceramic Tint", short: "", long: "", bullets: [], image_query: "ceramic tint" },
    { key: "removal", name: "Tint Removal", short: "", long: "", bullets: [], image_query: "tint removal" },
  ],
};

describe("the deterministic identity scrub — the guarantee", () => {
  it("removes a demo neighbourhood the client cannot replace, cleanly (no double space)", () => {
    const m = buildScrubMachine(DEMO_KNIGHTS, KNIGHTS_MODEL);
    const out = scrubText("Beautiful Denver Kitchens & Bathrooms", m);
    expect(out).toBe("Beautiful Kitchens & Bathrooms");
    expect(out).not.toMatch(/denver/i);
    expect(out).not.toMatch(/ {2,}/);
  });

  it("turns a dangling place list into a neutral, no orphaned 'and'", () => {
    const m = buildScrubMachine(DEMO_KNIGHTS, KNIGHTS_MODEL);
    const out = scrubText("Serving Cherry Creek and Denver", m);
    expect(out).toBe("Serving the local area");
    expect(out).not.toMatch(/cherry|denver|\band\s*$/i);
  });

  it("maps a demo service heading to one of the client's own services", () => {
    const m = buildScrubMachine(DEMO_KNIGHTS, KNIGHTS_MODEL);
    const out = scrubText("Our Home Additions team is ready", m);
    expect(out).not.toMatch(/home additions/i);
    expect(out).toContain("Automotive Window Tinting");
  });

  it("removes a demo family name, falling back to a neutral rather than blanking", () => {
    const m = buildScrubMachine(DEMO_KNIGHTS, KNIGHTS_MODEL);
    expect(scrubText("The Alvarez Family", m)).toBe("a valued client");
    expect(scrubText("Cherry Creek", m)).toBe("the local area");
  });

  it("replaces cities with client areas (cycled) when the client HAS service areas", () => {
    const withAreas = {
      ...KNIGHTS_MODEL,
      identity: { ...KNIGHTS_MODEL.identity, areas: ["Aurora", "Littleton"] },
    };
    const m = buildScrubMachine(DEMO_KNIGHTS, withAreas);
    const out = scrubText("We proudly serve Cherry Creek, Denver and LoDo", m);
    expect(out).not.toMatch(/cherry|denver|lodo/i);
    expect(out).toContain("Aurora");
    expect(out).toContain("Littleton");
  });

  it("is idempotent and never empties a non-empty string", () => {
    const m = buildScrubMachine(DEMO_KNIGHTS, KNIGHTS_MODEL);
    for (const input of [
      "Serving Cherry Creek and Denver",
      "Beautiful Denver Kitchens & Bathrooms",
      "The Alvarez Family",
      "Home Additions and Basement Finishing in Maple Grove",
      "Cherry Creek",
    ]) {
      const once = scrubText(input, m);
      const twice = scrubText(once, m);
      expect(twice).toBe(once);
      expect(once.trim().length).toBeGreaterThan(0);
    }
  });

  it("the forbidden list names only the demo tokens present in a batch", () => {
    const batch = {
      items: [
        { id: "t1", text: "Remodeling across Cherry Creek and Denver" },
        { id: "t2", text: "Our Home Additions crew" },
      ],
      chars: 0,
    };
    const forbidden = forbiddenForBatch(DEMO_KNIGHTS, batch);
    expect(forbidden).toContain("Cherry Creek");
    expect(forbidden).toContain("Denver");
    expect(forbidden).toContain("Home Additions");
    // Not in the batch text → not in the prompt.
    expect(forbidden).not.toContain("Basement Finishing");
    expect(forbidden).not.toContain("Oak Park");
    const prompt = batchPrompt({ file: "index.html", contentModel: KNIGHTS_MODEL, batch, demoTokens: DEMO_KNIGHTS });
    expect(prompt).toContain("FORBIDDEN");
    expect(prompt).toContain("Cherry Creek");
    expect(prompt).toMatch(/STRINGS \(2\)/);
    expect(prompt).toContain("Return ONLY");
  });
});

describe("the scrub guarantees zero leaks even when the model changes NOTHING", () => {
  // The worst case named in the task: components.js parks its demo geography, a
  // fictional family and its service headings in JS string literals — some of
  // which the extractor marks non-translatable — and the model returns every id
  // unchanged. The scrub, operating on final text regardless, must still leave
  // findLeaks nothing to find.
  const COMPONENTS = `export const AREAS = ["Cherry Creek", "Denver", "LoDo", "Wash Park", "Maple Grove", "Centennial", "Oak Park", "Cedar Heights"];
export const SERVICES = ["Home Additions", "Basement Finishing"];
export const TESTIMONIAL = { quote: "Best remodel in Denver.", author: "The Alvarez Family" };
function mount(el) { el.querySelector(".hero"); return "<section>Serving Cherry Creek and Denver</section>"; }`;

  const INDEX = `<!doctype html>
<html><head><title>Home Additions in Cherry Creek</title>
<meta name="description" content="Remodeling across Denver and Wash Park.">
</head><body>
  <!-- Basement Finishing promo for Cherry Creek -->
  <h1>Home Additions and Basement Finishing</h1>
  <p>Proudly serving Cherry Creek, Denver and Wash Park.</p>
  <blockquote>Loved our new kitchen. — The Alvarez Family</blockquote>
  <script>window.CONFIG = { city: "Denver", hood: "Cherry Creek" };</script>
</body></html>`;

  it("evicts every demo token from a components.js of string literals", async () => {
    echoModel();
    const out = await personalizeFile({
      file: "components.js",
      source: COMPONENTS,
      contentModel: KNIGHTS_MODEL,
      imagesForFile: [],
      demoTokens: DEMO_KNIGHTS,
    });
    expect(findLeaks({ "components.js": out.text }, DEMO_KNIGHTS)).toEqual([]);
    // still valid JS shape: the code the extractor left alone is untouched
    expect(out.text).toContain('el.querySelector(".hero")');
    expect(out.text).toContain("export const AREAS =");
  });

  it("evicts every demo token from index.html — text, comments and inline script", async () => {
    echoModel();
    const out = await personalizeFile({
      file: "index.html",
      source: INDEX,
      contentModel: KNIGHTS_MODEL,
      imagesForFile: [],
      demoTokens: DEMO_KNIGHTS,
    });
    expect(findLeaks({ "index.html": out.text }, DEMO_KNIGHTS)).toEqual([]);
    expect(out.text).toContain("window.CONFIG = {");
  });

  it("both files pass the full gate against the real survivor set", async () => {
    echoModel();
    const components = await personalizeFile({
      file: "components.js",
      source: COMPONENTS,
      contentModel: KNIGHTS_MODEL,
      imagesForFile: [],
      demoTokens: DEMO_KNIGHTS,
    });
    const index = await personalizeFile({
      file: "index.html",
      source: INDEX,
      contentModel: KNIGHTS_MODEL,
      imagesForFile: [],
      demoTokens: DEMO_KNIGHTS,
    });
    const gate = runGates({
      template: { "components.js": COMPONENTS, "index.html": INDEX },
      output: { "components.js": components.text, "index.html": index.text },
      demoTokens: DEMO_KNIGHTS,
    });
    expect(gate.leaks).toEqual([]);
    expect(gate.ok).toBe(true);
  });
});

describe("regen_mode switch", () => {
  it("defaults to the new text-only path and only opts out on an explicit flag", async () => {
    const { regenModeOf } = await import("@/lib/template-engine/runnerV2");
    expect(regenModeOf(undefined)).toBe("text");
    expect(regenModeOf({})).toBe("text");
    expect(regenModeOf({ exclude_people: true })).toBe("text");
    expect(regenModeOf({ regen_mode: "text" })).toBe("text");
    expect(regenModeOf({ regen_mode: "nonsense" })).toBe("text");
    expect(regenModeOf({ regen_mode: "whole_file" })).toBe("whole_file");
  });
});
