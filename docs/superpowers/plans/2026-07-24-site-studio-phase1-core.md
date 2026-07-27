# Site Studio Phase 1 — Deterministic Core Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the provable heart of Site Studio (template engine v3): the Template Package schema, the deterministic compiler passes, the pure renderer, and the compile→render-back-equals-original verification — all pure library code with CI tests, no DB, no routes, no AI.

**Architecture:** "Compile once, render forever" (spec: `docs/superpowers/specs/2026-07-23-site-studio-design.md`). A raw template zip is compiled into a package (tokenized page skeletons + manifest with samples); a pure renderer stamps a Content Document into the package. Phase 1 implements every deterministic compiler pass and the renderer, and proves the round-trip property on two deliberately dissimilar fixture templates. AI passes (name/place identity, semantic labels, JS baking), DB, and UI come in Phases 2–4.

**Tech Stack:** TypeScript, zod 4, node-html-parser 9, fflate, vitest (tests live flat in `tests/`, `@/` = repo root).

**Phase map (this plan is Phase 1 of 4):**
1. **Deterministic core** (this plan) — `lib/site-studio/` pure lib + tests.
2. Compiler AI passes (identity names/places, semantic labels, JS baking), `studio_templates` + storage, upload/compile/certify routes, Templates board + review drawer.
3. Generation: Content Document writer (AI), `studio_runs`/`studio_run_events`/`studio_assets`, step engine + advancer cron, cockpit UI, Gate 1, images.
4. Editable preview, deploy handoff, `studio_deployments` migration, SOPs, cutover + old-system deletion.

**Hard rules for the executing engineer:**
- **Never import from `lib/template-engine/`** — the old engine is condemned; Site Studio is self-contained under `lib/site-studio/`. (The old engine keeps running untouched during the whole rebuild.)
- Phase 1 is pure library code — no Next.js APIs. (From Phase 2 on, read `node_modules/next/dist/docs/` before writing route/app code, per AGENTS.md.)
- Run tests with `npx vitest run tests/<file>` (fast, targeted). The full suite: `npm test`. Typecheck: `npx tsc --noEmit`. `npm run build` needs `NODE_OPTIONS=--max-old-space-size=6144` — but do NOT run builds or the dev server during this plan; lib + tests only.
- Commit after every task with the exact message given.

**File structure (all new):**

```
lib/site-studio/
  schema.ts              ← zod schemas + types: manifest, content doc, compiled template, diagnostics
  tokens.ts              ← token grammar + text utils (escape, inline sanitize)
  zip.ts                 ← unzip/zip path→bytes maps (fresh copy of the proven algorithm)
  compiler/inventory.ts  ← pass 1: unzip classify, parse pages, strip comments
  compiler/identity.ts   ← pass 2 (deterministic): phone/email/map/name/year → {{id:*}}
  compiler/nav.ts        ← pass 4: shared list-nav regions → nav repeat fragments
  compiler/links.ts      ← pass 4b: remaining internal <a href> → {{link:pageId}}
  compiler/slots.ts      ← pass 3a: text/image slots + samples + title tokenization
  compiler/repeats.ts    ← pass 3b: repeated congruent siblings → repeat fragments
  compiler/theme.ts      ← pass 5: css custom-prop ranking / literal remap plan
  compiler/jsflags.ts    ← pass 6 (Phase-1 subset): flag DOM-writing JS + asset identity echoes
  compiler/compile.ts    ← orchestrator (order: inventory→identity→nav→repeats→slots→theme→js→verify)
  sample.ts              ← sampleContentDoc(manifest) — the demo site as a Content Document
  render/theme.ts        ← applyTheme(): css-vars override file or literal remap
  render/renderer.ts     ← pure renderSite(): completeness refusal, tokens, repeats, nav, links, theme
  compiler/verify.ts     ← pass 7: normalizeHtml + round-trip diff diagnostics
tests/fixtures/site-studio/
  plumberpro/            ← fixture A: css vars, ul-nav, 3 service cards, phone/email/map/name
  bakery/                ← fixture B: dissimilar — no css vars, div-nav, 2 pages, © year
tests/helpers/siteStudioFixtures.ts
tests/siteStudio*.test.ts  (one per module)
```

**Renderer/compiler contract decisions locked here** (referenced by multiple tasks):
- Token grammar: `{{id:key}}` identity, `{{slot:id}}` text, `{{img:id}}` image src, `{{link:pageId}}` internal link, `{{title}}` page title, `{{nav:title}}`/`{{nav:href}}` inside nav fragments. Region markers are HTML comments: `<!--@repeat:id-->`, `<!--@nav:id-->`.
- Compile pass order: identity → nav → repeats → slots (so nav lists don't become repeats and card text belongs to repeat fragments, not page slots). Renderer resolves identity tokens **last**, so identity tokens inside slot samples/values resolve naturally.
- Text slots: `html:false` slots are HTML-escaped on render; `html:true` slots (sample contained inline markup/entities) render verbatim when the value equals the sample, otherwise pass through `sanitizeInline` (allow only `b i em strong br`). Markup corruption from content values is impossible.
- Nav regions render one fragment per built page whose `stampable === false` (hubs in nav; stamped pages are linked from hub cards, not nav).
- `{{link:pageId}}` resolves to the first built output for that page id, else `index.html` — internal 404s unrepresentable.
- Renderer output must contain zero leftover `{{…}}` tokens or `<!--@…-->` markers; leftovers are returned as missing-content refusals (belt and braces).

---

### Task 1: Fixture templates + zip helper

Two deliberately dissimilar fixture sites (v2 lesson: "test against a fixture that looks nothing like the original"). Fixture A (`plumberpro`): 4 pages, css custom props, `<ul>` nav, 3 congruent service cards, phone + email + map iframe + business name, an inline-`<strong>` paragraph, images with alt. Fixture B (`bakery`): 2 pages, no css variables (literal hex), `<div>` nav (degraded path — flagged, not detected), `© 2024` footer, table layout.

**Files:**
- Create: `tests/fixtures/site-studio/plumberpro/index.html`
- Create: `tests/fixtures/site-studio/plumberpro/about.html`
- Create: `tests/fixtures/site-studio/plumberpro/services.html`
- Create: `tests/fixtures/site-studio/plumberpro/contact.html`
- Create: `tests/fixtures/site-studio/plumberpro/css/style.css`
- Create: `tests/fixtures/site-studio/bakery/index.html`
- Create: `tests/fixtures/site-studio/bakery/menu.html`
- Create: `tests/fixtures/site-studio/bakery/style.css`
- Create: `tests/helpers/siteStudioFixtures.ts`
- Test: `tests/siteStudioFixtures.test.ts`

- [ ] **Step 1: Create fixture A pages**

`tests/fixtures/site-studio/plumberpro/index.html`:

```html
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <title>PlumberPro | Trusted Plumbing in Austin</title>
  <link rel="stylesheet" href="css/style.css">
</head>
<body>
  <header>
    <a class="logo" href="index.html">PlumberPro</a>
    <nav>
      <ul class="menu">
        <li><a href="index.html">Home</a></li>
        <li><a href="about.html">About</a></li>
        <li><a href="services.html">Services</a></li>
        <li><a href="contact.html">Contact</a></li>
      </ul>
    </nav>
  </header>
  <main>
    <h1>Fast, Friendly Plumbing You Can Trust</h1>
    <p>PlumberPro has served Austin homeowners for years with honest pricing and <strong>same-day</strong> repairs.</p>
    <img src="img/hero.jpg" alt="Plumber fixing a sink" width="800" height="450">
    <section class="cards">
      <div class="card"><h3>Drain Cleaning</h3><p>Clogged drains cleared fast.</p></div>
      <div class="card"><h3>Water Heaters</h3><p>Repair and replacement done right.</p></div>
      <div class="card"><h3>Leak Repair</h3><p>We find leaks before they find you.</p></div>
    </section>
    <p>Call us at (512) 555-0147 or email help@plumberpro.com today.</p>
  </main>
  <footer>
    <p>PlumberPro — Austin's plumber.</p>
    <ul class="menu">
      <li><a href="index.html">Home</a></li>
      <li><a href="about.html">About</a></li>
      <li><a href="services.html">Services</a></li>
      <li><a href="contact.html">Contact</a></li>
    </ul>
  </footer>
</body>
</html>
```

`tests/fixtures/site-studio/plumberpro/about.html`:

```html
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <title>About | PlumberPro</title>
  <link rel="stylesheet" href="css/style.css">
</head>
<body>
  <header>
    <a class="logo" href="index.html">PlumberPro</a>
    <nav>
      <ul class="menu">
        <li><a href="index.html">Home</a></li>
        <li><a href="about.html">About</a></li>
        <li><a href="services.html">Services</a></li>
        <li><a href="contact.html">Contact</a></li>
      </ul>
    </nav>
  </header>
  <main>
    <h1>About PlumberPro</h1>
    <p>Founded in Austin, PlumberPro is a family business built on referrals.</p>
    <img src="img/team.jpg" alt="The PlumberPro team">
  </main>
  <footer>
    <p>PlumberPro — Austin's plumber.</p>
    <ul class="menu">
      <li><a href="index.html">Home</a></li>
      <li><a href="about.html">About</a></li>
      <li><a href="services.html">Services</a></li>
      <li><a href="contact.html">Contact</a></li>
    </ul>
  </footer>
</body>
</html>
```

`tests/fixtures/site-studio/plumberpro/services.html`:

```html
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <title>Services | PlumberPro</title>
  <link rel="stylesheet" href="css/style.css">
</head>
<body>
  <header>
    <a class="logo" href="index.html">PlumberPro</a>
    <nav>
      <ul class="menu">
        <li><a href="index.html">Home</a></li>
        <li><a href="about.html">About</a></li>
        <li><a href="services.html">Services</a></li>
        <li><a href="contact.html">Contact</a></li>
      </ul>
    </nav>
  </header>
  <main>
    <h1>Our Services</h1>
    <section class="cards">
      <div class="card"><h3>Drain Cleaning</h3><p>Hydro-jetting and snaking.</p></div>
      <div class="card"><h3>Water Heaters</h3><p>Tank and tankless installs.</p></div>
      <div class="card"><h3>Leak Repair</h3><p>Slab leaks located precisely.</p></div>
    </section>
  </main>
  <footer>
    <p>PlumberPro — Austin's plumber.</p>
    <ul class="menu">
      <li><a href="index.html">Home</a></li>
      <li><a href="about.html">About</a></li>
      <li><a href="services.html">Services</a></li>
      <li><a href="contact.html">Contact</a></li>
    </ul>
  </footer>
</body>
</html>
```

`tests/fixtures/site-studio/plumberpro/contact.html`:

```html
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <title>Contact | PlumberPro</title>
  <link rel="stylesheet" href="css/style.css">
</head>
<body>
  <header>
    <a class="logo" href="index.html">PlumberPro</a>
    <nav>
      <ul class="menu">
        <li><a href="index.html">Home</a></li>
        <li><a href="about.html">About</a></li>
        <li><a href="services.html">Services</a></li>
        <li><a href="contact.html">Contact</a></li>
      </ul>
    </nav>
  </header>
  <main>
    <h1>Contact Us</h1>
    <p>Reach us at (512) 555-0147 or <a href="mailto:help@plumberpro.com">help@plumberpro.com</a>.</p>
    <iframe src="https://www.google.com/maps?q=Austin%2C%20TX&output=embed" title="Map"></iframe>
  </main>
  <footer>
    <p>PlumberPro — Austin's plumber.</p>
    <ul class="menu">
      <li><a href="index.html">Home</a></li>
      <li><a href="about.html">About</a></li>
      <li><a href="services.html">Services</a></li>
      <li><a href="contact.html">Contact</a></li>
    </ul>
  </footer>
</body>
</html>
```

`tests/fixtures/site-studio/plumberpro/css/style.css`:

```css
:root {
  --primary: #0a5adf;
  --primary-dark: #063a91;
  --highlight: #ff9f1c;
  --ink: #222222;
}
body { color: var(--ink); font-family: sans-serif; }
h1 { color: var(--primary); }
h3 { color: var(--primary-dark); }
.card { border-top: 3px solid var(--primary); }
a { color: var(--primary); }
.logo { color: var(--highlight); }
```

- [ ] **Step 2: Create fixture B pages**

`tests/fixtures/site-studio/bakery/index.html`:

```html
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <title>Golden Crust Bakery</title>
  <link rel="stylesheet" href="style.css">
</head>
<body>
  <div class="topbar">
    <a href="index.html">Home</a>
    <a href="menu.html">Menu</a>
  </div>
  <h1>Golden Crust Bakery</h1>
  <p>Fresh sourdough every morning in Portland.</p>
  <table>
    <tr><td>Mon–Fri</td><td>7am–3pm</td></tr>
    <tr><td>Weekends</td><td>8am–1pm</td></tr>
  </table>
  <p>Order ahead: (503) 555-0022</p>
  <div class="footer">© 2024 Golden Crust Bakery</div>
</body>
</html>
```

`tests/fixtures/site-studio/bakery/menu.html`:

```html
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <title>Menu — Golden Crust Bakery</title>
  <link rel="stylesheet" href="style.css">
</head>
<body>
  <div class="topbar">
    <a href="index.html">Home</a>
    <a href="menu.html">Menu</a>
  </div>
  <h1>Our Menu</h1>
  <p>Breads, pastries, and coffee — baked daily.</p>
  <div class="footer">© 2024 Golden Crust Bakery</div>
</body>
</html>
```

`tests/fixtures/site-studio/bakery/style.css`:

```css
body { font-family: serif; color: #333333; }
h1 { color: #b4540a; }
.topbar { background: #b4540a; }
.topbar a { color: #ffffff; }
.footer { color: #7a3a08; border-top: 1px solid #b4540a; }
```

- [ ] **Step 3: Write the fixture helper and a smoke test**

`tests/helpers/siteStudioFixtures.ts`:

```ts
import { readFileSync, readdirSync, statSync } from "fs";
import path from "path";
import { zipSync } from "fflate";

const ROOT = path.resolve(__dirname, "../fixtures/site-studio");

/** Read a fixture directory into a path→bytes map (forward slashes). */
export function fixtureFiles(name: string): Record<string, Uint8Array> {
  const base = path.join(ROOT, name);
  const out: Record<string, Uint8Array> = {};
  const walk = (dir: string) => {
    for (const entry of readdirSync(dir)) {
      const full = path.join(dir, entry);
      if (statSync(full).isDirectory()) walk(full);
      else out[path.relative(base, full).replace(/\\/g, "/")] = new Uint8Array(readFileSync(full));
    }
  };
  walk(base);
  return out;
}

/** Zip a fixture directory in-memory, as if an operator uploaded it. */
export function fixtureZip(name: string): Uint8Array {
  return zipSync(fixtureFiles(name));
}

export const text = (b: Uint8Array) => new TextDecoder().decode(b);
```

`tests/siteStudioFixtures.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { fixtureFiles, fixtureZip, text } from "./helpers/siteStudioFixtures";

describe("site-studio fixtures", () => {
  it("plumberpro has 4 pages and a stylesheet", () => {
    const files = fixtureFiles("plumberpro");
    const names = Object.keys(files).sort();
    expect(names).toEqual(["about.html", "contact.html", "css/style.css", "index.html", "services.html"]);
    expect(text(files["index.html"])).toContain("PlumberPro");
  });
  it("bakery is dissimilar: 2 pages, no css variables", () => {
    const files = fixtureFiles("bakery");
    expect(Object.keys(files).sort()).toEqual(["index.html", "menu.html", "style.css"]);
    expect(text(files["style.css"])).not.toContain("--");
  });
  it("zips fixtures in-memory", () => {
    expect(fixtureZip("plumberpro").length).toBeGreaterThan(500);
  });
});
```

- [ ] **Step 4: Run the smoke test**

Run: `npx vitest run tests/siteStudioFixtures.test.ts`
Expected: 3 tests PASS.

- [ ] **Step 5: Commit**

```bash
git add tests/fixtures/site-studio tests/helpers/siteStudioFixtures.ts tests/siteStudioFixtures.test.ts
git commit -m "test(site-studio): two dissimilar fixture templates + in-memory zip helper"
```

---

### Task 2: Package + Content Document schema

**Files:**
- Create: `lib/site-studio/schema.ts`
- Test: `tests/siteStudioSchema.test.ts`

- [ ] **Step 1: Write the failing test**

`tests/siteStudioSchema.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import {
  manifestSchema, contentDocSchema, pageKindFromFilename, PAGE_KINDS,
} from "@/lib/site-studio/schema";

const slot = { id: "index_s1", type: "text", sample: "Hello", max_chars: 60, html: false };

const manifest = {
  engine: 3, name: "plumberpro", version: 1,
  identity: { business_name: "PlumberPro", phone: "(512) 555-0147" },
  theme: { mode: "css_vars", roles: { brand: { var: "--primary", hex: "#0a5adf" } } },
  nav: [{ id: "nav_header", fragment: "nav_header", location: "header" }],
  pages: [{
    id: "index", file: "index.html", kind: "home", stampable: false,
    title_sample: "PlumberPro | Trusted Plumbing in Austin",
    slots: [slot],
    repeats: [{
      id: "index_r1", fragment: "index_r1", min: 1, max: 12,
      slots: [{ id: "index_r1_s1", type: "text", sample: "Drain Cleaning", max_chars: 40, html: false }],
      samples: [{ index_r1_s1: "Drain Cleaning" }],
    }],
  }],
};

describe("manifestSchema", () => {
  it("accepts a valid manifest", () => {
    expect(manifestSchema.parse(manifest).pages[0].id).toBe("index");
  });
  it("rejects an unknown page kind", () => {
    const bad = { ...manifest, pages: [{ ...manifest.pages[0], kind: "landing" }] };
    expect(manifestSchema.safeParse(bad).success).toBe(false);
  });
  it("rejects a manifest with zero pages", () => {
    expect(manifestSchema.safeParse({ ...manifest, pages: [] }).success).toBe(false);
  });
});

describe("contentDocSchema", () => {
  const doc = {
    identity: { business_name: "Acme Plumbing", phone: "(303) 555-1234" },
    theme: {},
    pages: [{
      page_id: "index", title: "Acme Plumbing | Denver",
      slots: { index_s1: "Welcome to Acme" },
      repeats: { index_r1: [{ index_r1_s1: "Sewer Repair" }] },
    }],
  };
  it("accepts a valid doc", () => {
    expect(contentDocSchema.parse(doc).pages[0].page_id).toBe("index");
  });
  it("allows identity tokens but rejects structural token syntax in values", () => {
    const idOk = { ...doc, pages: [{ ...doc.pages[0], slots: { index_s1: "Call {{id:phone}} now" } }] };
    expect(contentDocSchema.safeParse(idOk).success).toBe(true);
    const bad = { ...doc, pages: [{ ...doc.pages[0], slots: { index_s1: "Hi {{slot:other}}" } }] };
    expect(contentDocSchema.safeParse(bad).success).toBe(false);
  });
});

describe("pageKindFromFilename", () => {
  it("maps common filenames", () => {
    expect(pageKindFromFilename("index.html")).toBe("home");
    expect(pageKindFromFilename("about-us.html")).toBe("about");
    expect(pageKindFromFilename("services.html")).toBe("services_hub");
    expect(pageKindFromFilename("contact.html")).toBe("contact");
    expect(pageKindFromFilename("menu.html")).toBe("generic");
  });
  it("PAGE_KINDS matches the spec set", () => {
    expect(PAGE_KINDS).toContain("service");
    expect(PAGE_KINDS).toContain("area");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/siteStudioSchema.test.ts`
Expected: FAIL — cannot resolve `@/lib/site-studio/schema`.

- [ ] **Step 3: Write the implementation**

`lib/site-studio/schema.ts`:

```ts
import { z } from "zod";

export type FileMap = Record<string, Uint8Array>;

export interface Diagnostic {
  level: "blocker" | "warn" | "info";
  code: string;
  message: string;
  page?: string;
}

export const PAGE_KINDS = [
  "home", "about", "services_hub", "service", "areas_hub", "area",
  "contact", "gallery", "reviews", "generic",
] as const;
export type PageKind = (typeof PAGE_KINDS)[number];

const KIND_PATTERNS: [RegExp, PageKind][] = [
  [/^index\./, "home"],
  [/about/, "about"],
  [/service/, "services_hub"],
  [/area|location|cities/, "areas_hub"],
  [/contact/, "contact"],
  [/gallery|portfolio|project/, "gallery"],
  [/review|testimonial/, "reviews"],
];

export function pageKindFromFilename(file: string): PageKind {
  const base = file.toLowerCase();
  for (const [re, kind] of KIND_PATTERNS) if (re.test(base)) return kind;
  return "generic";
}

/**
 * Content values may not contain structural token syntax. Identity tokens
 * ({{id:*}}) ARE allowed — samples carry them by construction and the renderer
 * resolves identity last, so an operator can even type {{id:phone}} on purpose.
 */
const tokenFree = (s: string) => !/\{\{(?!id:)/.test(s) && !s.includes("<!--@");

export const slotDefSchema = z.object({
  id: z.string().min(1),
  type: z.enum(["text", "image"]),
  sample: z.string(),
  max_chars: z.number().int().positive().optional(),
  html: z.boolean().default(false),
  semantic: z.string().optional(),
  subject_hint: z.string().optional(),
  aspect: z.string().optional(),
});
export type SlotDef = z.infer<typeof slotDefSchema>;

export const repeatDefSchema = z.object({
  id: z.string().min(1),
  fragment: z.string().min(1),
  min: z.number().int().min(0),
  max: z.number().int().min(1),
  slots: z.array(slotDefSchema),
  samples: z.array(z.record(z.string(), z.string())),
});
export type RepeatDef = z.infer<typeof repeatDefSchema>;

export const pageDefSchema = z.object({
  id: z.string().min(1),
  file: z.string().min(1),
  kind: z.enum(PAGE_KINDS),
  stampable: z.boolean(),
  title_sample: z.string(),
  slots: z.array(slotDefSchema),
  repeats: z.array(repeatDefSchema),
});
export type PageDef = z.infer<typeof pageDefSchema>;

export const navRegionSchema = z.object({
  id: z.string().min(1),
  fragment: z.string().min(1),
  location: z.enum(["header", "footer", "mobile"]),
});
export type NavRegionDef = z.infer<typeof navRegionSchema>;

export const themeDefSchema = z.object({
  mode: z.enum(["css_vars", "literal_remap", "none"]),
  roles: z.record(z.string(), z.object({ var: z.string().optional(), hex: z.string() })),
});
export type ThemeDef = z.infer<typeof themeDefSchema>;

export const manifestSchema = z.object({
  engine: z.literal(3),
  name: z.string().min(1),
  version: z.number().int().min(1),
  identity: z.record(z.string(), z.string()),
  theme: themeDefSchema,
  nav: z.array(navRegionSchema),
  pages: z.array(pageDefSchema).min(1),
});
export type TemplateManifest = z.infer<typeof manifestSchema>;

/** A compiled template: manifest + tokenized skeletons + fragments + untouched assets. */
export interface CompiledTemplate {
  manifest: TemplateManifest;
  pages: Record<string, string>;
  fragments: Record<string, string>;
  assets: FileMap;
}

export const contentDocPageSchema = z.object({
  page_id: z.string().min(1),
  output: z.string().optional(),
  nav_title: z.string().optional(),
  title: z.string().refine(tokenFree),
  slots: z.record(z.string(), z.string().refine(tokenFree)),
  repeats: z.record(z.string(), z.array(z.record(z.string(), z.string().refine(tokenFree)))).default({}),
});
export type ContentDocPage = z.infer<typeof contentDocPageSchema>;

export const contentDocSchema = z.object({
  identity: z.record(z.string(), z.string().refine(tokenFree)),
  theme: z.record(z.string(), z.string()),
  pages: z.array(contentDocPageSchema).min(1),
});
export type ContentDoc = z.infer<typeof contentDocSchema>;

export type RenderResult =
  | { ok: true; files: FileMap }
  | { ok: false; missing: { page_id: string; slot_id: string }[] };
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/siteStudioSchema.test.ts`
Expected: PASS (all tests).

- [ ] **Step 5: Commit**

```bash
git add lib/site-studio/schema.ts tests/siteStudioSchema.test.ts
git commit -m "feat(site-studio): package manifest + content document schema"
```

---

### Task 3: Token grammar + text utils

**Files:**
- Create: `lib/site-studio/tokens.ts`
- Test: `tests/siteStudioTokens.test.ts`

- [ ] **Step 1: Write the failing test**

`tests/siteStudioTokens.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import {
  idToken, slotToken, imgToken, linkToken, TITLE_TOKEN, NAV_TITLE, NAV_HREF,
  repeatMarker, navMarker, findTokens, escapeHtml, sanitizeInline,
} from "@/lib/site-studio/tokens";

describe("token builders", () => {
  it("builds each token kind", () => {
    expect(idToken("phone")).toBe("{{id:phone}}");
    expect(slotToken("index_s1")).toBe("{{slot:index_s1}}");
    expect(imgToken("index_i1")).toBe("{{img:index_i1}}");
    expect(linkToken("about")).toBe("{{link:about}}");
    expect(TITLE_TOKEN).toBe("{{title}}");
    expect(repeatMarker("r1")).toBe("<!--@repeat:r1-->");
    expect(navMarker("n1")).toBe("<!--@nav:n1-->");
  });
});

describe("findTokens", () => {
  it("finds every token and marker in a string", () => {
    const html = `<a href="{{link:about}}">{{slot:s1}}</a>${navMarker("n1")}<title>${TITLE_TOKEN}</title>${NAV_TITLE}${NAV_HREF}`;
    const kinds = findTokens(html).map((t) => t.kind).sort();
    expect(kinds).toEqual(["link", "nav", "nav_href", "nav_title", "slot", "title"]);
  });
  it("returns empty for token-free html", () => {
    expect(findTokens("<p>plain</p><!-- normal comment -->")).toEqual([]);
  });
});

describe("escapeHtml", () => {
  it("escapes the five specials", () => {
    expect(escapeHtml(`<a b="c">&'`)).toBe("&lt;a b=&quot;c&quot;&gt;&amp;&#39;");
  });
});

describe("sanitizeInline", () => {
  it("keeps allowed inline tags, strips others", () => {
    expect(sanitizeInline("Fast <strong>same-day</strong> fix")).toBe("Fast <strong>same-day</strong> fix");
    expect(sanitizeInline(`Hi <script>x()</script><div>there</div>`)).toBe("Hi x()there");
  });
  it("neutralizes parser-differential payloads (malformed tags read as text)", () => {
    expect(sanitizeInline("<svg/onload=alert(1)>")).toBe("&lt;svg/onload=alert(1)&gt;");
    expect(sanitizeInline("<b/onmouseover=alert(1)>click</b>")).toBe("&lt;b/onmouseover=alert(1)&gt;click");
  });
  it("does not double-escape entities in legitimate text", () => {
    expect(sanitizeInline("Bread &amp; butter")).toBe("Bread &amp; butter");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/siteStudioTokens.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Write the implementation**

`lib/site-studio/tokens.ts`:

```ts
import { parse } from "node-html-parser";

export const idToken = (key: string) => `{{id:${key}}}`;
export const slotToken = (id: string) => `{{slot:${id}}}`;
export const imgToken = (id: string) => `{{img:${id}}}`;
export const linkToken = (pageId: string) => `{{link:${pageId}}}`;
export const TITLE_TOKEN = "{{title}}";
export const NAV_TITLE = "{{nav:title}}";
export const NAV_HREF = "{{nav:href}}";
export const repeatMarker = (id: string) => `<!--@repeat:${id}-->`;
export const navMarker = (id: string) => `<!--@nav:${id}-->`;

export interface FoundToken { kind: string; key: string; raw: string }

const TOKEN_RE = /\{\{(id|slot|img|link|title)(?::([A-Za-z0-9_./-]+))?\}\}|\{\{nav:(title|href)\}\}|<!--@(repeat|nav):([A-Za-z0-9_-]+)-->/g;

/** Every token/marker occurrence in a string (markers report kind "repeat"/"nav"). */
export function findTokens(s: string): FoundToken[] {
  const out: FoundToken[] = [];
  for (const m of s.matchAll(TOKEN_RE)) {
    if (m[1]) out.push({ kind: m[1], key: m[2] ?? "", raw: m[0] });
    else if (m[3]) out.push({ kind: `nav_${m[3]}`, key: "", raw: m[0] });
    else out.push({ kind: m[4], key: m[5], raw: m[0] });
  }
  return out;
}

export function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}

const INLINE_ALLOWED = new Set(["b", "i", "em", "strong", "br"]);

/** Strip all markup except harmless inline formatting; text is preserved. */
export function sanitizeInline(s: string): string {
  const root = parse(s);
  const walk = (node: any): string => {
    if (node.nodeType === 3) return escapeHtml(node.text);
    const tag = (node.rawTagName ?? "").toLowerCase();
    const inner = node.childNodes.map(walk).join("");
    if (tag && INLINE_ALLOWED.has(tag)) return tag === "br" ? "<br>" : `<${tag}>${inner}</${tag}>`;
    return inner;
  };
  return root.childNodes.map(walk).join("");
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/siteStudioTokens.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add lib/site-studio/tokens.ts tests/siteStudioTokens.test.ts
git commit -m "feat(site-studio): token grammar, escape and inline sanitizer"
```

---

### Task 4: Zip helpers (self-contained copy)

Site Studio must not import from `lib/template-engine/`; it gets its own copy of the proven unzip/zip algorithm (40 lines — the kept deploy modules retain theirs until cutover).

**Files:**
- Create: `lib/site-studio/zip.ts`
- Test: `tests/siteStudioZip.test.ts`

- [ ] **Step 1: Write the failing test**

`tests/siteStudioZip.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { zipSync } from "fflate";
import { unzipToMap, zipFromMap } from "@/lib/site-studio/zip";

const enc = (s: string) => new TextEncoder().encode(s);
const dec = (b: Uint8Array) => new TextDecoder().decode(b);

describe("unzipToMap", () => {
  it("normalizes and strips a single shared root folder", () => {
    const z = zipSync({ "my-template/index.html": enc("<html>"), "my-template/css/a.css": enc("x") });
    const map = unzipToMap(z);
    expect(Object.keys(map).sort()).toEqual(["css/a.css", "index.html"]);
  });
  it("keeps paths when roots differ", () => {
    const z = zipSync({ "index.html": enc("a"), "css/a.css": enc("b") });
    expect(Object.keys(unzipToMap(z)).sort()).toEqual(["css/a.css", "index.html"]);
  });
  it("rejects zip-slip paths", () => {
    const z = zipSync({ "../evil.txt": enc("x") });
    expect(() => unzipToMap(z)).toThrow(/Unsafe path/);
  });
  it("round-trips through zipFromMap", () => {
    const files = { "index.html": enc("<h1>hi</h1>") };
    expect(dec(unzipToMap(zipFromMap(files))["index.html"])).toBe("<h1>hi</h1>");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/siteStudioZip.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Write the implementation**

`lib/site-studio/zip.ts`:

```ts
import { unzipSync, zipSync } from "fflate";

/**
 * Unzip bytes into a normalized path→bytes map: forward slashes, directory
 * entries dropped, a single shared root folder stripped, ".." rejected.
 */
export function unzipToMap(bytes: Uint8Array): Record<string, Uint8Array> {
  const raw = unzipSync(bytes);
  const entries: [string, Uint8Array][] = [];
  for (const [name, data] of Object.entries(raw)) {
    const normalized = name.replace(/\\/g, "/");
    if (normalized.endsWith("/")) continue;
    const parts = normalized.split("/").filter((p) => p.length > 0 && p !== ".");
    if (parts.length === 0) continue;
    if (parts.includes("..")) throw new Error(`Unsafe path in zip entry: ${name}`);
    entries.push([parts.join("/"), data]);
  }
  if (entries.length > 0) {
    const first = entries[0][0].split("/")[0];
    const allShareRoot = entries.every(([p]) => {
      const segs = p.split("/");
      return segs.length >= 2 && segs[0] === first;
    });
    if (allShareRoot) for (const e of entries) e[0] = e[0].split("/").slice(1).join("/");
  }
  const out: Record<string, Uint8Array> = {};
  for (const [p, data] of entries) out[p] = data;
  return out;
}

export function zipFromMap(files: Record<string, Uint8Array>): Uint8Array {
  return zipSync(files);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/siteStudioZip.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add lib/site-studio/zip.ts tests/siteStudioZip.test.ts
git commit -m "feat(site-studio): self-contained zip map helpers"
```

---

### Task 5: Compiler pass 1 — inventory

**Files:**
- Create: `lib/site-studio/compiler/inventory.ts`
- Test: `tests/siteStudioInventory.test.ts`

- [ ] **Step 1: Write the failing test**

`tests/siteStudioInventory.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { inventory } from "@/lib/site-studio/compiler/inventory";
import { fixtureFiles } from "./helpers/siteStudioFixtures";

describe("inventory", () => {
  it("classifies pages vs assets and assigns ids/kinds", () => {
    const inv = inventory(fixtureFiles("plumberpro"));
    expect(inv.pages.map((p) => p.file)).toEqual(["index.html", "about.html", "contact.html", "services.html"]);
    expect(inv.pages[0]).toMatchObject({ id: "index", kind: "home" });
    expect(inv.pages.find((p) => p.id === "services")!.kind).toBe("services_hub");
    expect(Object.keys(inv.assets)).toEqual(["css/style.css"]);
  });
  it("strips HTML comments from parsed pages (v2 lesson: comments carry identity)", () => {
    const files = fixtureFiles("bakery");
    files["index.html"] = new TextEncoder().encode(
      new TextDecoder().decode(files["index.html"]).replace("<h1>", "<!-- Golden Crust internal note --><h1>")
    );
    const inv = inventory(files);
    expect(inv.pages[0].root.toString()).not.toContain("internal note");
    expect(inv.diagnostics.some((d) => d.code === "comments_stripped")).toBe(true);
  });
  it("reports a blocker when no html pages exist", () => {
    const inv = inventory({ "style.css": new Uint8Array([1]) });
    expect(inv.pages).toEqual([]);
    expect(inv.diagnostics.some((d) => d.level === "blocker" && d.code === "no_pages")).toBe(true);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/siteStudioInventory.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Write the implementation**

`lib/site-studio/compiler/inventory.ts`:

```ts
import { parse, HTMLElement, CommentNode } from "node-html-parser";
import { Diagnostic, FileMap, PageKind, pageKindFromFilename } from "../schema";

export interface PageSource {
  file: string;
  id: string;
  kind: PageKind;
  root: HTMLElement;
}

export interface Inventory {
  pages: PageSource[];
  assets: FileMap;
  diagnostics: Diagnostic[];
}

const pageId = (file: string) =>
  file.replace(/\.html?$/i, "").replace(/[^a-z0-9]+/gi, "_").toLowerCase();

/** Pass 1: classify files, parse pages (comments stripped), assign ids/kinds. */
export function inventory(files: FileMap): Inventory {
  const diagnostics: Diagnostic[] = [];
  const pages: PageSource[] = [];
  const assets: FileMap = {};
  let commentCount = 0;

  for (const [file, bytes] of Object.entries(files)) {
    if (!/\.html?$/i.test(file)) { assets[file] = bytes; continue; }
    const root = parse(new TextDecoder().decode(bytes), { comment: true });
    const comments = root.querySelectorAll("*")
      .flatMap((el) => el.childNodes).concat(root.childNodes)
      .filter((n): n is CommentNode => n instanceof CommentNode);
    for (const c of comments) c.remove();
    commentCount += comments.length;
    pages.push({ file, id: pageId(file), kind: pageKindFromFilename(file), root });
  }

  pages.sort((a, b) => (a.id === "index" ? -1 : b.id === "index" ? 1 : a.file.localeCompare(b.file)));

  if (commentCount > 0)
    diagnostics.push({ level: "info", code: "comments_stripped", message: `${commentCount} HTML comment(s) removed` });
  if (pages.length === 0)
    diagnostics.push({ level: "blocker", code: "no_pages", message: "Zip contains no HTML pages" });

  return { pages, assets, diagnostics };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/siteStudioInventory.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add lib/site-studio/compiler/inventory.ts tests/siteStudioInventory.test.ts
git commit -m "feat(site-studio): compiler pass 1 - inventory with comment stripping"
```

---

### Task 6: Compiler pass 2 (deterministic) — identity tokenization

Phone (text + `tel:`), email (text + `mailto:`), Google-maps iframe src, business name (heuristic from the home `<title>`, word-boundary replacement), and `© year`. AI extension (people names, places, addresses) is Phase 2; a `warn` diagnostic says name detection is heuristic.

**Files:**
- Create: `lib/site-studio/compiler/identity.ts`
- Test: `tests/siteStudioIdentity.test.ts`

- [ ] **Step 1: Write the failing test**

`tests/siteStudioIdentity.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { inventory } from "@/lib/site-studio/compiler/inventory";
import { extractIdentity } from "@/lib/site-studio/compiler/identity";
import { fixtureFiles } from "./helpers/siteStudioFixtures";

describe("extractIdentity (plumberpro)", () => {
  const inv = inventory(fixtureFiles("plumberpro"));
  const { identity, diagnostics } = extractIdentity(inv);
  const all = inv.pages.map((p) => p.root.toString()).join("\n");

  it("captures the sample values", () => {
    expect(identity.business_name).toBe("PlumberPro");
    expect(identity.phone).toBe("(512) 555-0147");
    expect(identity.email).toBe("help@plumberpro.com");
    expect(identity.map_embed).toContain("google.com/maps");
  });
  it("no raw identity remains in any page", () => {
    expect(all).not.toContain("PlumberPro");
    expect(all).not.toContain("(512) 555-0147");
    expect(all).not.toContain("help@plumberpro.com");
    expect(all).not.toContain("google.com/maps");
  });
  it("tokenized instead", () => {
    expect(all).toContain("{{id:business_name}}");
    expect(all).toContain("{{id:phone}}");
    expect(all).toContain("{{id:email}}");
    expect(all).toContain("{{id:map_embed}}");
  });
  it("warns that name detection is heuristic", () => {
    expect(diagnostics.some((d) => d.code === "identity_name_heuristic" && d.level === "warn")).toBe(true);
  });
});

describe("extractIdentity (bakery)", () => {
  const inv = inventory(fixtureFiles("bakery"));
  const { identity } = extractIdentity(inv);
  it("captures year from the copyright line", () => {
    expect(identity.year).toBe("2024");
    expect(inv.pages[0].root.toString()).toContain("{{id:year}}");
  });
  it("does not match the phone inside longer digit runs", () => {
    expect(identity.phone).toBe("(503) 555-0022");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/siteStudioIdentity.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Write the implementation**

`lib/site-studio/compiler/identity.ts`:

```ts
import { HTMLElement, TextNode } from "node-html-parser";
import { Diagnostic } from "../schema";
import { idToken } from "../tokens";
import { Inventory } from "./inventory";

const PHONE_RE = /(?:\(\d{3}\)\s?|\d{3}[-. ])\d{3}[-. ]\d{4}/g;
const EMAIL_RE = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g;
const YEAR_RE = /(©|&copy;)\s*(20\d\d)/;

function mostFrequent(values: string[]): string | undefined {
  const counts = new Map<string, number>();
  for (const v of values) counts.set(v, (counts.get(v) ?? 0) + 1);
  return [...counts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0];
}

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

function replaceEverywhere(pages: Inventory["pages"], value: string, token: string, wordBounded: boolean) {
  const re = new RegExp(
    wordBounded ? `(?<![A-Za-z0-9])${escapeRe(value)}(?![A-Za-z0-9])` : escapeRe(value), "g",
  );
  for (const page of pages) {
    for (const el of [page.root, ...page.root.querySelectorAll("*")]) {
      for (const node of el.childNodes) {
        if (node instanceof TextNode && re.test(node.rawText)) node.rawText = node.rawText.replace(re, token);
        re.lastIndex = 0;
      }
      if (el instanceof HTMLElement) {
        for (const [attr, v] of Object.entries(el.attributes)) {
          if (re.test(v)) el.setAttribute(attr, v.replace(re, token));
          re.lastIndex = 0;
        }
      }
    }
  }
}

/** Pass 2 (deterministic subset): tokenize phone/email/map/name/year in text + attributes. */
export function extractIdentity(inv: Inventory): { identity: Record<string, string>; diagnostics: Diagnostic[] } {
  const diagnostics: Diagnostic[] = [];
  const identity: Record<string, string> = {};
  const allText = inv.pages.map((p) => p.root.toString()).join("\n");

  const phone = mostFrequent(allText.match(PHONE_RE) ?? []);
  if (phone) {
    identity.phone = phone;
    identity.phone_href = `tel:${phone.replace(/[^\d+]/g, "")}`;
    replaceEverywhere(inv.pages, identity.phone_href, idToken("phone_href"), false);
    replaceEverywhere(inv.pages, phone, idToken("phone"), false);
  }

  const email = mostFrequent(allText.match(EMAIL_RE) ?? []);
  if (email) {
    identity.email = email;
    replaceEverywhere(inv.pages, `mailto:${email}`, idToken("email_href"), false);
    identity.email_href = `mailto:${email}`;
    replaceEverywhere(inv.pages, email, idToken("email"), false);
  }

  for (const page of inv.pages) {
    const iframe = page.root.querySelectorAll("iframe").find((f) => (f.getAttribute("src") ?? "").includes("google.com/maps"));
    if (iframe && !identity.map_embed) identity.map_embed = iframe.getAttribute("src")!;
  }
  if (identity.map_embed) replaceEverywhere(inv.pages, identity.map_embed, idToken("map_embed"), false);

  const home = inv.pages.find((p) => p.kind === "home") ?? inv.pages[0];
  const title = home?.root.querySelector("title")?.text ?? "";
  const name = title.split(/[|\-–—]/)[0].trim();
  if (name.length >= 3) {
    identity.business_name = name;
    replaceEverywhere(inv.pages, name, idToken("business_name"), true);
    diagnostics.push({
      level: "warn", code: "identity_name_heuristic",
      message: `Business name "${name}" detected from the home <title>; AI/name review lands in Phase 2 — verify in review.`,
    });
  } else {
    diagnostics.push({ level: "warn", code: "identity_name_missing", message: "No business name detected from <title>" });
  }

  const yearMatch = allText.match(YEAR_RE);
  if (yearMatch) {
    identity.year = yearMatch[2];
    replaceEverywhere(inv.pages, yearMatch[2], idToken("year"), true);
  }

  return { identity, diagnostics };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/siteStudioIdentity.test.ts`
Expected: PASS. (If the `business_name` word-boundary replacement also hits the email local part, note the email is tokenized *before* the name — order in this file is deliberate: phone → email → map → name → year.)

- [ ] **Step 5: Commit**

```bash
git add lib/site-studio/compiler/identity.ts tests/siteStudioIdentity.test.ts
git commit -m "feat(site-studio): compiler pass 2 - deterministic identity tokenization"
```

---

### Task 7: Compiler pass 3a — text/image slots + title

Slot rule: an element is a **slottable leaf** when its children are text or allowed inline tags only (`b i em strong span br small a`-free — `a` excluded so link labels stay nav/link territory) and its trimmed text length ≥ 3. `html:true` when innerHTML ≠ decoded text (inline markup/entities present). Images become `{{img:*}}` with the `alt` paired as a text slot. `<title>` content becomes `{{title}}` with the sample recorded.

**Files:**
- Create: `lib/site-studio/compiler/slots.ts`
- Test: `tests/siteStudioSlots.test.ts`

- [ ] **Step 1: Write the failing test**

`tests/siteStudioSlots.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { parse } from "node-html-parser";
import { extractSlots, isSlottableLeaf } from "@/lib/site-studio/compiler/slots";
import { PageSource } from "@/lib/site-studio/compiler/inventory";

const page = (html: string): PageSource =>
  ({ file: "index.html", id: "index", kind: "home", root: parse(html) });

describe("isSlottableLeaf", () => {
  it("accepts a plain paragraph and one with inline formatting", () => {
    const root = parse("<p>Hello world</p><p>Hi <strong>there</strong></p><div><p>x</p></div>");
    const [a, b, c] = root.querySelectorAll("p, div");
    expect(isSlottableLeaf(a)).toBe(true);
    expect(isSlottableLeaf(b)).toBe(true);
    expect(isSlottableLeaf(c)).toBe(false);
  });
  it("rejects short text and structural containers", () => {
    expect(isSlottableLeaf(parse("<span>ok</span>").querySelector("span")!)).toBe(false);
    expect(isSlottableLeaf(parse("<p><a href='x.html'>Go</a></p>").querySelector("p")!)).toBe(false);
  });
});

describe("extractSlots", () => {
  it("tokenizes text, records samples and html flag, and derives max_chars", () => {
    const p = page("<html><head><title>Acme | Home</title></head><body><h1>Big Headline</h1><p>Hi <strong>there</strong> friend</p></body></html>");
    const { slots, titleSample } = extractSlots(p);
    expect(titleSample).toBe("Acme | Home");
    expect(p.root.querySelector("title")!.innerHTML).toBe("{{title}}");
    const h1 = slots.find((s) => s.sample === "Big Headline")!;
    expect(h1.html).toBe(false);
    expect(h1.max_chars).toBe(Math.max(40, Math.ceil("Big Headline".length * 1.5)));
    const rich = slots.find((s) => s.sample.includes("strong"))!;
    expect(rich.html).toBe(true);
    expect(p.root.querySelector("h1")!.innerHTML).toBe(`{{slot:${h1.id}}}`);
  });
  it("tokenizes images with paired alt slots", () => {
    const p = page(`<body><img src="img/a.jpg" alt="A plumber" width="800" height="450"></body>`);
    const { slots } = extractSlots(p);
    const img = slots.find((s) => s.type === "image")!;
    expect(img.sample).toBe("img/a.jpg");
    expect(img.aspect).toBe("16:9");
    const alt = slots.find((s) => s.id === `${img.id}_alt`)!;
    expect(alt.sample).toBe("A plumber");
    const el = p.root.querySelector("img")!;
    expect(el.getAttribute("src")).toBe(`{{img:${img.id}}}`);
    expect(el.getAttribute("alt")).toBe(`{{slot:${alt.id}}}`);
  });
  it("never slots identity tokens as standalone text", () => {
    const p = page("<body><p>{{id:phone}}</p><p>Call {{id:phone}} now for help</p></body>");
    const { slots } = extractSlots(p);
    expect(slots).toHaveLength(1);
    expect(slots[0].sample).toBe("Call {{id:phone}} now for help");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/siteStudioSlots.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Write the implementation**

`lib/site-studio/compiler/slots.ts`:

```ts
import { HTMLElement, NodeType } from "node-html-parser";
import { Diagnostic, SlotDef } from "../schema";
import { findTokens, imgToken, slotToken, TITLE_TOKEN } from "../tokens";
import { PageSource } from "./inventory";

const INLINE = new Set(["b", "i", "em", "strong", "span", "br", "small"]);
const SKIP = new Set(["script", "style", "title", "noscript"]);

/** Leaf = only text/inline children, ≥3 chars of real text, and not itself inline/skip. */
export function isSlottableLeaf(el: HTMLElement): boolean {
  const tag = el.rawTagName?.toLowerCase() ?? "";
  if (!tag || SKIP.has(tag) || INLINE.has(tag) || tag === "a") return false;
  for (const child of el.childNodes) {
    if (child.nodeType === NodeType.ELEMENT_NODE) {
      const t = (child as HTMLElement).rawTagName?.toLowerCase() ?? "";
      if (!INLINE.has(t)) return false;
    }
  }
  const textOnly = el.text.replace(/\{\{[^}]+\}\}/g, "").trim();
  const anyText = el.text.trim();
  if (anyText.length < 3) return false;
  // pure-token content (e.g. a <p> holding only {{id:phone}}) is identity, not a slot
  if (textOnly.length === 0) return false;
  return true;
}

const aspectOf = (w?: string, h?: string): string | undefined => {
  const a = Number(w), b = Number(h);
  if (!a || !b) return undefined;
  const g = (x: number, y: number): number => (y ? g(y, x % y) : x);
  const d = g(a, b);
  return `${a / d}:${b / d}`;
};

export function extractSlots(page: PageSource): { slots: SlotDef[]; titleSample: string; diagnostics: Diagnostic[] } {
  const slots: SlotDef[] = [];
  const diagnostics: Diagnostic[] = [];
  let n = 0;

  const titleEl = page.root.querySelector("title");
  const titleSample = titleEl?.text ?? "";
  if (titleEl) titleEl.set_content(TITLE_TOKEN);

  for (const el of page.root.querySelectorAll("*")) {
    const tag = el.rawTagName?.toLowerCase() ?? "";
    if (tag === "img") {
      const src = el.getAttribute("src") ?? "";
      if (!src || findTokens(src).length > 0) continue;
      const id = `${page.id}_i${++n}`;
      slots.push({
        id, type: "image", sample: src, html: false,
        aspect: aspectOf(el.getAttribute("width"), el.getAttribute("height")),
      });
      el.setAttribute("src", imgToken(id));
      const alt = el.getAttribute("alt");
      if (alt && findTokens(alt).length === 0) {
        const altId = `${id}_alt`;
        slots.push({ id: altId, type: "text", sample: alt, html: false, max_chars: Math.max(40, Math.ceil(alt.length * 1.5)) });
        el.setAttribute("alt", slotToken(altId));
      }
      continue;
    }
    if (!isSlottableLeaf(el)) continue;
    const sample = el.innerHTML.trim();
    const plain = el.text.trim();
    const id = `${page.id}_s${++n}`;
    slots.push({
      id, type: "text", sample,
      html: sample !== plain,
      max_chars: Math.max(40, Math.ceil(plain.length * 1.5)),
    });
    el.set_content(slotToken(id));
  }

  return { slots, titleSample, diagnostics };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/siteStudioSlots.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add lib/site-studio/compiler/slots.ts tests/siteStudioSlots.test.ts
git commit -m "feat(site-studio): compiler pass 3a - text/image slot extraction"
```

---

### Task 8: Compiler pass 3b — repeat regions

Rule: ≥3 consecutive element siblings with the same tag + class signature, mutually congruent structure, each containing slottable content → one repeat region. First instance becomes the fragment (slots tokenized fragment-locally); every instance's values become a `samples` row; the run is replaced by `<!--@repeat:id-->`.

**Files:**
- Create: `lib/site-studio/compiler/repeats.ts`
- Test: `tests/siteStudioRepeats.test.ts`

- [ ] **Step 1: Write the failing test**

`tests/siteStudioRepeats.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { parse } from "node-html-parser";
import { extractRepeats } from "@/lib/site-studio/compiler/repeats";
import { PageSource } from "@/lib/site-studio/compiler/inventory";

const page = (html: string): PageSource =>
  ({ file: "index.html", id: "index", kind: "home", root: parse(html) });

const CARDS = `
<section class="cards">
  <div class="card"><h3>Drain Cleaning</h3><p>Clogged drains cleared fast.</p></div>
  <div class="card"><h3>Water Heaters</h3><p>Repair and replacement done right.</p></div>
  <div class="card"><h3>Leak Repair</h3><p>We find leaks before they find you.</p></div>
</section>`;

describe("extractRepeats", () => {
  it("detects a 3-card run: fragment, marker, samples per instance", () => {
    const p = page(`<body>${CARDS}</body>`);
    const { repeats, fragments } = extractRepeats(p);
    expect(repeats).toHaveLength(1);
    const r = repeats[0];
    expect(r.min).toBe(1);
    expect(r.max).toBe(12);
    expect(r.slots).toHaveLength(2);
    expect(r.samples).toHaveLength(3);
    expect(r.samples[1][r.slots[0].id]).toBe("Water Heaters");
    expect(fragments[r.fragment]).toContain(`{{slot:${r.slots[0].id}}}`);
    const html = p.root.toString();
    expect(html).toContain(`<!--@repeat:${r.id}-->`);
    expect(html).not.toContain("Drain Cleaning");
  });
  it("ignores runs of two and non-congruent siblings", () => {
    const two = page(`<body><ul><li class="x"><p>Item one</p></li><li class="x"><p>Item two</p></li></ul></body>`);
    expect(extractRepeats(two).repeats).toHaveLength(0);
    const mixed = page(`<body><div>
      <div class="card"><h3>One title</h3><p>Body text</p></div>
      <div class="card"><h3>Two title</h3></div>
      <div class="card"><h3>Three title</h3><p>Body text</p></div>
    </div></body>`);
    expect(extractRepeats(mixed).repeats).toHaveLength(0);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/siteStudioRepeats.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Write the implementation**

`lib/site-studio/compiler/repeats.ts`:

```ts
import { HTMLElement, NodeType } from "node-html-parser";
import { Diagnostic, RepeatDef, SlotDef } from "../schema";
import { repeatMarker, slotToken } from "../tokens";
import { PageSource } from "./inventory";
import { isSlottableLeaf } from "./slots";

const signature = (el: HTMLElement) =>
  `${el.rawTagName?.toLowerCase()}.${(el.getAttribute("class") ?? "").split(/\s+/).filter(Boolean).sort().join(".")}`;

function congruent(a: HTMLElement, b: HTMLElement): boolean {
  if (a.rawTagName?.toLowerCase() !== b.rawTagName?.toLowerCase()) return false;
  const ac = a.childNodes.filter((n) => n.nodeType === NodeType.ELEMENT_NODE) as HTMLElement[];
  const bc = b.childNodes.filter((n) => n.nodeType === NodeType.ELEMENT_NODE) as HTMLElement[];
  if (ac.length !== bc.length) return false;
  return ac.every((child, i) => congruent(child, bc[i]));
}

const leaves = (el: HTMLElement): HTMLElement[] => {
  const own = isSlottableLeaf(el) ? [el] : [];
  const kids = el.childNodes
    .filter((n): n is HTMLElement => n.nodeType === NodeType.ELEMENT_NODE)
    .flatMap(leaves);
  return [...own, ...kids];
};

/** Pass 3b: runs of ≥3 congruent siblings with slottable content → repeat regions. */
export function extractRepeats(page: PageSource): { repeats: RepeatDef[]; fragments: Record<string, string>; diagnostics: Diagnostic[] } {
  const repeats: RepeatDef[] = [];
  const fragments: Record<string, string> = {};
  const diagnostics: Diagnostic[] = [];
  let rn = 0;

  for (const parent of page.root.querySelectorAll("*")) {
    const kids = parent.childNodes.filter((n): n is HTMLElement => n.nodeType === NodeType.ELEMENT_NODE);
    if (kids.length < 3) continue;
    const sig = signature(kids[0]);
    if (!kids.every((k) => signature(k) === sig)) continue;
    if (!kids.every((k) => congruent(k, kids[0]))) continue;
    if (leaves(kids[0]).length === 0) continue;

    const id = `${page.id}_r${++rn}`;
    const slots: SlotDef[] = [];
    const samples: Record<string, string>[] = [];

    // samples first (leaf order is identical across congruent instances)
    for (const inst of kids) {
      const row: Record<string, string> = {};
      leaves(inst).forEach((leaf, i) => { row[`${id}_s${i + 1}`] = leaf.innerHTML.trim(); });
      samples.push(row);
    }
    // fragment from the first instance
    leaves(kids[0]).forEach((leaf, i) => {
      const sid = `${id}_s${i + 1}`;
      const sample = leaf.innerHTML.trim();
      const plain = leaf.text.trim();
      slots.push({ id: sid, type: "text", sample, html: sample !== plain, max_chars: Math.max(40, Math.ceil(plain.length * 1.5)) });
      leaf.set_content(slotToken(sid));
    });
    fragments[id] = kids[0].toString();

    kids[0].replaceWith(repeatMarker(id));
    for (const extra of kids.slice(1)) extra.remove();
    repeats.push({ id, fragment: id, min: 1, max: 12, slots, samples });
  }

  return { repeats, fragments, diagnostics };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/siteStudioRepeats.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add lib/site-studio/compiler/repeats.ts tests/siteStudioRepeats.test.ts
git commit -m "feat(site-studio): compiler pass 3b - congruent repeat region extraction"
```

---

### Task 9: Compiler pass 4 — nav regions

Rule: a `<ul>`/`<ol>` whose `<li>` children number ≥2, each containing exactly one `<a>` with an internal href, becomes a nav region (`location` from the nearest `header`/`footer`/`nav` ancestor, default `header`). The first `<li>` becomes the fragment with `{{nav:title}}`/`{{nav:href}}`; the list's children are replaced by `<!--@nav:id-->`. Identical regions across pages share one region id (keyed by location + item count). Pages with no detectable list nav get a `warn`.

**Files:**
- Create: `lib/site-studio/compiler/nav.ts`
- Test: `tests/siteStudioNav.test.ts`

- [ ] **Step 1: Write the failing test**

`tests/siteStudioNav.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { inventory } from "@/lib/site-studio/compiler/inventory";
import { extractNav } from "@/lib/site-studio/compiler/nav";
import { fixtureFiles } from "./helpers/siteStudioFixtures";
import { NAV_HREF, NAV_TITLE } from "@/lib/site-studio/tokens";

describe("extractNav (plumberpro)", () => {
  const inv = inventory(fixtureFiles("plumberpro"));
  const { regions, fragments } = extractNav(inv);

  it("finds header and footer nav regions shared across pages", () => {
    const locations = regions.map((r) => r.location).sort();
    expect(locations).toEqual(["footer", "header"]);
  });
  it("fragment carries nav tokens", () => {
    const frag = fragments[regions[0].fragment];
    expect(frag).toContain(NAV_TITLE);
    expect(frag).toContain(NAV_HREF);
  });
  it("every page now holds nav markers, no literal menu items", () => {
    for (const p of inv.pages) {
      const html = p.root.toString();
      expect(html).toContain("<!--@nav:");
      expect(html).not.toMatch(/<li><a href="about\.html">About<\/a><\/li>/);
    }
  });
});

describe("extractNav (bakery — div nav is not detected)", () => {
  const inv = inventory(fixtureFiles("bakery"));
  const { regions, diagnostics } = extractNav(inv);
  it("detects nothing and warns", () => {
    expect(regions).toHaveLength(0);
    expect(diagnostics.some((d) => d.code === "nav_not_detected" && d.level === "warn")).toBe(true);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/siteStudioNav.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Write the implementation**

`lib/site-studio/compiler/nav.ts`:

```ts
import { HTMLElement, NodeType } from "node-html-parser";
import { Diagnostic, NavRegionDef } from "../schema";
import { navMarker, NAV_HREF, NAV_TITLE } from "../tokens";
import { Inventory } from "./inventory";

const isInternal = (href: string) =>
  !!href && !/^(https?:|mailto:|tel:|#|\{\{)/.test(href);

function locationOf(el: HTMLElement): NavRegionDef["location"] {
  let cur: HTMLElement | null = el;
  while (cur) {
    const tag = cur.rawTagName?.toLowerCase();
    if (tag === "footer") return "footer";
    if (tag === "header") return "header";
    cur = cur.parentNode as HTMLElement | null;
  }
  return "header";
}

/** Pass 4: list navs → shared nav regions with {{nav:*}} fragments. */
export function extractNav(inv: Inventory): { regions: NavRegionDef[]; fragments: Record<string, string>; diagnostics: Diagnostic[] } {
  const regions: NavRegionDef[] = [];
  const fragments: Record<string, string> = {};
  const diagnostics: Diagnostic[] = [];
  const byKey = new Map<string, string>();
  let found = false;

  for (const page of inv.pages) {
    let pageHasNav = false;
    for (const list of page.root.querySelectorAll("ul, ol")) {
      const items = list.childNodes.filter((n): n is HTMLElement =>
        n.nodeType === NodeType.ELEMENT_NODE && (n as HTMLElement).rawTagName?.toLowerCase() === "li");
      if (items.length < 2) continue;
      const links = items.map((li) => {
        const as = li.querySelectorAll("a");
        return as.length === 1 && isInternal(as[0].getAttribute("href") ?? "") ? as[0] : null;
      });
      if (links.some((l) => l === null)) continue;

      const location = locationOf(list);
      const key = `${location}:${items.length}`;
      let id = byKey.get(key);
      if (!id) {
        id = `nav_${location}${byKey.size ? `_${byKey.size}` : ""}`;
        byKey.set(key, id);
        const fragLi = items[0].clone() as HTMLElement;
        const a = fragLi.querySelector("a")!;
        a.setAttribute("href", NAV_HREF);
        a.set_content(NAV_TITLE);
        fragments[id] = fragLi.toString();
        regions.push({ id, fragment: id, location });
      }
      list.set_content(navMarker(id));
      pageHasNav = true;
      found = true;
    }
    if (!pageHasNav)
      diagnostics.push({ level: "warn", code: "nav_not_detected", page: page.file, message: `No list nav detected on ${page.file}; its links will degrade to plain slots/links — review manually.` });
  }

  if (!found && inv.pages.length > 0)
    diagnostics.push({ level: "warn", code: "nav_not_detected", message: "No nav regions detected anywhere in the template" });

  return { regions, fragments, diagnostics };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/siteStudioNav.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add lib/site-studio/compiler/nav.ts tests/siteStudioNav.test.ts
git commit -m "feat(site-studio): compiler pass 4 - nav region extraction"
```

---

### Task 10: Compiler pass 5 — theme mapping

**Files:**
- Create: `lib/site-studio/compiler/theme.ts`
- Test: `tests/siteStudioThemeCompile.test.ts`

- [ ] **Step 1: Write the failing test**

`tests/siteStudioThemeCompile.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { extractTheme, isNeutralHex } from "@/lib/site-studio/compiler/theme";
import { fixtureFiles } from "./helpers/siteStudioFixtures";

describe("isNeutralHex", () => {
  it("flags near-black, near-white and grey; keeps saturated colors", () => {
    expect(isNeutralHex("#222222")).toBe(true);
    expect(isNeutralHex("#fafafa")).toBe(true);
    expect(isNeutralHex("#888888")).toBe(true);
    expect(isNeutralHex("#0a5adf")).toBe(false);
    expect(isNeutralHex("#b4540a")).toBe(false);
  });
});

describe("extractTheme", () => {
  it("plumberpro: css_vars mode, roles ranked by var() usage", () => {
    const { theme } = extractTheme(fixtureFiles("plumberpro"));
    expect(theme.mode).toBe("css_vars");
    expect(theme.roles.brand).toEqual({ var: "--primary", hex: "#0a5adf" });
    expect(theme.roles.brand_deep).toEqual({ var: "--primary-dark", hex: "#063a91" });
    expect(theme.roles.accent).toEqual({ var: "--highlight", hex: "#ff9f1c" });
  });
  it("bakery: literal_remap mode from hex frequency, neutrals excluded", () => {
    const { theme } = extractTheme(fixtureFiles("bakery"));
    expect(theme.mode).toBe("literal_remap");
    expect(theme.roles.brand.hex).toBe("#b4540a");
    expect(Object.values(theme.roles).map((r) => r.hex)).not.toContain("#333333");
  });
  it("no colors at all: mode none with info diagnostic", () => {
    const { theme, diagnostics } = extractTheme({ "style.css": new TextEncoder().encode("body{font-size:14px}") });
    expect(theme.mode).toBe("none");
    expect(diagnostics.some((d) => d.code === "theme_none")).toBe(true);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/siteStudioThemeCompile.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Write the implementation**

`lib/site-studio/compiler/theme.ts`:

```ts
import { Diagnostic, FileMap, ThemeDef } from "../schema";

const ROLE_ORDER = ["brand", "brand_deep", "accent"] as const;

export function isNeutralHex(hex: string): boolean {
  const h = hex.replace("#", "");
  const full = h.length === 3 ? h.split("").map((c) => c + c).join("") : h;
  const r = parseInt(full.slice(0, 2), 16) / 255;
  const g = parseInt(full.slice(2, 4), 16) / 255;
  const b = parseInt(full.slice(4, 6), 16) / 255;
  const max = Math.max(r, g, b), min = Math.min(r, g, b);
  const lum = (max + min) / 2;
  const sat = max === min ? 0 : (max - min) / (1 - Math.abs(2 * lum - 1));
  return sat < 0.12 || lum > 0.94 || lum < 0.06;
}

const cssAssets = (files: FileMap): [string, string][] =>
  Object.entries(files)
    .filter(([p]) => p.toLowerCase().endsWith(".css"))
    .map(([p, b]) => [p, new TextDecoder().decode(b)]);

/** Pass 5: map the template's colors to named roles. */
export function extractTheme(files: FileMap): { theme: ThemeDef; diagnostics: Diagnostic[] } {
  const diagnostics: Diagnostic[] = [];
  const css = cssAssets(files).map(([, s]) => s).join("\n");

  // Path 1: custom properties ranked by var() usage
  const decls = [...css.matchAll(/(--[A-Za-z0-9_-]+)\s*:\s*(#[0-9a-fA-F]{3,6})\b/g)]
    .map(([, name, hex]) => ({ name, hex: hex.toLowerCase() }))
    .filter((d) => !isNeutralHex(d.hex));
  if (decls.length > 0) {
    const ranked = decls
      .map((d) => ({ ...d, uses: (css.match(new RegExp(`var\\(${d.name}\\)`, "g")) ?? []).length }))
      .sort((a, b) => b.uses - a.uses);
    const roles: ThemeDef["roles"] = {};
    ROLE_ORDER.forEach((role, i) => { if (ranked[i]) roles[role] = { var: ranked[i].name, hex: ranked[i].hex }; });
    return { theme: { mode: "css_vars", roles }, diagnostics };
  }

  // Path 2: literal hex frequency
  const counts = new Map<string, number>();
  for (const [, hex] of css.matchAll(/(#[0-9a-fA-F]{3,6})\b/g)) {
    const norm = hex.toLowerCase();
    if (!isNeutralHex(norm)) counts.set(norm, (counts.get(norm) ?? 0) + 1);
  }
  if (counts.size > 0) {
    const ranked = [...counts.entries()].sort((a, b) => b[1] - a[1]).map(([hex]) => hex);
    const roles: ThemeDef["roles"] = {};
    ROLE_ORDER.forEach((role, i) => { if (ranked[i]) roles[role] = { hex: ranked[i] }; });
    return { theme: { mode: "literal_remap", roles }, diagnostics };
  }

  diagnostics.push({ level: "info", code: "theme_none", message: "No non-neutral colors found; recoloring disabled for this template" });
  return { theme: { mode: "none", roles: {} }, diagnostics };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/siteStudioThemeCompile.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add lib/site-studio/compiler/theme.ts tests/siteStudioThemeCompile.test.ts
git commit -m "feat(site-studio): compiler pass 5 - theme role mapping"
```

---

### Task 11: Compiler pass 6 (subset) — JS + asset identity flags

**Files:**
- Create: `lib/site-studio/compiler/jsflags.ts`
- Test: `tests/siteStudioJsFlags.test.ts`

- [ ] **Step 1: Write the failing test**

`tests/siteStudioJsFlags.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { parse } from "node-html-parser";
import { flagJs } from "@/lib/site-studio/compiler/jsflags";
import { Inventory } from "@/lib/site-studio/compiler/inventory";

const enc = (s: string) => new TextEncoder().encode(s);
const inv = (html: string, assets: Record<string, string> = {}): Inventory => ({
  pages: [{ file: "index.html", id: "index", kind: "home", root: parse(html) }],
  assets: Object.fromEntries(Object.entries(assets).map(([k, v]) => [k, enc(v)])),
  diagnostics: [],
});

describe("flagJs", () => {
  it("flags DOM-writing inline scripts", () => {
    const d = flagJs(inv(`<body><script>document.getElementById("x").innerHTML = "<nav>...</nav>";</script></body>`), {});
    expect(d.some((x) => x.code === "js_renders_dom" && x.level === "warn")).toBe(true);
  });
  it("flags identity echoes inside js/css assets", () => {
    const d = flagJs(inv("<body></body>", { "app.js": `var phone = "(512) 555-0147";` }), { phone: "(512) 555-0147" });
    expect(d.some((x) => x.code === "asset_identity_echo" && x.level === "warn")).toBe(true);
  });
  it("silent on clean templates", () => {
    expect(flagJs(inv("<body><p>Hi</p></body>", { "app.js": "console.log(1)" }), { phone: "(512) 555-0147" })).toEqual([]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/siteStudioJsFlags.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Write the implementation**

`lib/site-studio/compiler/jsflags.ts`:

```ts
import { Diagnostic } from "../schema";
import { Inventory } from "./inventory";

const DOM_WRITE_RE = /innerHTML|document\.write|customElements\.define|insertAdjacentHTML/;

/** Pass 6 (Phase-1 subset): flag JS that renders DOM and identity echoes in assets. Baking lands in Phase 2. */
export function flagJs(inv: Inventory, identity: Record<string, string>): Diagnostic[] {
  const diagnostics: Diagnostic[] = [];

  for (const page of inv.pages) {
    for (const script of page.root.querySelectorAll("script")) {
      if (DOM_WRITE_RE.test(script.text)) {
        diagnostics.push({
          level: "warn", code: "js_renders_dom", page: page.file,
          message: `Inline script on ${page.file} writes to the DOM; compile-time baking lands in Phase 2 — review its output manually.`,
        });
        break;
      }
    }
  }

  for (const [path, bytes] of Object.entries(inv.assets)) {
    if (!/\.(js|css)$/i.test(path)) continue;
    const text = new TextDecoder().decode(bytes);
    if (DOM_WRITE_RE.test(text) && path.toLowerCase().endsWith(".js"))
      diagnostics.push({ level: "warn", code: "js_renders_dom", message: `${path} writes to the DOM; review its output manually.` });
    for (const [key, value] of Object.entries(identity)) {
      if (value.length >= 6 && text.includes(value))
        diagnostics.push({ level: "warn", code: "asset_identity_echo", message: `${path} contains demo ${key} ("${value}"); asset tokenization lands in Phase 2 — review.` });
    }
  }

  return diagnostics;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/siteStudioJsFlags.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add lib/site-studio/compiler/jsflags.ts tests/siteStudioJsFlags.test.ts
git commit -m "feat(site-studio): compiler pass 6 subset - js and asset identity flags"
```

---

### Task 12: Link tokenization + compile orchestrator

Pass 4b: after nav extraction, every remaining internal `<a href>` that targets a known page file becomes `{{link:pageId}}` — this closes the internal-404 hole for body/logo links (the renderer resolves link tokens to built outputs, falling back to `index.html`). Then the orchestrator. Order: inventory → identity → nav → links → repeats → slots → theme → jsflags. (Verification render joins in Task 15.)

Known Phase-1 limitation, self-catching: if congruent repeat instances carry *different* links per card, the fragment keeps the first instance's link and the Task-15 round-trip check turns that into a certification blocker — the template gets flagged for review instead of silently misbuilding.

**Files:**
- Create: `lib/site-studio/compiler/links.ts`
- Create: `lib/site-studio/compiler/compile.ts`
- Test: `tests/siteStudioCompile.test.ts`

- [ ] **Step 1: Write the failing test**

`tests/siteStudioCompile.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { compileTemplate } from "@/lib/site-studio/compiler/compile";
import { manifestSchema } from "@/lib/site-studio/schema";
import { zipFromMap } from "@/lib/site-studio/zip";
import { fixtureZip } from "./helpers/siteStudioFixtures";

describe("compileTemplate (plumberpro)", () => {
  const result = compileTemplate(fixtureZip("plumberpro"), "plumberpro");

  it("produces a schema-valid manifest", () => {
    expect(() => manifestSchema.parse(result.template.manifest)).not.toThrow();
    expect(result.template.manifest.name).toBe("plumberpro");
    expect(result.template.manifest.version).toBe(1);
  });
  it("compiled pages carry zero demo identity or copy", () => {
    const all = Object.values(result.template.pages).join("\n");
    expect(all).not.toContain("PlumberPro");
    expect(all).not.toContain("512");
    expect(all).not.toContain("Drain Cleaning");
    expect(all).not.toContain("Fast, Friendly");
  });
  it("manifest carries the samples instead (identity inside samples stays tokenized)", () => {
    const index = result.template.manifest.pages.find((p) => p.id === "index")!;
    expect(index.title_sample).toContain("{{id:business_name}}");
    expect(index.slots.some((s) => s.sample.includes("Fast, Friendly"))).toBe(true);
    expect(index.repeats[0].samples.map((r) => Object.values(r)[0])).toContain("Drain Cleaning");
  });
  it("internal body links are tokenized (pass 4b)", () => {
    expect(result.template.pages["index.html"]).toContain(`href="{{link:index}}"`);
    expect(result.template.pages["index.html"]).not.toContain(`href="index.html"`);
  });
  it("has nav regions, theme, assets and no blockers", () => {
    expect(result.template.manifest.nav.length).toBeGreaterThan(0);
    expect(result.template.manifest.theme.mode).toBe("css_vars");
    expect(Object.keys(result.template.assets)).toContain("css/style.css");
    expect(result.diagnostics.filter((d) => d.level === "blocker")).toEqual([]);
    expect(result.ok).toBe(true);
  });
});

describe("compileTemplate (empty zip)", () => {
  it("returns ok:false with the no_pages blocker", () => {
    const result = compileTemplate(zipFromMap({ "style.css": new TextEncoder().encode("body{}") }), "empty");
    expect(result.ok).toBe(false);
    expect(result.diagnostics.some((d) => d.code === "no_pages")).toBe(true);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/siteStudioCompile.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Write the implementation**

`lib/site-studio/compiler/links.ts`:

```ts
import { Diagnostic } from "../schema";
import { linkToken } from "../tokens";
import { Inventory } from "./inventory";

const isRawInternal = (href: string) =>
  !!href && !/^(https?:|mailto:|tel:|#|\{\{)/.test(href);

/** Pass 4b: remaining internal <a href> targeting a known page file → {{link:pageId}}. */
export function tokenizeInternalLinks(inv: Inventory): Diagnostic[] {
  const idByFile = new Map(inv.pages.map((p) => [p.file, p.id]));
  for (const page of inv.pages) {
    for (const a of page.root.querySelectorAll("a")) {
      const href = a.getAttribute("href") ?? "";
      if (!isRawInternal(href)) continue;
      const clean = href.replace(/^\.\//, "").split(/[?#]/)[0];
      const target = idByFile.get(clean);
      if (target) a.setAttribute("href", linkToken(target));
    }
  }
  return [];
}
```

`lib/site-studio/compiler/compile.ts`:

```ts
import { CompiledTemplate, Diagnostic, PageDef, TemplateManifest } from "../schema";
import { unzipToMap } from "../zip";
import { inventory } from "./inventory";
import { extractIdentity } from "./identity";
import { extractNav } from "./nav";
import { tokenizeInternalLinks } from "./links";
import { extractRepeats } from "./repeats";
import { extractSlots } from "./slots";
import { extractTheme } from "./theme";
import { flagJs } from "./jsflags";

export interface CompileResult {
  ok: boolean;
  template: CompiledTemplate;
  diagnostics: Diagnostic[];
}

/**
 * The deterministic compile pipeline. Order matters:
 * identity first (tokens flow into fragments/samples), nav before repeats
 * (nav lists must not become repeats), repeats before slots (card text
 * belongs to fragments, not page slots).
 */
export function compileTemplate(zipBytes: Uint8Array, name: string): CompileResult {
  const diagnostics: Diagnostic[] = [];
  const inv = inventory(unzipToMap(zipBytes));
  diagnostics.push(...inv.diagnostics);

  const { identity, diagnostics: idDiags } = extractIdentity(inv);
  diagnostics.push(...idDiags);

  const nav = extractNav(inv);
  diagnostics.push(...nav.diagnostics);
  diagnostics.push(...tokenizeInternalLinks(inv));

  const fragments: Record<string, string> = { ...nav.fragments };
  const pageDefs: PageDef[] = [];
  const pages: Record<string, string> = {};

  for (const page of inv.pages) {
    const rep = extractRepeats(page);
    diagnostics.push(...rep.diagnostics);
    Object.assign(fragments, rep.fragments);

    const slot = extractSlots(page);
    diagnostics.push(...slot.diagnostics);

    pageDefs.push({
      id: page.id, file: page.file, kind: page.kind,
      stampable: page.kind === "service" || page.kind === "area",
      title_sample: slot.titleSample,
      slots: slot.slots,
      repeats: rep.repeats,
    });
    pages[page.file] = page.root.toString();
  }

  const theme = extractTheme(inv.assets);
  diagnostics.push(...theme.diagnostics);
  diagnostics.push(...flagJs(inv, identity));

  const manifest: TemplateManifest = {
    engine: 3, name, version: 1, identity,
    theme: theme.theme, nav: nav.regions, pages: pageDefs,
  };

  return {
    ok: !diagnostics.some((d) => d.level === "blocker"),
    template: { manifest, pages, fragments, assets: inv.assets },
    diagnostics,
  };
}
```

Note: with zero pages the manifest violates `pages.min(1)` — that is fine; `ok:false` results are never persisted as packages, and `manifestSchema.parse` is only a contract for `ok:true` results. (Task 15's verify pass enforces this by parsing the manifest of every ok result.)

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/siteStudioCompile.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add lib/site-studio/compiler/links.ts lib/site-studio/compiler/compile.ts tests/siteStudioCompile.test.ts
git commit -m "feat(site-studio): link tokenization + deterministic compile orchestrator"
```

---

### Task 13: Sample Content Document builder

**Files:**
- Create: `lib/site-studio/sample.ts`
- Test: `tests/siteStudioSample.test.ts`

- [ ] **Step 1: Write the failing test**

`tests/siteStudioSample.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { compileTemplate } from "@/lib/site-studio/compiler/compile";
import { sampleContentDoc } from "@/lib/site-studio/sample";
import { contentDocSchema } from "@/lib/site-studio/schema";
import { fixtureZip } from "./helpers/siteStudioFixtures";

describe("sampleContentDoc", () => {
  const { template } = compileTemplate(fixtureZip("plumberpro"), "plumberpro");
  const doc = sampleContentDoc(template.manifest);

  it("is schema-valid and mirrors the manifest", () => {
    expect(() => contentDocSchema.parse(doc)).not.toThrow();
    expect(doc.identity.business_name).toBe("PlumberPro");
    expect(doc.pages.map((p) => p.page_id).sort()).toEqual(
      template.manifest.pages.map((p) => p.id).sort(),
    );
  });
  it("fills every slot and repeat from samples, theme empty (keep original colors)", () => {
    const index = doc.pages.find((p) => p.page_id === "index")!;
    const def = template.manifest.pages.find((p) => p.id === "index")!;
    expect(Object.keys(index.slots).sort()).toEqual(def.slots.map((s) => s.id).sort());
    expect(index.repeats[def.repeats[0].id]).toHaveLength(def.repeats[0].samples.length);
    expect(doc.theme).toEqual({});
    expect(index.title).toBe(def.title_sample);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/siteStudioSample.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Write the implementation**

`lib/site-studio/sample.ts`:

```ts
import { ContentDoc, TemplateManifest } from "./schema";

/** The demo site expressed as a Content Document — powers previews and the verification render. */
export function sampleContentDoc(manifest: TemplateManifest): ContentDoc {
  return {
    identity: { ...manifest.identity },
    theme: {},
    pages: manifest.pages.map((page) => ({
      page_id: page.id,
      title: page.title_sample,
      slots: Object.fromEntries(page.slots.map((s) => [s.id, s.sample])),
      repeats: Object.fromEntries(page.repeats.map((r) => [r.id, r.samples.map((row) => ({ ...row }))])),
    })),
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/siteStudioSample.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add lib/site-studio/sample.ts tests/siteStudioSample.test.ts
git commit -m "feat(site-studio): sample content document builder"
```

---

### Task 14: The renderer

Pure function. Tested against a tiny **hand-written package** (not compiler output) so the format itself is exercised independently — then the round-trip in Task 15 marries the two.

**Files:**
- Create: `lib/site-studio/render/theme.ts`
- Create: `lib/site-studio/render/renderer.ts`
- Test: `tests/siteStudioRenderer.test.ts`

- [ ] **Step 1: Write the failing test**

`tests/siteStudioRenderer.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { renderSite } from "@/lib/site-studio/render/renderer";
import { CompiledTemplate, ContentDoc } from "@/lib/site-studio/schema";

const dec = (b: Uint8Array) => new TextDecoder().decode(b);

const tpl: CompiledTemplate = {
  manifest: {
    engine: 3, name: "mini", version: 1,
    identity: { business_name: "Demo Co", phone: "(111) 111-1111" },
    theme: { mode: "css_vars", roles: { brand: { var: "--main", hex: "#112233" } } },
    nav: [{ id: "nav_header", fragment: "nav_header", location: "header" }],
    pages: [
      {
        id: "index", file: "index.html", kind: "home", stampable: false, title_sample: "Demo Co",
        slots: [
          { id: "index_s1", type: "text", sample: "Welcome to Demo Co", html: false, max_chars: 60 },
          { id: "index_i1", type: "image", sample: "img/a.jpg", html: false },
        ],
        repeats: [{
          id: "index_r1", fragment: "index_r1", min: 1, max: 12,
          slots: [{ id: "index_r1_s1", type: "text", sample: "Card A", html: false, max_chars: 40 }],
          samples: [{ index_r1_s1: "Card A" }],
        }],
      },
      { id: "svc", file: "service.html", kind: "service", stampable: true, title_sample: "Service", slots: [{ id: "svc_s1", type: "text", sample: "About this service", html: false, max_chars: 60 }], repeats: [] },
    ],
  },
  pages: {
    "index.html": `<html><head><title>{{title}}</title></head><body><ul><!--@nav:nav_header--></ul><h1>{{slot:index_s1}}</h1><img src="{{img:index_i1}}"><div class="cards"><!--@repeat:index_r1--></div><p>{{id:business_name}} — {{id:phone}}</p><a href="{{link:svc}}">svc</a></body></html>`,
    "service.html": `<html><head><title>{{title}}</title></head><body><ul><!--@nav:nav_header--></ul><p>{{slot:svc_s1}}</p></body></html>`,
  },
  fragments: {
    nav_header: `<li><a href="{{nav:href}}">{{nav:title}}</a></li>`,
    index_r1: `<div class="card">{{slot:index_r1_s1}}</div>`,
  },
  assets: { "css/style.css": new TextEncoder().encode(":root{--main:#112233}\nh1{color:var(--main)}") },
};

const doc: ContentDoc = {
  identity: { business_name: "Acme & Sons", phone: "(303) 555-9999" },
  theme: { brand: "#ff0000" },
  pages: [
    {
      page_id: "index", title: "Acme & Sons | Denver",
      slots: { index_s1: "Denver's <finest> plumbers", index_i1: "img/acme.jpg" },
      repeats: { index_r1: [{ index_r1_s1: "Sewer" }, { index_r1_s1: "Heaters" }] },
    },
    { page_id: "svc", output: "services/sewer.html", nav_title: "Sewer", title: "Sewer Repair", slots: { svc_s1: "We fix sewers." }, repeats: {} },
  ],
};

describe("renderSite", () => {
  const result = renderSite(tpl, doc);
  it("renders ok", () => { expect(result.ok).toBe(true); });
  if (!result.ok) return;
  const index = dec(result.files["index.html"]);

  it("fills identity, escaped slots, images, title", () => {
    expect(index).toContain("Acme &amp; Sons — (303) 555-9999");
    expect(index).toContain("Denver's &lt;finest&gt; plumbers");
    expect(index).toContain(`src="img/acme.jpg"`);
    expect(index).toContain("<title>Acme &amp; Sons | Denver</title>");
  });
  it("stamps repeats once per row", () => {
    expect(index.match(/class="card"/g)).toHaveLength(2);
    expect(index).toContain("Sewer");
    expect(index).toContain("Heaters");
  });
  it("renders nav from built non-stampable pages only", () => {
    expect(index).toContain(`<li><a href="index.html">Acme &amp; Sons | Denver</a></li>`);
    expect(index).not.toContain(`<li><a href="services/sewer.html">`);
  });
  it("resolves internal links to built outputs", () => {
    expect(index).toContain(`href="services/sewer.html"`);
    expect(Object.keys(result.files)).toContain("services/sewer.html");
  });
  it("applies css_vars theme via injected override stylesheet", () => {
    expect(Object.keys(result.files)).toContain("studio-theme.css");
    expect(dec(result.files["studio-theme.css"])).toContain("--main: #ff0000");
    expect(index).toContain(`<link rel="stylesheet" href="studio-theme.css">`);
  });
  it("output contains no leftover tokens or markers", () => {
    for (const f of Object.values(result.files)) expect(dec(f)).not.toMatch(/\{\{|<!--@/);
  });
});

describe("renderSite refusals", () => {
  it("refuses and names missing slots", () => {
    const bad: ContentDoc = { ...doc, pages: [{ ...doc.pages[0], slots: { index_i1: "x.jpg" } }] };
    const r = renderSite(tpl, bad);
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.missing).toContainEqual({ page_id: "index", slot_id: "index_s1" });
  });
  it("refuses unknown page ids", () => {
    const r = renderSite(tpl, { ...doc, pages: [{ page_id: "nope", title: "x", slots: {}, repeats: {} }] });
    expect(r.ok).toBe(false);
  });
  it("refuses missing identity keys referenced by the template", () => {
    const r = renderSite(tpl, { ...doc, identity: { business_name: "Acme" } });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.missing.some((m) => m.slot_id === "id:phone")).toBe(true);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/siteStudioRenderer.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Write the implementation**

`lib/site-studio/render/theme.ts`:

```ts
import { FileMap, ThemeDef } from "../schema";

/**
 * Apply the operator/lead theme to the template's assets.
 * css_vars → emit studio-theme.css overriding the mapped variables (caller injects the <link>).
 * literal_remap → rewrite the original hexes inside css assets.
 * none / empty docTheme → untouched.
 */
export function applyTheme(
  assets: FileMap, theme: ThemeDef, docTheme: Record<string, string>,
): { assets: FileMap; injectCssFile?: string } {
  const entries = Object.entries(docTheme).filter(([role]) => theme.roles[role]);
  if (theme.mode === "none" || entries.length === 0) return { assets };

  if (theme.mode === "css_vars") {
    const lines = entries.map(([role, hex]) => `  ${theme.roles[role].var}: ${hex};`);
    return {
      assets: { ...assets, "studio-theme.css": new TextEncoder().encode(`:root {\n${lines.join("\n")}\n}\n`) },
      injectCssFile: "studio-theme.css",
    };
  }

  // literal_remap
  const out: FileMap = { ...assets };
  for (const [path, bytes] of Object.entries(assets)) {
    if (!path.toLowerCase().endsWith(".css")) continue;
    let css = new TextDecoder().decode(bytes);
    for (const [role, hex] of entries) css = css.split(theme.roles[role].hex).join(hex);
    out[path] = new TextEncoder().encode(css);
  }
  return { assets: out };
}
```

`lib/site-studio/render/renderer.ts`:

```ts
import { CompiledTemplate, ContentDoc, ContentDocPage, FileMap, RenderResult } from "../schema";
import { escapeHtml, findTokens, navMarker, repeatMarker, sanitizeInline, NAV_HREF, NAV_TITLE } from "../tokens";
import { applyTheme } from "./theme";

const fillSlot = (value: string, sample: string, html: boolean): string =>
  html ? (value === sample ? value : sanitizeInline(value)) : escapeHtml(value);

/** Depth-aware relative prefix: "services/sewer.html" links back up with "../". */
const relPrefix = (from: string) => "../".repeat(from.split("/").length - 1);

export function renderSite(tpl: CompiledTemplate, doc: ContentDoc): RenderResult {
  const missing: { page_id: string; slot_id: string }[] = [];
  const defs = new Map(tpl.manifest.pages.map((p) => [p.id, p]));

  // completeness: pages + slots + repeat bounds
  const built: { def: any; page: ContentDocPage; output: string }[] = [];
  for (const page of doc.pages) {
    const def = defs.get(page.page_id);
    if (!def) { missing.push({ page_id: page.page_id, slot_id: "(unknown page)" }); continue; }
    for (const s of def.slots) if (!(s.id in page.slots)) missing.push({ page_id: page.page_id, slot_id: s.id });
    for (const r of def.repeats) {
      const rows = page.repeats[r.id] ?? [];
      if (rows.length < r.min) missing.push({ page_id: page.page_id, slot_id: `${r.id} (needs ≥${r.min} rows)` });
      for (const row of rows) for (const s of r.slots) if (!(s.id in row)) missing.push({ page_id: page.page_id, slot_id: s.id });
    }
    built.push({ def, page, output: page.output ?? def.file });
  }

  // completeness: identity keys the skeletons actually reference
  const referenced = new Set(
    Object.values(tpl.pages).concat(Object.values(tpl.fragments))
      .flatMap((html) => findTokens(html)).filter((t) => t.kind === "id").map((t) => t.key),
  );
  for (const key of referenced) if (!(key in doc.identity)) missing.push({ page_id: "(site)", slot_id: `id:${key}` });

  if (missing.length > 0) return { ok: false, missing };

  const navItems = built.filter((b) => !b.def.stampable)
    .map((b) => ({ href: b.output, title: b.page.nav_title ?? b.page.title }));
  const outputOf = new Map<string, string>();
  for (const b of built) if (!outputOf.has(b.def.id)) outputOf.set(b.def.id, b.output);

  const themed = applyTheme(tpl.assets, tpl.manifest.theme, doc.theme);
  const files: FileMap = { ...themed.assets };

  for (const b of built) {
    let html = tpl.pages[b.def.file];
    const prefix = relPrefix(b.output);

    for (const region of tpl.manifest.nav) {
      const frag = tpl.fragments[region.fragment];
      const rendered = navItems
        .map((item) => frag.split(NAV_HREF).join(prefix + item.href).split(NAV_TITLE).join(escapeHtml(item.title)))
        .join("");
      html = html.split(navMarker(region.id)).join(rendered);
    }

    for (const r of b.def.repeats) {
      const frag = tpl.fragments[r.fragment];
      const rows = (b.page.repeats[r.id] ?? []).slice(0, r.max);
      const rendered = rows.map((row: Record<string, string>) => {
        let f = frag;
        for (const s of r.slots) f = f.split(`{{slot:${s.id}}}`).join(fillSlot(row[s.id], s.sample, s.html));
        return f;
      }).join("");
      html = html.split(repeatMarker(r.id)).join(rendered);
    }

    for (const s of b.def.slots) {
      const token = s.type === "image" ? `{{img:${s.id}}}` : `{{slot:${s.id}}}`;
      const value = s.type === "image" ? escapeHtml(b.page.slots[s.id]) : fillSlot(b.page.slots[s.id], s.sample, s.html);
      html = html.split(token).join(value);
    }

    html = html.split("{{title}}").join(escapeHtml(b.page.title));

    for (const t of findTokens(html)) {
      if (t.kind === "link") html = html.split(t.raw).join(prefix + (outputOf.get(t.key) ?? "index.html"));
      else if (t.kind === "id") html = html.split(t.raw).join(escapeHtml(doc.identity[t.key]));
    }

    if (themed.injectCssFile)
      html = html.replace("</head>", `<link rel="stylesheet" href="${prefix}${themed.injectCssFile}"></head>`);

    const leftovers = findTokens(html);
    if (leftovers.length > 0)
      return { ok: false, missing: leftovers.map((t) => ({ page_id: b.page.page_id, slot_id: `${t.kind}:${t.key}` })) };

    files[b.output] = new TextEncoder().encode(html);
  }

  return { ok: true, files };
}
```

Note the test asserts the header nav link renders as `href="index.html"` on the root page and the injected stylesheet link carries no prefix there (`relPrefix("index.html") === ""`), while `services/sewer.html` gets `../` prefixes automatically.

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/siteStudioRenderer.test.ts`
Expected: PASS (11 tests).

- [ ] **Step 5: Commit**

```bash
git add lib/site-studio/render/theme.ts lib/site-studio/render/renderer.ts tests/siteStudioRenderer.test.ts
git commit -m "feat(site-studio): pure renderer with completeness refusal and theme application"
```

---

### Task 15: Verification render — the round-trip property

`normalizeHtml` parses and re-serializes with collapsed whitespace, decoded-then-re-encoded text, and attribute order preserved; both sides pass through it, so formatting noise cancels. `verifyTemplate` compares every original page against `renderSite(template, sampleContentDoc(manifest))` output and returns blockers on mismatch. `compileTemplate` gains the verify pass (spec pass 7). The property runs on **both fixtures**.

**Files:**
- Create: `lib/site-studio/compiler/verify.ts`
- Modify: `lib/site-studio/compiler/compile.ts` (add verify pass)
- Test: `tests/siteStudioVerify.test.ts`

- [ ] **Step 1: Write the failing test**

`tests/siteStudioVerify.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { compileTemplate } from "@/lib/site-studio/compiler/compile";
import { normalizeHtml, verifyTemplate } from "@/lib/site-studio/compiler/verify";
import { unzipToMap } from "@/lib/site-studio/zip";
import { fixtureZip } from "./helpers/siteStudioFixtures";
import { manifestSchema } from "@/lib/site-studio/schema";

describe("normalizeHtml", () => {
  it("cancels whitespace and entity formatting differences", () => {
    expect(normalizeHtml("<p>  Hello   &amp; hi </p>")).toBe(normalizeHtml("<p>Hello &#38; hi</p>"));
  });
  it("still distinguishes real content differences", () => {
    expect(normalizeHtml("<p>Hello</p>")).not.toBe(normalizeHtml("<p>Goodbye</p>"));
  });
});

describe("round-trip property: render(compile(zip), samples) ≈ original", () => {
  for (const name of ["plumberpro", "bakery"] as const) {
    it(`${name} round-trips with zero blockers`, () => {
      const result = compileTemplate(fixtureZip(name), name);
      expect(result.ok).toBe(true);
      expect(() => manifestSchema.parse(result.template.manifest)).not.toThrow();
      const blockers = result.diagnostics.filter((d) => d.level === "blocker");
      expect(blockers).toEqual([]);
    });
  }
});

describe("verifyTemplate catches corruption", () => {
  it("a package whose skeleton lost content fails verification", () => {
    const result = compileTemplate(fixtureZip("bakery"), "bakery");
    const broken = {
      ...result.template,
      pages: { ...result.template.pages, "menu.html": result.template.pages["menu.html"].replace("{{slot:", "{{slot:GONE_") },
    };
    const diags = verifyTemplate(broken, unzipToMap(fixtureZip("bakery")));
    expect(diags.some((d) => d.level === "blocker" && d.code === "roundtrip_mismatch")).toBe(true);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/siteStudioVerify.test.ts`
Expected: FAIL — `verify` module not found.

- [ ] **Step 3: Write the implementation**

`lib/site-studio/compiler/verify.ts`:

```ts
import { parse, HTMLElement, NodeType } from "node-html-parser";
import { CompiledTemplate, Diagnostic, FileMap } from "../schema";
import { sampleContentDoc } from "../sample";
import { renderSite } from "../render/renderer";

const decode = (s: string) => parse(`<x>${s}</x>`).firstChild?.text ?? s;

/** Canonical serialization: tags + attributes as-is, text collapsed and entity-decoded. */
export function normalizeHtml(html: string): string {
  const walk = (node: any): string => {
    if (node.nodeType === NodeType.TEXT_NODE) {
      const t = decode(node.rawText).replace(/\s+/g, " ").trim();
      return t.length ? t : "";
    }
    if (node.nodeType !== NodeType.ELEMENT_NODE) return "";
    const el = node as HTMLElement;
    const tag = el.rawTagName?.toLowerCase() ?? "";
    const attrs = Object.entries(el.attributes)
      .map(([k, v]) => `${k}="${decode(v).replace(/\s+/g, " ").trim()}"`)
      .join(" ");
    const inner = el.childNodes.map(walk).filter(Boolean).join("|");
    return `<${tag}${attrs ? " " + attrs : ""}>${inner}</${tag}>`;
  };
  return parse(html).childNodes.map(walk).filter(Boolean).join("|");
}

/** Pass 7: the package must reproduce the original demo site from its own samples. */
export function verifyTemplate(template: CompiledTemplate, original: FileMap): Diagnostic[] {
  const diagnostics: Diagnostic[] = [];
  const rendered = renderSite(template, sampleContentDoc(template.manifest));
  if (!rendered.ok) {
    for (const m of rendered.missing)
      diagnostics.push({ level: "blocker", code: "roundtrip_render_refused", page: m.page_id, message: `Verification render refused: missing ${m.slot_id}` });
    return diagnostics;
  }
  for (const page of template.manifest.pages) {
    const orig = original[page.file];
    const out = rendered.files[page.file];
    if (!orig || !out) {
      diagnostics.push({ level: "blocker", code: "roundtrip_mismatch", page: page.file, message: `${page.file} missing from ${orig ? "render output" : "original"}` });
      continue;
    }
    const a = normalizeHtml(new TextDecoder().decode(orig));
    const b = normalizeHtml(new TextDecoder().decode(out));
    if (a !== b) {
      const at = [...a].findIndex((ch, i) => b[i] !== ch);
      diagnostics.push({
        level: "blocker", code: "roundtrip_mismatch", page: page.file,
        message: `${page.file} does not reproduce the original (first divergence near char ${at}: "${a.slice(Math.max(0, at - 40), at + 40)}" vs "${b.slice(Math.max(0, at - 40), at + 40)}")`,
      });
    }
  }
  return diagnostics;
}
```

Modify `lib/site-studio/compiler/compile.ts` — add the verify pass before the return. Change the import block and the tail of `compileTemplate`:

```ts
import { verifyTemplate } from "./verify";
```

and replace the final `return` with:

```ts
  const template: CompiledTemplate = { manifest, pages, fragments, assets: inv.assets };
  if (!diagnostics.some((d) => d.level === "blocker") && inv.pages.length > 0)
    diagnostics.push(...verifyTemplate(template, files));

  return {
    ok: !diagnostics.some((d) => d.level === "blocker"),
    template,
    diagnostics,
  };
```

where `files` is the unzipped original map — capture it at the top of the function:

```ts
  const files = unzipToMap(zipBytes);
  const inv = inventory(files);
```

(`inventory` already receives this map; reuse the variable rather than unzipping twice.)

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/siteStudioVerify.test.ts tests/siteStudioCompile.test.ts`
Expected: PASS — including both fixture round-trips. Debugging tip: on `roundtrip_mismatch`, the diagnostic message shows the first divergence window; the usual culprits are entity re-encoding (fix in `normalizeHtml`, not the renderer) or a pass mutating structure it shouldn't.

- [ ] **Step 5: Commit**

```bash
git add lib/site-studio/compiler/verify.ts lib/site-studio/compiler/compile.ts tests/siteStudioVerify.test.ts
git commit -m "feat(site-studio): pass 7 verification render - round-trip property on both fixtures"
```

---

### Task 16: Full-suite gate

- [ ] **Step 1: Run the complete test suite**

Run: `npm test`
Expected: every pre-existing test still green plus all new `siteStudio*` files. The old engine's tests must be untouched — this plan never edits `lib/template-engine/`.

- [ ] **Step 2: Typecheck**

Run: `npx tsc --noEmit`
Expected: zero errors.

- [ ] **Step 3: Commit any stragglers and stop**

```bash
git status --short
```

Expected: clean tree (everything committed per-task). Phase 1 is complete: the deterministic core exists, and the spec's central guarantee — compile → render-back ≈ original, on two dissimilar templates — is enforced by CI. **Do not start Phase 2 without its own plan.**

---

## Self-review notes (already applied)

- Spec coverage: Phase 1 delivers spec §3 (package standard incl. internal-link integrity via pass 4b), §4 passes 1–7 (2 and 6 as deterministic subsets, AI halves explicitly deferred to Phase 2 with `warn` diagnostics marking the gaps), §10's renderer purity + testing posture, and the two-fixture dissimilarity lesson. §5–§9, §11–§12 are Phases 2–4 by design.
- Token/type names cross-checked: `slotToken/imgToken/idToken/linkToken`, `repeatMarker/navMarker`, `SlotDef.html`, `RenderResult.missing`, `sampleContentDoc`, `verifyTemplate`, `tokenizeInternalLinks` — consistent across tasks.
- Identity tokens are legal inside samples/values by design (`tokenFree` forbids only structural tokens); title samples therefore carry `{{id:business_name}}` and the renderer resolves identity last.
- Found-and-fixed during review: missing internal-link pass (added 4b), over-strict `tokenFree` contradicting sample docs, stale title assertion, stray interface in the renderer.
- No placeholders: every step carries complete code or an exact command with expected output.
