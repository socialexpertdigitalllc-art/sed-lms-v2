// @vitest-environment node
import { describe, it, expect } from "vitest";
import { applyThemeValues, parseThemeSlots } from "@/lib/site-builder/siteTheme";
import { briefWithPalette, finishFile, logoStyleTag, planSiteFinish, LOGO_STYLE_ID } from "@/lib/site-builder/finish";
import { CONTRAST_GUARD_ID, CONTRAST_GUARD_JS } from "@/lib/site-builder/contrastGuard";
import type { BusinessBrief } from "@/lib/site-builder/prompt";

/**
 * The deterministic finish every generated file gets (finish.ts): the lead's
 * colour scheme set on the template's SITE THEME, the contrast guard and the
 * big-logo stylesheet on every page.
 */

// A Roof Smart-style shared components file, as the template ships it.
const COMPONENTS = `// Shared components for Demo Roofing.
// ===== SITE THEME =====
const SITE_THEME = \`
:root {
  --green: #2f7d32;          /* PRIMARY — buttons, links, icons, highlights */
  --gold: #c9a227;           /* ACCENT — stars, small highlights */
  --charcoal-deep: #1f1f1f;  /* DARK — top bar, header, footer backgrounds */
  /* derived — leave alone */
  --green-dark: color-mix(in srgb, var(--green) 82%, black);
  --charcoal: color-mix(in srgb, var(--charcoal-deep) 78%, white);
}
\`;
(function () {
  var style = document.createElement('style');
  style.id = 'site-theme';
  style.textContent = SITE_THEME;
  document.head.appendChild(style);
})();
document.querySelector('app-header').innerHTML = '<header class="main-header"><a class="logo">Demo Roofing</a></header>';
`;

const brief = (over: Partial<BusinessBrief> = {}): BusinessBrief => ({
  business_name: "Acme Roofing",
  services: [],
  service_areas: [],
  color_scheme: "black, red, gold",
  logo: "https://i.ibb.co/abc123/logo.png",
  ...over,
});

const PAGE = `<!DOCTYPE html><html><head><title>Acme</title><link rel="stylesheet" href="css/style.css"></head>
<body><app-header></app-header><main><a class="btn" href="contact.html">Get a quote</a></main><app-footer></app-footer>
<script src="js/components.js"></script></body></html>`;

describe("parseThemeSlots", () => {
  it("reads the marked base variables with their roles and the template's values", () => {
    expect(parseThemeSlots(COMPONENTS)).toEqual([
      { name: "--green", marker: "PRIMARY", role: "buttons, links, icons, highlights", value: "#2f7d32" },
      { name: "--gold", marker: "ACCENT", role: "stars, small highlights", value: "#c9a227" },
      { name: "--charcoal-deep", marker: "DARK", role: "top bar, header, footer backgrounds", value: "#1f1f1f" },
    ]);
  });

  it("finds nothing in a file without a marked theme", () => {
    expect(parseThemeSlots("const SITE = {};\n:root { --brand: #fff; }")).toEqual([]);
  });
});

describe("applyThemeValues", () => {
  const slots = parseThemeSlots(COMPONENTS);
  const values = { "--green": "#dc2626", "--gold": "#d4af37", "--charcoal-deep": "#111111" };

  it("sets each base line in place, keeping its marker comment; derived lines and the injector stay untouched", () => {
    const out = applyThemeValues(COMPONENTS, values, slots);
    expect(out).toContain("--green: #dc2626;          /* PRIMARY — buttons, links, icons, highlights */");
    expect(out).toContain("--gold: #d4af37;           /* ACCENT — stars, small highlights */");
    expect(out).toContain("--charcoal-deep: #111111;  /* DARK — top bar, header, footer backgrounds */");
    expect(out).toContain("--green-dark: color-mix(in srgb, var(--green) 82%, black);");
    expect(out).toContain("style.id = 'site-theme';");
    expect(out.replace(/#dc2626|#d4af37|#111111/g, "X")).toBe(
      COMPONENTS.replace("#2f7d32", "X").replace("#c9a227", "X").replace("#1f1f1f", "X"),
    );
  });

  it("is idempotent", () => {
    const once = applyThemeValues(COMPONENTS, values, slots);
    expect(applyThemeValues(once, values, slots)).toBe(once);
  });

  it("overrides whatever the AI wrote — even where it dropped the marker or the whole line", () => {
    const rewritten = COMPONENTS.replace("--green: #2f7d32;          /* PRIMARY — buttons, links, icons, highlights */", "--green: #ffffff;")
      .replace("  --gold: #c9a227;           /* ACCENT — stars, small highlights */\n", "");
    const out = applyThemeValues(rewritten, values, slots);
    expect(out).toContain("--green: #dc2626;");
    expect(out).not.toContain("#ffffff");
    expect(out).toContain(":root {\n  --gold: #d4af37; /* ACCENT — stars, small highlights */");
    expect(parseThemeSlots(out).map((s) => [s.name, s.value])).toEqual(
      expect.arrayContaining([["--gold", "#d4af37"], ["--charcoal-deep", "#111111"]]),
    );
  });

  it("never touches a longer variable that starts with the same name", () => {
    const src = "const SITE_THEME = `:root {\n  --green-light: #abcdef;\n  --green: #2f7d32; /* PRIMARY — buttons */\n}`;";
    const out = applyThemeValues(src, { "--green": "#dc2626" }, parseThemeSlots(src));
    expect(out).toContain("--green-light: #abcdef;");
    expect(out).toContain("--green: #dc2626; /* PRIMARY — buttons */");
  });
});

describe("planSiteFinish", () => {
  it("sets the theme from the lead's scheme, in order: 1st primary, 2nd secondary, black to the dark areas", () => {
    const finish = planSiteFinish(brief(), { file: "js/components.js", source: COMPONENTS });
    expect(finish.themeValues).toEqual({ "--green": "#dc2626", "--gold": "#d4af37", "--charcoal-deep": "#111111" });
    expect(finish).toMatchObject({ logo: "https://i.ibb.co/abc123/logo.png", businessName: "Acme Roofing", componentsFile: "js/components.js" });
  });

  it("no colour scheme → no theme change; no theme in the template → the roles still reach the prompts", () => {
    expect(planSiteFinish(brief({ color_scheme: undefined }), { file: "js/components.js", source: COMPONENTS })).toMatchObject({
      palette: null,
      themeValues: null,
    });
    const unthemed = planSiteFinish(brief(), { file: "js/components.js", source: "// no theme" });
    expect(unthemed.themeValues).toBeNull();
    expect(briefWithPalette(brief(), unthemed)).toMatchObject({ theme_set: false });
    expect(briefWithPalette(brief(), unthemed).palette).toContain("primary #dc2626");
  });

  it("the prompts' brief carries the colour roles and says the theme is set", () => {
    const b = briefWithPalette(brief(), planSiteFinish(brief(), { file: "js/components.js", source: COMPONENTS }));
    expect(b.palette).toMatch(/^primary #dc2626 .*secondary #d4af37 .*dark areas #111111/);
    expect(b.theme_set).toBe(true);
    expect(briefWithPalette(brief({ color_scheme: "" }), planSiteFinish(brief({ color_scheme: "" }), null))).toEqual(brief({ color_scheme: "" }));
  });
});

describe("finishFile", () => {
  const finish = planSiteFinish(brief(), { file: "js/components.js", source: COMPONENTS });

  it("the components file gets the lead's theme — and no page furniture", () => {
    const out = finishFile("js/components.js", COMPONENTS, finish);
    expect(parseThemeSlots(out).map((s) => s.value)).toEqual(["#dc2626", "#d4af37", "#111111"]);
    expect(out).not.toContain(CONTRAST_GUARD_ID);
    expect(out).not.toContain(LOGO_STYLE_ID);
  });

  it("every page gets the logo sizing in its head and the contrast guard before </body>", () => {
    const out = finishFile("index.html", PAGE, finish);
    const head = out.slice(0, out.indexOf("</head>"));
    expect(head).toContain(`<style id="${LOGO_STYLE_ID}">`);
    expect(head).toContain('img[src="https://i.ibb.co/abc123/logo.png"]');
    expect(head).toContain('img[alt="Acme Roofing" i]');
    expect(head).toContain("height: clamp(56px, 6vw, 80px) !important");
    const guardAt = out.indexOf(`<script id="${CONTRAST_GUARD_ID}">`);
    expect(guardAt).toBeGreaterThan(out.indexOf('<script src="js/components.js">'));
    expect(guardAt).toBeLessThan(out.indexOf("</body>"));
    expect(out).toContain(CONTRAST_GUARD_JS);
    // the page itself is otherwise untouched
    expect(out.replace(/<style id="sb-logo-size">[\s\S]*?<\/style>\n/, "").replace(/<script id="sb-contrast-guard">[\s\S]*?<\/script>\n/, "")).toBe(PAGE);
  });

  it("is idempotent — a finished page finishes to itself, with one of each", () => {
    const once = finishFile("index.html", PAGE, finish);
    const twice = finishFile("index.html", once, finish);
    expect(twice).toBe(once);
    expect(twice.split(`id="${CONTRAST_GUARD_ID}"`)).toHaveLength(2);
    expect(twice.split(`id="${LOGO_STYLE_ID}"`)).toHaveLength(2);
  });

  it("re-finishing swaps in the current logo, not a second stylesheet", () => {
    const once = finishFile("index.html", PAGE, finish);
    const moved = finishFile("index.html", once, planSiteFinish(brief({ logo: "https://cdn.test/new.png" }), null));
    expect(moved).toContain('img[src="https://cdn.test/new.png"]');
    expect(moved).not.toContain("abc123");
    expect(moved.split(`id="${LOGO_STYLE_ID}"`)).toHaveLength(2);
  });

  it("no logo on the lead → no logo stylesheet, the guard all the same", () => {
    const out = finishFile("index.html", PAGE, planSiteFinish(brief({ logo: undefined }), null));
    expect(out).not.toContain(LOGO_STYLE_ID);
    expect(out).toContain(CONTRAST_GUARD_ID);
  });

  it("leaves assets, fragments and a components.html include alone", () => {
    expect(finishFile("css/style.css", "body{color:red}", finish)).toBe("body{color:red}");
    expect(finishFile("partials/cta.html", "<div>cta</div>", finish)).toBe("<div>cta</div>");
    const include = planSiteFinish(brief(), { file: "components.html", source: "<header>x</header>" });
    expect(finishFile("components.html", "<body><header>x</header></body>", include)).toBe("<body><header>x</header></body>");
  });

  it("the guard goes before the page's real </body>, not one quoted inside a script", () => {
    const page = '<html><head></head><body><script>var end = "</body>";</script><p>Hi</p></body></html>';
    const out = finishFile("index.html", page, finish);
    expect(out.indexOf(CONTRAST_GUARD_ID)).toBeGreaterThan(out.indexOf("<p>Hi</p>"));
    expect(out).toContain('<script>var end = "</body>";</script>');
  });

  it("a page with no </head> or </body> still gets both", () => {
    const out = finishFile("index.html", "<body><h1>Hi</h1>", finish);
    expect(out).toContain(LOGO_STYLE_ID);
    expect(out).toContain(CONTRAST_GUARD_ID);
  });
});

describe("logoStyleTag", () => {
  it("escapes the URL and name into valid CSS strings", () => {
    const tag = logoStyleTag('https://x.test/a"b\\c.png', 'Joe "The Roofer"');
    expect(tag).toContain('img[src="https://x.test/a\\"b\\\\c.png"]');
    expect(tag).toContain('img[alt="Joe \\"The Roofer\\"" i]');
  });

  it("sizes header logos 56–80px and footer logos 56–72px, beating inline heights", () => {
    const tag = logoStyleTag("https://x.test/logo.png");
    expect(tag).toMatch(/:is\(header, nav, app-header,[^)]*\) img\[src="https:\/\/x\.test\/logo\.png"\] \{\s*height: clamp\(56px, 6vw, 80px\) !important;/);
    expect(tag).toMatch(/:is\(footer, app-footer,[^)]*\) img\[src="https:\/\/x\.test\/logo\.png"\] \{\s*height: clamp\(56px, 5vw, 72px\) !important;/);
  });
});
