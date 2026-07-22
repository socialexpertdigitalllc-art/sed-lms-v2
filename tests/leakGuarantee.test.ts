import { describe, it, expect, vi } from "vitest";

// leakGuarantee imports personalize (for the classification/replacement logic),
// which imports the provider seam — mock it so no live AI call is possible.
vi.mock("@/lib/ai-tools/providers/run", () => ({
  callForTask: vi.fn(async () => {
    throw new Error("no live AI calls in leakGuarantee tests");
  }),
}));

const { guaranteeNoLeaks, describeLeakGuarantee, MAX_GUARANTEE_PASSES } = await import(
  "@/lib/template-engine/leakGuarantee"
);
const { findLeaks, findTokenMatches } = await import("@/lib/template-engine/demoTokens");
const { runGates } = await import("@/lib/template-engine/gates");

/** The realistic token set: brand phrase first, then its words, contacts, places. */
const TOKENS = [
  "Northpoint Remodeling",
  "Northpoint",
  "hello@northpointremodel.com",
  "northpointremodel.com",
  "(555) 210-4400",
  "5552104400",
  "Hilltop",
  "Centennial",
  "Denver",
  "Colorado",
  "Cherry Creek",
  "Home Additions",
  "The Alvarez Family",
];

const MODEL = {
  identity: {
    name: "Warrior Contracting",
    phone: "(720) 888-1212",
    email: "info@warriorcontracting.com",
    areas: ["Aurora", "Littleton"],
  },
  services: [{ name: "Kitchen remodels" }, { name: "Bathroom remodels" }],
};

const MODEL_NO_AREAS = {
  identity: { ...MODEL.identity, areas: [] as string[] },
  services: MODEL.services,
};

// The EXACT failure from generation 5de9fe33: demo geography inside map iframe
// URLs on service-areas.html. `src` values are (correctly) never extracted for
// the model, but findLeaks (correctly) scans src — so the text scrub never saw
// these and the repair loop made no progress.
const MAP_PAGE = `<!doctype html>
<html><body class="page-areas">
  <h2>Where we work</h2>
  <div class="map-embed"><iframe src="https://maps.google.com/maps?q=Hilltop,%20Denver&t=&z=13&ie=UTF8&iwloc=&output=embed" title="Service area map"></iframe></div>
  <div class="map-embed"><iframe src="https://maps.google.com/maps?q=Centennial,%20Colorado&t=&z=13&ie=UTF8&iwloc=&output=embed" title="Service area map"></iframe></div>
</body></html>`;

describe("the real failure: demo geography in map iframe URLs", () => {
  it("rewrites the map queries to client areas and passes findLeaks", () => {
    const { files, report } = guaranteeNoLeaks({
      files: { "service-areas.html": MAP_PAGE },
      demoTokens: TOKENS,
      contentModel: MODEL,
    });
    const out = files["service-areas.html"];
    // Both URLs now query a client area — URL-encoded, still a valid maps query.
    expect(out).toMatch(/src="https:\/\/maps\.google\.com\/maps\?q=(?:Aurora|Littleton),%20Denver&t=&z=13/);
    expect(out).toMatch(/src="https:\/\/maps\.google\.com\/maps\?q=(?:Aurora|Littleton),%20Colorado&t=&z=13/);
    // The two maps get DIFFERENT areas (the cycling cursor is shared).
    expect(out).toContain("q=Aurora");
    expect(out).toContain("q=Littleton");
    // The postcondition — the whole point of the module.
    expect(findLeaks(files, TOKENS)).toEqual([]);
    expect(report.fixes.length).toBeGreaterThan(0);
    expect(report.fixes.every((f) => f.context === "map URL")).toBe(true);
    expect(report.forcedDeletions).toBe(0);
  });

  it("keeps the page structurally identical, so the FULL gate passes", () => {
    const { files } = guaranteeNoLeaks({
      files: { "service-areas.html": MAP_PAGE },
      demoTokens: TOKENS,
      contentModel: MODEL,
    });
    const gate = runGates({
      template: { "service-areas.html": MAP_PAGE },
      output: files,
      demoTokens: TOKENS,
    });
    expect(gate.leaks).toEqual([]);
    expect(gate.ok).toBe(true);
  });

  it("with NO client areas, removes the geography cleanly — no dangling separators", () => {
    const { files } = guaranteeNoLeaks({
      files: { "service-areas.html": MAP_PAGE },
      demoTokens: TOKENS,
      contentModel: MODEL_NO_AREAS,
    });
    const out = files["service-areas.html"];
    expect(findLeaks(files, TOKENS)).toEqual([]);
    // No wreckage in the URLs: no doubled or dangling encoded separators.
    expect(out).not.toMatch(/%20%20/);
    expect(out).not.toMatch(/q=(?:,|%2C|%20)/i);
    expect(out).not.toMatch(/(?:,|%2C|%20)+&/i);
    // The iframes themselves survive.
    expect(out.match(/<iframe /g)?.length).toBe(2);
  });

  it("needs the loop: deleting the leading term exposes the next one to the matcher", () => {
    // In `q=Hilltop,%20Denver` the matcher cannot see "Denver" (it sits after
    // the `0` of %20, a word character). Deleting "Hilltop,%20" exposes it —
    // only the re-run of findLeaks (pass 2) catches that.
    const { files, report } = guaranteeNoLeaks({
      files: { "service-areas.html": MAP_PAGE },
      demoTokens: TOKENS,
      contentModel: MODEL_NO_AREAS,
    });
    expect(report.passes).toBeGreaterThanOrEqual(2);
    expect(report.passes).toBeLessThanOrEqual(MAX_GUARANTEE_PASSES);
    expect(files["service-areas.html"]).not.toMatch(/Hilltop|Centennial|q=Denver|q=Colorado/);
  });
});

describe("the earlier leak classes are covered by construction", () => {
  it("JS string literals (the components.js case)", () => {
    const js = `const CONFIG = {
  brand: "Northpoint Remodeling",
  phone: "(555) 210-4400",
  email: "hello@northpointremodel.com",
  footer: "Proudly serving Hilltop and Centennial",
};
window.renderFooter = () => CONFIG.footer;`;
    const { files } = guaranteeNoLeaks({
      files: { "components.js": js },
      demoTokens: TOKENS,
      contentModel: MODEL,
    });
    const out = files["components.js"];
    expect(findLeaks(files, TOKENS)).toEqual([]);
    expect(out).toContain('"Warrior Contracting"');
    expect(out).toContain("(720) 888-1212");
    expect(out).toContain("info@warriorcontracting.com");
    expect(out).toMatch(/Aurora|Littleton/);
  });

  it("HTML comments and inline scripts", () => {
    const html = `<html><body>
<!-- Northpoint Remodeling: hero for Cherry Creek -->
<h1>Welcome</h1>
<script>var cfg = { office: "Hilltop", phone: "5552104400" };</script>
</body></html>`;
    const { files } = guaranteeNoLeaks({
      files: { "index.html": html },
      demoTokens: TOKENS,
      contentModel: MODEL,
    });
    expect(findLeaks(files, TOKENS)).toEqual([]);
    expect(files["index.html"]).toContain("Warrior Contracting");
    expect(files["index.html"]).toContain("7208881212");
  });

  it("a split logo: replaces the text but preserves every bridged tag", () => {
    const html = `<html><body><header>
<a class="brand" href="index.html"><span>NORTHPOINT</span><span>REMODELING</span></a>
</header></body></html>`;
    const { files } = guaranteeNoLeaks({
      files: { "index.html": html },
      demoTokens: TOKENS,
      contentModel: MODEL,
    });
    const out = files["index.html"];
    expect(findLeaks(files, TOKENS)).toEqual([]);
    // The two spans the CSS is wired to are still there.
    expect(out.match(/<span>/g)?.length).toBe(2);
    expect(out.match(/<\/span>/g)?.length).toBe(2);
    expect(out).toContain("Warrior Contracting");
    // And the gate agrees the structure survived.
    const gate = runGates({ template: { "index.html": html }, output: files, demoTokens: TOKENS });
    expect(gate.ok).toBe(true);
  });

  it("service headings become client services; persons become the neutral", () => {
    const html = `<html><body>
<h2>Home Additions</h2>
<p>Ask The Alvarez Family about our work in Cherry Creek.</p>
</body></html>`;
    const { files } = guaranteeNoLeaks({
      files: { "services.html": html },
      demoTokens: TOKENS,
      contentModel: MODEL,
    });
    const out = files["services.html"];
    expect(findLeaks(files, TOKENS)).toEqual([]);
    expect(out).toMatch(/<h2>(Kitchen|Bathroom) remodels<\/h2>/);
    expect(out).toContain("a valued client");
    expect(out).toMatch(/Aurora|Littleton/);
  });
});

describe("masked structural attributes are invisible — to the gate AND the scrub", () => {
  it("a token inside class/id/data-* is neither reported nor rewritten", () => {
    const html = `<html><body>
<div class="hilltop-card" id="hilltop" data-region="Hilltop">Great local work.</div>
</body></html>`;
    const input = { "index.html": html };
    expect(findLeaks(input, TOKENS)).toEqual([]);
    const { files, report } = guaranteeNoLeaks({ files: input, demoTokens: TOKENS, contentModel: MODEL });
    expect(files["index.html"]).toBe(html);
    expect(report.passes).toBe(0);
    expect(report.fixes).toEqual([]);
  });

  it("fixes the visible occurrence while leaving the structural one alone", () => {
    const html = `<div class="hilltop-card">Serving Hilltop with pride.</div>`;
    const { files } = guaranteeNoLeaks({
      files: { "a.html": html },
      demoTokens: TOKENS,
      contentModel: MODEL,
    });
    expect(files["a.html"]).toContain('class="hilltop-card"');
    expect(files["a.html"]).toMatch(/Serving (Aurora|Littleton) with pride\./);
    expect(findLeaks(files, TOKENS)).toEqual([]);
  });
});

describe("findTokenMatches — the gate's matcher, exported as the single oracle", () => {
  it("returns every occurrence with offsets into the original text", () => {
    const content = "Hilltop is great. We love Hilltop.";
    const ms = findTokenMatches(content, "Hilltop");
    expect(ms).toEqual([
      { start: 0, end: 7 },
      { start: 26, end: 33 },
    ]);
    expect(content.slice(ms[1].start, ms[1].end)).toBe("Hilltop");
  });

  it("keeps the King/working boundary rule (no substring matches)", () => {
    expect(findTokenMatches("We are working on booking and parking.", "King")).toEqual([]);
    expect(findTokenMatches("King's crew is here", "King").length).toBe(1);
  });

  it("bridges inline markup exactly like findLeaks (split logo)", () => {
    const html = `<span>NORTHPOINT</span><span>REMODELING</span>`;
    const ms = findTokenMatches(html, "Northpoint Remodeling");
    expect(ms.length).toBe(1);
    expect(html.slice(ms[0].start, ms[0].end)).toBe("NORTHPOINT</span><span>REMODELING");
  });

  it("does not bridge block boundaries", () => {
    const html = `<p>Northpoint</p><p>Remodeling</p>`;
    expect(findTokenMatches(html, "Northpoint Remodeling")).toEqual([]);
  });

  it("never matches inside masked class/id/data-* values", () => {
    expect(findTokenMatches(`<div class="hilltop-card">x</div>`, "Hilltop")).toEqual([]);
    expect(findTokenMatches(`<div data-place="Hilltop">x</div>`, "Hilltop")).toEqual([]);
  });

  it("agrees with findLeaks about whether any file leaks — one matcher, not two", () => {
    const samples = [
      MAP_PAGE,
      `<div class="hilltop">clean</div>`,
      `<span>NORTHPOINT</span><span>REMODELING</span>`,
      `working booking parking`,
      `<!-- Cherry Creek -->`,
      `<a href="mailto:hello@northpointremodel.com">mail</a>`,
    ];
    for (const content of samples) {
      for (const token of TOKENS) {
        const viaMatches = findTokenMatches(content, token).length > 0;
        const viaGate = findLeaks({ "f.html": content }, [token]).length > 0;
        expect(viaMatches, `${token} in ${content.slice(0, 40)}`).toBe(viaGate);
      }
    }
  });
});

describe("the postcondition is a guarantee, not a hope", () => {
  it("holds when the client's own name contains a demo word", () => {
    // "Acme" is both the demo brand word AND the client's first word — the
    // replacement re-introduces the token, so the chooser must fall back to
    // deletion rather than loop forever.
    const tokens = ["Acme Remodeling", "Acme"];
    const model = { identity: { name: "Acme Painting", areas: [] as string[] }, services: [] };
    const { files } = guaranteeNoLeaks({
      files: { "index.html": `<p>Acme Remodeling is here. Call Acme today.</p>` },
      demoTokens: tokens,
      contentModel: model,
    });
    expect(findLeaks(files, tokens)).toEqual([]);
  });

  it("terminal deletion: adversarial client data that ping-pongs tokens still ends leak-free", () => {
    // Brand replacement introduces "Gamma"; the only area for "Gamma"
    // introduces "Alpha"; "Alpha"'s replacement introduces "Gamma" again. The
    // pass cap breaks the cycle and the terminal stage deletes the ranges.
    const tokens = ["Alpha Beta", "Alpha", "Gamma"];
    const model = { identity: { name: "Gamma Corp", areas: ["Alpha City"] }, services: [] };
    const input = { "index.html": `<p>Alpha Beta rocks</p>` };
    const { files, report } = guaranteeNoLeaks({ files: input, demoTokens: tokens, contentModel: model });
    expect(findLeaks(files, tokens)).toEqual([]);
    expect(report.forcedDeletions).toBeGreaterThan(0);
  });

  it("property: over a grab-bag of files and token sets, findLeaks is always [] and the pass is idempotent", () => {
    const fileSets: Record<string, string>[] = [
      { "service-areas.html": MAP_PAGE },
      {
        "index.html": `<html><head><title>Home - Northpoint Remodeling</title></head><body>
<!-- Northpoint hero -->
<div style="background-image: url('img/Hilltop-banner.jpg')">Serving Hilltop &amp; Centennial</div>
<img srcset="https://cdn.example.com/Hilltop.jpg 1x, https://cdn.example.com/Hilltop@2x.jpg 2x" src="x.jpg" alt="Hilltop crew">
<a href="tel:5552104400">(555) 210-4400</a>
<script>var v = { area: "Cherry Creek" };</script>
</body></html>`,
        "components.js": `const brand = "Northpoint Remodeling"; // Northpoint footer\nconst place = 'Hilltop';`,
      },
      {
        "weird.html": `<p>Hilltop, Centennial &amp; Denver</p><p>NORTHPOINT&nbsp;REMODELING</p><iframe src="https://maps.google.com/maps?q=Cherry%20Creek,%20Denver&z=13"></iframe>`,
      },
    ];
    const models = [MODEL, MODEL_NO_AREAS, { identity: { name: "" }, services: [] }, null];
    for (const files of fileSets) {
      for (const contentModel of models) {
        const first = guaranteeNoLeaks({ files, demoTokens: TOKENS, contentModel });
        expect(findLeaks(first.files, TOKENS), JSON.stringify({ contentModel })).toEqual([]);
        const second = guaranteeNoLeaks({ files: first.files, demoTokens: TOKENS, contentModel });
        expect(second.files).toEqual(first.files);
        expect(second.report.passes).toBe(0);
        expect(second.report.fixes).toEqual([]);
      }
    }
  });

  it("clean files pass through untouched with an empty report", () => {
    const files = { "index.html": `<p>Warrior Contracting serves Aurora.</p>` };
    const { files: out, report } = guaranteeNoLeaks({ files, demoTokens: TOKENS, contentModel: MODEL });
    expect(out).toEqual(files);
    expect(report).toEqual({ passes: 0, fixes: [], forcedDeletions: 0 });
    expect(describeLeakGuarantee(report)).toBe("");
  });
});

describe("the operator-facing report", () => {
  it("names each fix as token→replacement with its context", () => {
    const { report } = guaranteeNoLeaks({
      files: { "service-areas.html": MAP_PAGE },
      demoTokens: TOKENS,
      contentModel: MODEL,
    });
    const line = describeLeakGuarantee(report);
    expect(line).toMatch(/^leak guarantee fixed 2 occurrence\(s\): /);
    expect(line).toMatch(/Hilltop→(Aurora|Littleton) \(map URL\)/);
    expect(line).toMatch(/Centennial→(Aurora|Littleton) \(map URL\)/);
  });

  it("reports removals and counts multiple occurrences per token", () => {
    const { report } = guaranteeNoLeaks({
      files: { "a.html": `<p>Hilltop and Hilltop again</p>` },
      demoTokens: TOKENS,
      contentModel: MODEL_NO_AREAS,
    });
    const fix = report.fixes.find((f) => f.token === "Hilltop");
    expect(fix?.occurrences).toBe(2);
    expect(describeLeakGuarantee(report)).toContain("Hilltop→");
  });
});
