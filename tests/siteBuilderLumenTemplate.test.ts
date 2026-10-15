// @vitest-environment node
import { createRequire } from "node:module";
import path from "node:path";
import vm from "node:vm";
import { describe, it, expect } from "vitest";
import { collectTemplateFiles, zipTemplateFiles } from "@/scripts/siteTemplate.lib.mjs";
import { unzipToMap } from "@/lib/site-studio/zip";
import { splitPagesAndAssets, type TemplateBundle } from "@/lib/site-builder/templates";
import { findComponentsFile, selectPages } from "@/lib/site-builder/run";
import { parseThemeSlots, applyThemeValues } from "@/lib/site-builder/siteTheme";
import { assignThemeSlots, buildPalette } from "@/lib/site-builder/palette";
import { rewriteFormTargets } from "@/lib/site-builder/formRelay";
import { briefWithPalette, finishFile, planSiteFinish } from "@/lib/site-builder/finish";
import type { BusinessBrief } from "@/lib/site-builder/prompt";

/**
 * The Lumen template (site-builder-templates/lumen) against the Site Builder's
 * own code. A template is not code anyone imports, so the only thing that tells
 * you it still works with the pipeline is running the pipeline's functions over
 * it — which is what this does: the real zip split, the real theme-slot parser
 * and palette, the real form-relay sweep, the real finish step, and the real
 * scripts executed in a DOM.
 *
 * Every assertion here is a promise the template makes to the pipeline; the
 * comments say which part of the pipeline relies on it.
 */

// jsdom ships no type declarations here, so describe the few members used.
interface Dom {
  window: {
    document: Document;
    eval(code: string): unknown;
    addEventListener(type: string, listener: (e: { message: string }) => void): void;
  };
}
const { JSDOM } = createRequire(import.meta.url)("jsdom") as { JSDOM: new (html: string, opts?: Record<string, unknown>) => Dom };

const TEMPLATE_DIR = path.join(process.cwd(), "site-builder-templates", "lumen");
const files = collectTemplateFiles(TEMPLATE_DIR);
const zipped = zipTemplateFiles(files);
// Exactly what the Templates board does with an uploaded zip.
const map = unzipToMap(zipped);
const { pageFiles, assetFiles } = splitPagesAndAssets(map);
const dec = new TextDecoder();
const text = (f: string) => dec.decode(map[f]);

const bundle: TemplateBundle = {
  pages: Object.fromEntries(pageFiles.map((f) => [f, text(f)])),
  assets: Object.fromEntries(assetFiles.map((f) => [f, map[f]])),
  pageFiles,
  assetFiles,
};

const EXPECTED_PAGES = ["about.html", "contact.html", "gallery.html", "index.html", "service-areas.html", "services.html"];
const COMPONENTS = text("components.js");
const SCRIPT = text("script.js");
const STYLE = text("style.css");

describe("packaging", () => {
  it("ships six pages and keeps everything else as assets", () => {
    expect(pageFiles).toEqual(EXPECTED_PAGES);
    for (const f of ["components.js", "script.js", "style.css", "fonts/inter.woff2", "fonts/plus-jakarta-sans.woff2"]) {
      expect(assetFiles).toContain(f);
    }
    expect(assetFiles.some((f) => /readme/i.test(f))).toBe(false);
  });

  it("zips reproducibly and stays far under the 25MB upload limit", () => {
    expect(Buffer.compare(Buffer.from(zipTemplateFiles(files)), Buffer.from(zipped))).toBe(0);
    expect(zipped.length).toBeLessThan(2 * 1024 * 1024);
  });

  it("is found by the pipeline's components-file convention", () => {
    expect(findComponentsFile(bundle)?.file).toBe("components.js");
  });

  it("matches the page names leads actually ask for, without designing pages it already has", () => {
    const plan = selectPages(pageFiles, ["Home", "About Us", "Our Services", "Gallery", "Service Areas", "Contact Us"]);
    expect(plan.newPages).toEqual([]);
    expect([...plan.existing].sort()).toEqual(EXPECTED_PAGES);
    // A page the template lacks is designed from its pages, not forced onto one of them.
    expect(selectPages(pageFiles, ["Reviews"]).newPages.map((p) => p.name)).toEqual(["Reviews"]);
  });
});

describe("site theme (palette.ts / siteTheme.ts / finish.ts)", () => {
  it("marks exactly the three base colours the whole palette derives from", () => {
    expect(parseThemeSlots(COMPONENTS).map((s) => [s.name, s.marker])).toEqual([
      ["--brand", "PRIMARY"],
      ["--accent", "ACCENT"],
      ["--ink-deep", "DARK"],
    ]);
  });

  it("takes a lead's colours, idempotently, and stays valid JavaScript", () => {
    const slots = parseThemeSlots(COMPONENTS);
    const palette = buildPalette("#0C5AA0, #F24F24")!;
    const values = assignThemeSlots(slots, palette);
    expect(values["--brand"]).toBe("#0c5aa0");
    expect(values["--accent"]).toBe("#f24f24");
    const once = applyThemeValues(COMPONENTS, values, slots);
    expect(once).toContain("--brand: #0c5aa0;");
    expect(applyThemeValues(once, values, slots)).toBe(once);
    expect(() => new vm.Script(once)).not.toThrow();
  });

  it("never hard-codes a brand colour in the stylesheet — only the three fallbacks and status colours", () => {
    // Anything else would survive a re-colour. #fff/#000 are neutral; #166534 / #b91c1c are
    // the success/error text colours; the other three are the SITE THEME fallbacks.
    const allowed = new Set(["#fff", "#000", "#0f766e", "#f59e0b", "#0b1d26", "#166534", "#b91c1c"]);
    const found = new Set((STYLE.match(/#[0-9a-fA-F]{3,8}\b/g) ?? []).map((h) => h.toLowerCase()));
    expect([...found].filter((h) => !allowed.has(h))).toEqual([]);
  });

  it("puts every rule in a cascade layer, so the injected theme always wins", () => {
    expect(STYLE).toMatch(/@layer reset, tokens, base, layout, components, sections, motion;/);
  });

  it("gets the contrast guard and the big-logo stylesheet like any other page", () => {
    const brief: BusinessBrief = { business_name: "Harbor Light", services: [], service_areas: [], color_scheme: "navy, orange", logo: "https://i.ibb.co/x/logo.png" };
    const finish = planSiteFinish(brief, findComponentsFile(bundle));
    const out = finishFile("index.html", text("index.html"), finish);
    expect(out).toContain("sb-contrast-guard");
    expect(out).toContain("sb-logo-size");
    expect(briefWithPalette(brief, finish).theme_set).toBe(true);
  });
});

describe("forms (formRelay.ts)", () => {
  const forms = pageFiles.flatMap((f) => [...text(f).matchAll(/<form\b[\s\S]*?<\/form>/gi)].map((m) => ({ file: f, html: m[0] })));

  it("has a contact form to relay", () => {
    expect(forms.map((f) => f.file)).toEqual(["contact.html"]);
  });

  it("has the shape the relay and the sweep expect", () => {
    for (const { html } of forms) {
      expect(html).toContain('action="https://api.web3forms.com/submit"');
      expect(html).toMatch(/<input[^>]*name="access_key"[^>]*value="[^"]+"/);
      expect(html).toMatch(/<input[^>]*name="botcheck"/); // the honeypot
      expect(html).toContain("data-sb-form"); // script.js posts it as JSON
      expect(html).toMatch(/name="name"[^>]*required|required[^>]*name="name"/);
      expect(html).toMatch(/name="email"/); // the relay reads the submitter from name/email
    }
  });

  it("leaves no trace of the template's destination after the sweep", () => {
    const target = { submit_url: "https://relay.example/api/forms/submit", access_key: "KEY-123" };
    const swept = rewriteFormTargets(text("contact.html"), target);
    expect(swept).toContain('action="https://relay.example/api/forms/submit"');
    expect(swept).toContain('value="KEY-123"');
    expect(swept).not.toMatch(/web3forms|YOUR_ACCESS_KEY_HERE/);
  });

  it("keeps the access key and destination out of the scripts, so the sweep has nothing to miss", () => {
    for (const f of ["script.js", "components.js"]) expect(text(f)).not.toMatch(/web3forms|access_key/);
  });
});

describe("a static site that runs under the preview's CSP and on any host", () => {
  const attr = /\b(?:href|src|action)=["']([^"']+)["']/gi;
  const refs = (html: string) => [...html.matchAll(attr)].map((m) => m[1]);

  it("loads no external scripts or stylesheets (preview CSP allows 'self' and inline only)", () => {
    for (const f of pageFiles) {
      expect(text(f), f).not.toMatch(/<script[^>]+src=["']https?:/i);
      expect(text(f), f).not.toMatch(/<link[^>]+href=["']https?:/i);
    }
    expect(STYLE).not.toMatch(/@import|url\(["']?https?:/);
  });

  it("talks to only two outside hosts: the form relay and the map embed", () => {
    for (const f of pageFiles) {
      for (const ref of refs(text(f)).filter((r) => /^https?:/i.test(r))) {
        expect(ref, f).toMatch(/^https:\/\/(api\.web3forms\.com\/submit$|www\.google\.com\/maps\?)/);
      }
    }
  });

  it("only references files that exist in the zip", () => {
    for (const f of pageFiles) {
      for (const ref of refs(text(f))) {
        if (/^(https?:|mailto:|tel:|#|data:)/i.test(ref)) continue;
        expect(map[ref.split(/[?#]/)[0]], `${f} -> ${ref}`).toBeDefined();
      }
    }
    for (const m of STYLE.matchAll(/url\(["']?([^)"']+)["']?\)/g)) expect(map[m[1]], `style.css -> ${m[1]}`).toBeDefined();
  });

  it("has a first-class, accessible document on every page", () => {
    for (const f of pageFiles) {
      const html = text(f);
      expect(html, f).toMatch(/<html lang="[a-z-]+"/);
      expect(html.match(/<h1\b/g)?.length, f).toBe(1);
      expect(html, f).toContain('<main id="main">');
      expect(html, f).toMatch(/<meta name="viewport" content="width=device-width, initial-scale=1">/);
      expect(html, f).toMatch(/<title>[^<]+<\/title>/);
      expect(html, f).toMatch(/<meta name="description" content="[^"]+">/);
      // Stylesheet first so the SITE THEME appended by components.js lands after it.
      expect(html.indexOf('href="style.css"'), f).toBeGreaterThan(-1);
      expect(html.indexOf('href="style.css"'), f).toBeLessThan(html.indexOf('src="components.js"'));
      expect(html.indexOf('src="components.js"'), f).toBeLessThan(html.indexOf('src="script.js"'));
      for (const img of html.match(/<img\b[^>]*>/g) ?? []) {
        expect(img, `${f}: ${img}`).toMatch(/\balt="[^"]*"/);
        expect(img, `${f}: ${img}`).toMatch(/\bwidth="\d+"[^>]*\bheight="\d+"/); // no layout shift
      }
      for (const frame of html.match(/<iframe\b[^>]*>/g) ?? []) expect(frame, f).toMatch(/\btitle="[^"]+"/);
      const ids = [...html.matchAll(/\sid="([^"]+)"/g)].map((m) => m[1]);
      expect(new Set(ids).size, `${f} duplicate ids`).toBe(ids.length);
    }
  });
});

describe("fits the Site Builder's prompts and rules", () => {
  it("keeps pages lean (the AI rewrites each one in a single reply) and components.js small (it is shown in every page prompt)", () => {
    for (const f of pageFiles) expect(map[f].length, f).toBeLessThan(24_000);
    expect(map["components.js"].length).toBeLessThan(14_000);
  });

  it("makes no claim a business would be held to — the AI is told never to invent them", () => {
    const claims = /\b(licen[sc]ed|insured|bonded|certified|accredited|award[- ]winning|guarantee[ds]?|warranty|top[- ]rated|five[- ]star|5[- ]star|best in|#1|24\/7|same[- ]day|free (estimate|quote|consultation))\b/i;
    for (const f of [...pageFiles, "components.js"]) expect(text(f), f).not.toMatch(claims);
  });

  it("attributes no testimonial to a named person", () => {
    for (const m of text("index.html").matchAll(/<cite>([^<]*)<\/cite>/g)) expect(m[1]).toBe("Local customer");
  });

  it("lists the icon names the AI may use, and every name the pages use exists", () => {
    const names = [...SCRIPT.matchAll(/^\s{2,4}"?([a-z0-9-]+)"?: '</gm)].map((m) => m[1]);
    const defined = new Set(names);
    expect(defined.size).toBeGreaterThan(50);
    // A repeated key silently overwrites the earlier icon (a brand glyph once replaced "x", the close cross).
    expect(names.filter((n, i) => names.indexOf(n) !== i)).toEqual([]);
    const code = (src: string) => src.replace(/\/\*[\s\S]*?\*\//g, ""); // not the usage example in the header comment
    const used = new Set(
      [...pageFiles.map(text), COMPONENTS].flatMap((src) => [...code(src).matchAll(/data-i="([a-z0-9-]+)"/g)].map((m) => m[1])),
    );
    for (const mapped of ["facebook", "instagram", "x-twitter", "music", "globe"]) expect(defined).toContain(mapped);
    expect([...used].filter((n) => !defined.has(n))).toEqual([]);
    const documented = COMPONENTS.slice(0, COMPONENTS.indexOf("SITE THEME"));
    for (const name of ["phone", "mail", "map-pin", "wrench", "leaf", "facebook", "instagram"]) expect(documented).toContain(name);
  });
});

// ---- the real scripts, in a DOM ---------------------------------------------------------------

function boot(page: string, opts: { source?: (src: string) => string; url?: string } = {}) {
  const html = text(page).replace(/<script\b[^>]*\bsrc=[^>]*><\/script>/g, "");
  const dom = new JSDOM(html, { url: opts.url ?? `https://site.example/${page}`, runScripts: "outside-only", pretendToBeVisual: true });
  const errors: string[] = [];
  dom.window.addEventListener("error", (e: { message: string }) => errors.push(e.message));
  dom.window.eval(opts.source ? opts.source(COMPONENTS) : COMPONENTS);
  dom.window.eval(SCRIPT);
  return { dom, doc: dom.window.document, errors };
}

describe("the shared components and behaviour, run for real", () => {
  it("renders the header, footer, call-to-action and quick bar on every page, with every icon drawn", () => {
    for (const f of pageFiles) {
      const { doc, errors } = boot(f);
      expect(errors, f).toEqual([]);
      expect(doc.getElementById("site-header"), f).not.toBeNull();
      expect(doc.getElementById("nav-toggle"), f).not.toBeNull(); // script.js looks these ids up
      expect(doc.getElementById("site-nav"), f).not.toBeNull();
      expect(doc.querySelectorAll("#site-nav a").length, f).toBe(6);
      expect(doc.querySelector(".site-footer"), f).not.toBeNull();
      expect(doc.querySelector(".mobile-bar"), f).not.toBeNull();
      expect(doc.querySelector(".cta-card") !== null, f).toBe(f !== "contact.html");
      expect(doc.querySelectorAll("i[data-i]:not([data-drawn])").length, f).toBe(0);
      expect(doc.getElementById("site-theme")?.textContent, f).toContain("--brand");
      expect(doc.documentElement.classList.contains("js"), f).toBe(true);
    }
  });

  it("links its navigation only to pages that exist, and marks the current one", () => {
    const { doc } = boot("about.html");
    const hrefs = [...doc.querySelectorAll("#site-nav a")].map((a) => a.getAttribute("href")!);
    for (const h of hrefs) expect(pageFiles).toContain(h);
    expect(doc.querySelector("#site-nav a[aria-current='page']")?.getAttribute("href")).toBe("about.html");
  });

  it("shows a supplied logo big, and hides the wordmark instead of deleting it", () => {
    const { doc, errors } = boot("index.html", { source: (s) => s.replace('logo: ""', 'logo: "https://i.ibb.co/abc/logo.png"') });
    expect(errors).toEqual([]);
    const header = doc.querySelector("#site-header img.brand__logo") as HTMLImageElement;
    expect(header.src).toBe("https://i.ibb.co/abc/logo.png");
    expect(header.alt).toBe("Ridgeline Home Services");
    expect(parseInt(/height:\s*(\d+)px/.exec(header.getAttribute("style")!)![1], 10)).toBeGreaterThanOrEqual(56);
    const name = doc.getElementById("brand-name") as HTMLElement; // template scripts look this up by id
    expect(name).not.toBeNull();
    expect(name.style.display).toBe("none");
    expect(doc.querySelector(".site-footer img.brand__logo")).not.toBeNull();
    expect(doc.getElementById("brand-mark")).toBeNull();
  });

  it("leaves out whatever the business does not have — no phone, email, socials or area — without errors", () => {
    const { doc, errors } = boot("index.html", {
      source: (s) =>
        s
          .replace('phone: "(555) 010-0123"', 'phone: ""')
          .replace('email: "hello@ridgelinehome.example"', 'email: ""')
          .replace('area: "Lakeside and nearby"', 'area: ""')
          .replace(/social: \[[\s\S]*?\n {2}\]/, "social: []"),
    });
    expect(errors).toEqual([]);
    const shared = ["#site-header", ".topbar", ".site-footer", ".mobile-bar", ".cta-card"].map((s) => doc.querySelector(s)?.outerHTML ?? "").join("");
    expect(shared).not.toMatch(/href="tel:|href="mailto:|class="social"/);
    expect(shared).not.toMatch(/undefined|null|\[object/);
    expect(doc.querySelector(".topbar")).toBeNull(); // nothing to show, so no empty bar
  });

  it("escapes the business name wherever it is rendered", () => {
    const { doc } = boot("index.html", { source: (s) => s.replace('name: "Ridgeline Home Services"', 'name: "Smith & Sons <b>Roofing</b>"') });
    expect(doc.querySelector("#brand-name")!.textContent).toBe("Smith & Sons <b>Roofing</b>");
    expect(doc.querySelector("#site-header b")).toBeNull();
  });

  it("falls back to a dot for an icon name it does not know, never a blank gap", () => {
    const dom = new JSDOM('<!doctype html><body><i data-i="not-a-real-icon"></i></body>', { runScripts: "outside-only", pretendToBeVisual: true });
    dom.window.eval(SCRIPT);
    expect(dom.window.document.querySelector("i svg circle")).not.toBeNull();
  });

  it("survives a page with none of the elements it looks for", () => {
    // Pages are rewritten per business and elements get removed. A throw here would stop every
    // behaviour on the site, which is why script.js guards every lookup.
    const dom = new JSDOM("<!doctype html><html><body><p>Just text</p></body></html>", { runScripts: "outside-only", pretendToBeVisual: true });
    const errors: string[] = [];
    dom.window.addEventListener("error", (e: { message: string }) => errors.push(e.message));
    expect(() => dom.window.eval(SCRIPT)).not.toThrow();
    expect(errors).toEqual([]);
  });
});
