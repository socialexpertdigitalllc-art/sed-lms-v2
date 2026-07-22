import { describe, it, expect } from "vitest";
import { extractDemoTokens } from "@/lib/template-engine/demoTokens";
import {
  runTemplateHealthChecks,
  isHealthReport,
  ORDINARY_COPY_CORPUS,
  SEVERITY_RANK,
  type HealthReport,
} from "@/lib/template-engine/health";
import type { TemplateManifest } from "@/lib/template-engine/types";

const severity = (r: HealthReport, id: string) => r.checks.find((c) => c.id === id)?.severity;
const detail = (r: HealthReport, id: string) => r.checks.find((c) => c.id === id)?.detail ?? "";

// ---------------------------------------------------------------------------
// A HEALTHY template — the shape a prepared template is supposed to have.
// ---------------------------------------------------------------------------

const HEALTHY_CSS = `
:root {
  --primary: #1f6f5c;
  --primary-dark: #14503f;
  --highlight: #e08a1e;
  --ink: #1a1a1a;
  --paper: #ffffff;
}
body { color: var(--ink); background: var(--paper); }
.btn { background: var(--primary); color: var(--paper); }
.btn:hover { background: var(--primary-dark); }
.badge { background: var(--highlight); }
.site-header { border-bottom: 1px solid var(--primary); }
`;

const healthyPage = (title: string, body: string) => `<!doctype html>
<html lang="en">
<head><meta charset="utf-8"><title>${title} - Northpoint Remodeling</title>
<link rel="stylesheet" href="style.css"></head>
<body>
  <header class="site-header">
    <a class="brand" href="index.html"><img src="images/logo.svg" alt="Northpoint Remodeling"></a>
    <nav class="nav">
      <ul>
        <li><a href="index.html">Home</a></li>
        <li><a href="about.html">About</a></li>
        <li><a href="contact.html">Contact</a></li>
      </ul>
    </nav>
  </header>
  <main>${body}</main>
  <footer class="site-footer"><p>Northpoint Remodeling, (303) 555-0142, hello@northpoint-remodel.com</p></footer>
  <script src="script.js"></script>
</body>
</html>`;

const HEALTHY_TEMPLATE: Record<string, string> = {
  "index.html": healthyPage(
    "Home",
    `<h1>Kitchen and bath remodeling</h1>
     <p>Serving Denver and the surrounding suburbs since 2004.</p>
     <img src="images/hero.jpg" alt="A finished kitchen">`
  ),
  "about.html": healthyPage(
    "About Us",
    `<h2>Who we are</h2>
     <p>Serving Denver homeowners with a crew that shows up when it says it will.</p>
     <img src="images/crew.jpg" alt="The crew on site">`
  ),
  "contact.html": healthyPage(
    "Contact",
    `<h2>Get in touch</h2>
     <p>Call (303) 555-0142 or email hello@northpoint-remodel.com.</p>
     <img src="images/office.jpg" alt="The office">`
  ),
  "style.css": HEALTHY_CSS,
  "script.js": `class SiteApp { init() { this.bindNav(); } bindNav() { return true; } }`,
};

const HEALTHY_MANIFEST = {
  pages: [
    { file: "index.html", title: "Home", kind: "home" },
    { file: "about.html", title: "About Us", kind: "about" },
    { file: "contact.html", title: "Contact", kind: "contact" },
  ],
  css: ["style.css"],
  js: ["script.js"],
  components: null,
  assets: [],
  imageFiles: [],
  totalBytes: 4096,
} as unknown as TemplateManifest;

// ---------------------------------------------------------------------------
// The DELIBERATELY BAD template — all three production failures at once.
//
//  1. the demo business is named with an ordinary English word ("Comfort"),
//     which the leak gate will then find in perfectly good client copy;
//  2. the stylesheet declares --primary (never --brand) and never references
//     it, and every colour it actually paints with is neutral, so neither the
//     variable path nor the hex-remap path has anything to bind to;
//  3. there is no header/brand area for a logo at all, its page links sit
//     outside any menu so they cannot be pruned, and one of them points at a
//     page the template does not contain.
// ---------------------------------------------------------------------------

const BAD_CSS = `
:root {
  /* declared, but never referenced anywhere — binds nothing */
  --primary: rgb(43, 108, 176);
}
body { color: #111111; background: #ffffff; }
.top { border-bottom: 1px solid #dddddd; }
.btn { background: #222222; color: #ffffff; }
.muted { color: #666666; }
`;

const badPage = (title: string, body: string) => `<!doctype html>
<html lang="en">
<head><meta charset="utf-8"><title>${title} - Comfort Heating &amp; Air</title>
<link rel="stylesheet" href="style.css"></head>
<body>
  <div class="top">
    <span>Comfort Heating &amp; Air</span>
    <a href="index.html">Home</a>
    <a href="about.html">About</a>
    <a href="gallery.html">Gallery</a>
  </div>
  <main>${body}</main>
  <div class="foot"><p>Call (720) 555-0199</p></div>
</body>
</html>`;

const BAD_TEMPLATE: Record<string, string> = {
  "index.html": badPage("Home", `<h1>Furnace and air conditioning work</h1><p>Serving Boulder County.</p>`),
  "about.html": badPage("About Us", `<h2>Our story</h2><p>Serving Boulder County since 1998.</p>`),
  "style.css": BAD_CSS,
};

const BAD_MANIFEST = {
  pages: [
    { file: "index.html", title: "Home", kind: "home" },
    { file: "about.html", title: "About Us", kind: "about" },
  ],
  css: ["style.css"],
  js: [],
  components: null,
  assets: [],
  imageFiles: [],
  totalBytes: 2048,
} as unknown as TemplateManifest;

function reportFor(files: Record<string, string>, manifest: TemplateManifest): HealthReport {
  const tokenFiles: Record<string, string> = {};
  for (const [f, c] of Object.entries(files)) if (/\.(html?|m?js)$/i.test(f)) tokenFiles[f] = c;
  return runTemplateHealthChecks({
    files,
    demoTokens: extractDemoTokens(tokenFiles),
    manifest,
    now: "2026-01-01T00:00:00.000Z",
  });
}

describe("template health — a healthy template", () => {
  const report = reportFor(HEALTHY_TEMPLATE, HEALTHY_MANIFEST);

  it("passes overall", () => {
    expect(report.status).toBe("pass");
  });

  it("passes every individual check", () => {
    for (const c of report.checks) {
      expect(`${c.id}: ${c.severity} — ${c.detail}`).toBe(`${c.id}: pass — ${c.detail}`);
    }
  });

  it("reports all seven checks with an actionable hint each", () => {
    expect(report.checks.map((c) => c.id)).toEqual([
      "demo_tokens_poison",
      "theme_applicable",
      "logo_slot",
      "nav_prunable",
      "links_resolve",
      "image_slots",
      "structure_parsable",
    ]);
    for (const c of report.checks) expect(c.hint.length).toBeGreaterThan(10);
  });

  it("names the custom properties the client's colours will bind onto", () => {
    expect(detail(report, "theme_applicable")).toContain("--primary");
  });

  it("uses the injected clock so the report is reproducible", () => {
    expect(report.checkedAt).toBe("2026-01-01T00:00:00.000Z");
  });
});

describe("template health — the deliberately bad template", () => {
  const report = reportFor(BAD_TEMPLATE, BAD_MANIFEST);

  it("fails overall — and the fail is now the poison token alone", () => {
    expect(report.status).toBe("fail");
    // With theme/logo/nav/links downgraded, the ONLY thing that makes this
    // template a `fail` is the build-blocking, unfixable-from-inside-the-run
    // poison token. `fail` means "won't build", nothing weaker.
    const fails = report.checks.filter((c) => c.severity === "fail").map((c) => c.id);
    expect(fails).toEqual(["demo_tokens_poison"]);
  });

  // Historical failure 1: a demo token that matches ordinary copy.
  it("catches the poison demo token by name", () => {
    expect(severity(report, "demo_tokens_poison")).toBe("fail");
    expect(detail(report, "demo_tokens_poison")).toContain("Comfort");
  });

  // Historical failure 2: the client's colours silently never apply. Now a WARN
  // — the engine still ships a correct site, just in the template's own palette.
  it("warns that the client's colours cannot reach a stylesheet", () => {
    expect(severity(report, "theme_applicable")).toBe("warn");
    expect(detail(report, "theme_applicable")).toContain("style.css");
  });

  // Historical failure 3a: no header region. Now INFO — the build inserts the
  // logo itself; this only affects where it can land.
  it("notes the missing header region without blocking the build", () => {
    expect(severity(report, "logo_slot")).toBe("info");
    expect(detail(report, "logo_slot")).toContain("index.html");
  });

  // Historical failure 3b: menu links that cannot be pruned. Now INFO — the
  // integrity pass keeps them from 404ing regardless.
  it("notes page links that sit outside any prunable menu", () => {
    expect(severity(report, "nav_prunable")).toBe("info");
  });

  // Historical failure 3c: a nav link to a page the template does not have. Now a
  // WARN — the integrity pass serves a redirect stub, so it is not a 404.
  it("warns about the dangling link to a page that does not exist", () => {
    expect(severity(report, "links_resolve")).toBe("warn");
    expect(detail(report, "links_resolve")).toContain("gallery.html");
  });

  it("warns that there is nothing for image curation to fill", () => {
    expect(severity(report, "image_slots")).toBe("warn");
  });

  it("still fingerprints the markup — the pages are ugly, not broken", () => {
    expect(severity(report, "structure_parsable")).toBe("pass");
  });
});

describe("template health — individual checks", () => {
  it("warns rather than passes when no demo tokens were extracted", () => {
    const r = runTemplateHealthChecks({ files: HEALTHY_TEMPLATE, demoTokens: [], manifest: HEALTHY_MANIFEST });
    expect(severity(r, "demo_tokens_poison")).toBe("warn");
    expect(r.status).toBe("warn");
  });

  it("passes the theme check by hex remap when a template has no usable variables", () => {
    const files = { ...HEALTHY_TEMPLATE, "style.css": `.btn { background: #b3541e; } .btn:hover { background: #b3541e; }` };
    const r = reportFor(files, HEALTHY_MANIFEST);
    expect(severity(r, "theme_applicable")).toBe("pass");
    expect(detail(r, "theme_applicable")).toContain("#b3541e");
  });

  it("warns (does not fail) the theme check when the template has no stylesheet at all", () => {
    const { "style.css": _css, ...files } = HEALTHY_TEMPLATE;
    const r = reportFor(files, HEALTHY_MANIFEST);
    // No stylesheet means colours cannot be applied, but the site still builds —
    // a warn, not a build-blocking fail.
    expect(severity(r, "theme_applicable")).toBe("warn");
  });

  it("passes the logo check when an <img> would be inserted into a real brand area", () => {
    const files = {
      ...HEALTHY_TEMPLATE,
      "index.html": HEALTHY_TEMPLATE["index.html"].replace(
        '<img src="images/logo.svg" alt="Northpoint Remodeling">',
        "Northpoint Remodeling"
      ),
    };
    const r = reportFor(files, HEALTHY_MANIFEST);
    expect(severity(r, "logo_slot")).toBe("pass");
    expect(detail(r, "logo_slot")).toContain("inserted");
  });

  it("warns links_resolve when a manifest page has no file (the integrity stub saves it from a 404)", () => {
    const manifest = {
      ...HEALTHY_MANIFEST,
      pages: [...HEALTHY_MANIFEST.pages, { file: "services.html", title: "Services", kind: "services_hub" as const }],
    } as TemplateManifest;
    const r = reportFor(HEALTHY_TEMPLATE, manifest);
    expect(severity(r, "links_resolve")).toBe("warn");
    expect(detail(r, "links_resolve")).toContain("services.html");
  });

  it("warns on a page with no image slots", () => {
    const files = {
      ...HEALTHY_TEMPLATE,
      "contact.html": HEALTHY_TEMPLATE["contact.html"]
        .replace('<img src="images/office.jpg" alt="The office">', "")
        .replace('<img src="images/logo.svg" alt="Northpoint Remodeling">', "Northpoint Remodeling"),
    };
    const r = reportFor(files, HEALTHY_MANIFEST);
    expect(severity(r, "image_slots")).toBe("warn");
    expect(detail(r, "image_slots")).toContain("contact.html");
  });

  it("fails structure_parsable on a content file with no elements", () => {
    const files = { ...HEALTHY_TEMPLATE, "broken.html": "just some words, no markup at all" };
    const r = reportFor(files, HEALTHY_MANIFEST);
    expect(severity(r, "structure_parsable")).toBe("fail");
    expect(detail(r, "structure_parsable")).toContain("broken.html");
  });

  it("fails structure_parsable when there is no content file at all", () => {
    const r = runTemplateHealthChecks({ files: { "style.css": HEALTHY_CSS }, demoTokens: ["Northpoint"] });
    expect(severity(r, "structure_parsable")).toBe("fail");
  });

  it("takes the worst severity as the overall status", () => {
    const warnOnly = runTemplateHealthChecks({ files: HEALTHY_TEMPLATE, demoTokens: [], manifest: HEALTHY_MANIFEST });
    expect(warnOnly.status).toBe("warn");
    expect(reportFor(BAD_TEMPLATE, BAD_MANIFEST).status).toBe("fail");
  });

  it("is pure — the same input yields the same report", () => {
    const a = reportFor(BAD_TEMPLATE, BAD_MANIFEST);
    const b = reportFor(BAD_TEMPLATE, BAD_MANIFEST);
    expect({ ...a, checkedAt: "" }).toEqual({ ...b, checkedAt: "" });
  });
});

describe("template health — recalibrated grading (info level)", () => {
  // A template whose ONLY finding is one the build handles itself: it declares
  // no header region (so the logo pass has nowhere to put an <img>), but keeps a
  // detectable <nav>, a bindable palette, resolving links and image slots. Every
  // other check passes; the logo finding is an INFO note, not a warn or a fail.
  const infoPage = (title: string, body: string) => `<!doctype html>
<html lang="en">
<head><meta charset="utf-8"><title>${title} - Northpoint Remodeling</title>
<link rel="stylesheet" href="style.css"></head>
<body>
  <div class="masthead">
    <a class="brand" href="index.html"><img src="images/logo.svg" alt="Northpoint Remodeling"></a>
    <nav class="nav"><ul>
      <li><a href="index.html">Home</a></li>
      <li><a href="about.html">About</a></li>
    </ul></nav>
  </div>
  <main>${body}</main>
  <div class="tail"><p>Northpoint Remodeling, (303) 555-0142, hello@northpoint-remodel.com</p></div>
</body>
</html>`;

  const INFO_TEMPLATE: Record<string, string> = {
    "index.html": infoPage("Home", `<h1>Kitchen and bath remodeling</h1><img src="images/hero.jpg" alt="A kitchen">`),
    "about.html": infoPage("About Us", `<h2>Who we are</h2><img src="images/crew.jpg" alt="The crew">`),
    "style.css": HEALTHY_CSS,
  };
  const INFO_MANIFEST = {
    pages: [
      { file: "index.html", title: "Home", kind: "home" },
      { file: "about.html", title: "About Us", kind: "about" },
    ],
    css: ["style.css"],
    js: [],
    components: null,
    assets: [],
    imageFiles: [],
    totalBytes: 2048,
  } as unknown as TemplateManifest;

  const report = reportFor(INFO_TEMPLATE, INFO_MANIFEST);

  it("ranks severities pass < info < warn < fail", () => {
    expect(SEVERITY_RANK.pass).toBeLessThan(SEVERITY_RANK.info);
    expect(SEVERITY_RANK.info).toBeLessThan(SEVERITY_RANK.warn);
    expect(SEVERITY_RANK.warn).toBeLessThan(SEVERITY_RANK.fail);
  });

  it("grades the build-handled logo finding as info, not warn", () => {
    expect(severity(report, "logo_slot")).toBe("info");
  });

  it("reports overall info — an info note never inflates to a scarier warn", () => {
    expect(report.status).toBe("info");
    // Nothing above info: no warns, no fails.
    expect(report.checks.some((c) => c.severity === "warn" || c.severity === "fail")).toBe(false);
  });

  it("recognises an info-status report as a valid HealthReport (not 'never checked')", () => {
    expect(isHealthReport(report)).toBe(true);
    expect(isHealthReport({ status: "info", checks: [] })).toBe(true);
    // A bogus status must not sneak through via the prototype chain.
    expect(isHealthReport({ status: "constructor", checks: [] })).toBe(false);
    expect(isHealthReport({ status: "nope", checks: [] })).toBe(false);
  });
});

describe("template health — the ordinary-copy corpus", () => {
  it("catches an ordinary-English-word token — the `King` class of failure", () => {
    const r = runTemplateHealthChecks({ files: HEALTHY_TEMPLATE, demoTokens: ["King"] });
    expect(severity(r, "demo_tokens_poison")).toBe("fail");
    expect(detail(r, "demo_tokens_poison")).toContain("King");
  });

  it("does not flag a distinctive invented wordmark", () => {
    const r = runTemplateHealthChecks({ files: HEALTHY_TEMPLATE, demoTokens: ["Northpoint", "Vantara Remodeling"] });
    expect(severity(r, "demo_tokens_poison")).toBe("pass");
  });

  it("does not flag demo geography — the leak gate's most valuable tokens", () => {
    const r = runTemplateHealthChecks({
      files: HEALTHY_TEMPLATE,
      demoTokens: ["Denver", "Cherry Creek", "Wash Park", "(303) 555-0142"],
    });
    expect(severity(r, "demo_tokens_poison")).toBe("pass");
  });

  it("carries real prose, not a word list", () => {
    const words = Object.values(ORDINARY_COPY_CORPUS).join(" ").split(/\s+/).filter(Boolean);
    expect(words.length).toBeGreaterThan(300);
  });
});
