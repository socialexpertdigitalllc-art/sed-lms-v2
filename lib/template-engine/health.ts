// Template Engine v2 — the upload-time template health check.
//
// WHY THIS EXISTS. Three separate bugs reached production because logic written
// against the ORIGINAL template silently did nothing on a newly uploaded one,
// and nobody found out until a real client's site was wrong:
//
//   1. A poison demo token. Extraction emitted `King`; the leak gate matched it
//      inside "wor-King-", so every generation with that template failed the
//      gate and no amount of AI repair could pass it.
//   2. Colours never applied. `themeCss` bound `--brand/--brand-deep/--accent`;
//      a template exposing `--primary` got an override that bound nothing, and
//      the client's site shipped in the demo palette.
//   3. Logo missing, menu 404s. The template had no `<img>` slot in its header,
//      and its nav linked to pages the lead never ordered.
//
// Every one of those was invisible until generation time — after AI credits had
// been spent, and often after a site had been reviewed. This module surfaces
// them AT UPLOAD, deterministically and for free.
//
// The rules that keep it useful:
//   - PURE. No I/O, no AI, no network, no clock beyond an injectable `now`. A
//     check that can fail for environmental reasons is a check people learn to
//     skip, and this one runs on the operator's upload path.
//   - It reuses the REAL production code paths (findLeaks, planThemeApplication,
//     applyLogoToHtml, pruneNavToBuiltPages, htmlSkeleton). A health check that
//     reimplements the thing it is checking drifts away from it and starts
//     lying. Every check below asks the actual module "what would you do with
//     this template?" and reports the answer.
//   - It never blocks the upload. An operator may be uploading a work in
//     progress, and a blocked upload with no way to inspect the reason is worse
//     than a flagged one. Severity is advisory; the caller decides.
//
// `fail` vs `warn` is drawn on one line: FAIL means every generation with this
// template is broken in a way the operator cannot fix from inside the run (an
// unpassable gate, colours that bind nothing, a 404 baked into the markup).
// WARN means the site still builds, but a feature quietly degrades (no logo, a
// stale menu entry, a page with nothing to curate images into).

import { findLeaks } from "./demoTokens";
import { planThemeApplication } from "./themeCss";
import { applyLogoToHtml, PARSE_OPTIONS } from "./logo";
import { internalPageTarget, pruneNavToBuiltPages } from "./nav";
import { htmlSkeleton, jsIdentifiers } from "./structure";
import type { TemplateManifest } from "./types";
import { parse } from "node-html-parser";

export type HealthSeverity = "pass" | "warn" | "fail";

export interface HealthCheck {
  /** stable id — the UI and any future tooling key off this, never the label */
  id: string;
  label: string;
  severity: HealthSeverity;
  /** what was actually found in THIS template */
  detail: string;
  /** one actionable sentence aimed at whoever prepares templates */
  hint: string;
}

export interface HealthReport {
  status: HealthSeverity;
  checks: HealthCheck[];
  checkedAt: string;
}

export interface HealthInput {
  /** template-relative path -> text content. HTML, CSS and JS; binaries excluded. */
  files: Record<string, string>;
  /** the tokens `extractDemoTokens` derived from this template */
  demoTokens: string[];
  manifest?: TemplateManifest | null;
  /** injectable clock, so the report is reproducible in tests */
  now?: string;
}

// ---------------------------------------------------------------------------
// The ordinary-copy corpus
// ---------------------------------------------------------------------------

/**
 * A few hundred words of the prose a CORRECTLY generated site is expected to
 * contain: typical home-services marketing copy, plus the vocabulary of trades,
 * places and calls to action that every client site in this market uses.
 *
 * This is the whole trick of the poison-token check. A demo token is only
 * useful if a correct build can avoid it. Rather than guess which tokens are
 * "too generic" with another word list — the approach that already failed, since
 * `King` was in nobody's list until it broke production — we run the REAL leak
 * gate against copy we know is innocent. Any token that fires here would fire
 * on a real client's site too, and would therefore fail every build for this
 * template, unfixably.
 *
 * Deliberately contains NO proper place names. Demo geography ("Denver",
 * "Cherry Creek") is the highest-value thing the leak gate catches, and seeding
 * this corpus with real city names would report those valuable tokens as
 * poison. What it carries instead is the vocabulary ABOUT places — city,
 * county, neighborhood, metro, township — which is what legitimate copy uses.
 */
export const ORDINARY_COPY_CORPUS: Record<string, string> = {
  "corpus/home.html": `
    <h1>Trusted home services for your property, inside and out</h1>
    <p>We are a family owned and operated company serving homeowners across the
    city and the wider metro area. Every job starts with a free estimate and a
    clear written quote, so you know the cost before any work begins. Our
    licensed and insured team has spent years working in homes like yours, and
    we treat every property as if it were our own.</p>
    <p>From a small repair to a full renovation, our craftsmen bring the same
    care to each project. We open up a cramped galley kitchen, turn a spare room
    into a main suite big enough for a king size bed and a walk in closet, and
    finish a basement so the whole family can use it. We handle kitchen and
    bathroom remodeling, flooring,
    tile, drywall, painting, roofing, siding, gutters, windows and doors,
    fencing, decks, concrete and paving, plumbing, electrical, heating and
    cooling. Whatever the room, we build it to last and we clean up after
    ourselves before we leave.</p>
    <p>Our process is simple. Call us or book online, and one of our specialists
    will visit your home at a time that suits your schedule. We walk the space
    with you, talk through the design options, and put together a detailed plan
    with real prices and a realistic timeline. Once you approve, our crew gets
    started, and a project manager keeps you updated every step of the way.</p>
    <p>Customers choose us for quality workmanship, honest pricing, and the kind
    of reliable service that is getting harder to find. We are proud of our
    five star reviews and the neighbors who keep calling us back and recommending
    us to their friends and family. Booking with us is easy, and financing is
    available on larger projects.</p>
  `,
  "corpus/services.html": `
    <h2>Comfort, safety and value for every home</h2>
    <p>Our residential and commercial services cover the whole property. We are
    working in the county and the surrounding townships six days a week, and
    emergency call outs are available around the clock. Response times are fast,
    the workmanship is guaranteed, and every installation comes with a written
    warranty.</p>
    <p>We keep your home comfortable in every season, from an efficient furnace
    tune up before winter to a full air conditioning replacement in the summer.
    Our plumbers clear drains, replace water heaters and fix leaks before they
    become expensive damage. Our electricians upgrade panels, add outlets and
    install modern lighting. Our roofers inspect storm damage, replace shingles
    and keep the water out.</p>
    <p>Outside, our landscaping and lawn crews handle design, planting, patios,
    retaining walls and seasonal cleanups. We build decks and fences, pour
    driveways, power wash siding and restore old surfaces to a like new finish.</p>
    <p>Talk to our team today. Get your free consultation, ask for a quote, and
    find out why so many local clients trust us with their most valuable asset.
    Serving the surrounding area and nearby suburbs, we are only a phone call
    away. Contact us to schedule an appointment this week.</p>
  `,
  "corpus/vocabulary.txt": `
    city county town township village borough district neighborhood suburb metro
    downtown uptown region area areas zone parish precinct community street road
    avenue boulevard lane drive court place square park hills valley view heights
    north south east west central greater surrounding nearby local nationwide
    contractor builder handyman technician crew foreman apprentice tradesman
    remodel renovation restoration installation maintenance inspection estimate
    consultation appointment schedule warranty guarantee financing affordable
    professional certified accredited award winning experienced dependable
    responsive courteous punctual thorough meticulous detailed transparent
    residential commercial industrial interior exterior indoor outdoor upgrade
    modern classic traditional contemporary custom bespoke premium quality value
    testimonial review rating referral portfolio gallery project case study
    emergency same day next day weekend evening seasonal annual monthly
  `,
};

// ---------------------------------------------------------------------------
// helpers
// ---------------------------------------------------------------------------

const HTML_RE = /\.html?$/i;
const CSS_RE = /\.css$/i;
const JS_RE = /\.m?js$/i;

const normPath = (p: string) => p.replace(/\\/g, "/").replace(/^\.?\//, "").toLowerCase();
const baseName = (p: string) => normPath(p).split("/").pop() ?? "";

const check = (
  id: string,
  label: string,
  severity: HealthSeverity,
  detail: string,
  hint: string
): HealthCheck => ({ id, label, severity, detail, hint });

/** Worst severity wins: one fail makes the whole template a fail. */
const RANK: Record<HealthSeverity, number> = { pass: 0, warn: 1, fail: 2 };
function worst(checks: HealthCheck[]): HealthSeverity {
  return checks.reduce<HealthSeverity>((acc, c) => (RANK[c.severity] > RANK[acc] ? c.severity : acc), "pass");
}

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
const list = (xs: string[], max = 6) =>
  xs.slice(0, max).join(", ") + (xs.length > max ? `, +${xs.length - max} more` : "");

function pagesOf(files: Record<string, string>): string[] {
  return Object.keys(files).filter((f) => HTML_RE.test(f)).sort();
}

// ---------------------------------------------------------------------------
// 1. demo_tokens_poison — the check that would have caught `King`
// ---------------------------------------------------------------------------

function checkPoisonTokens(demoTokens: string[]): HealthCheck {
  const id = "demo_tokens_poison";
  const label = "Demo tokens are safe to gate on";

  if (demoTokens.length === 0) {
    return check(
      id,
      label,
      "warn",
      "No demo tokens were extracted from this template, so the post-build leak gate has nothing to look for.",
      "Make sure the template's demo business has a real name in its <title> tags and a demo phone/email in its markup — that is what the leak gate learns from."
    );
  }

  // The real gate, run against copy a correct build is expected to produce.
  const leaks = findLeaks(ORDINARY_COPY_CORPUS, demoTokens);
  const poisoned = [...new Set(leaks.map((l) => l.token))];

  if (poisoned.length > 0) {
    return check(
      id,
      label,
      "fail",
      `${plural(poisoned.length, "demo token")} match ordinary business copy: ${list(poisoned)}. ` +
        `Every generation from this template will fail the leak gate on ${poisoned.length === 1 ? "it" : "them"}, ` +
        `and no amount of AI repair can fix copy that must avoid an ordinary English word.`,
      "Rename the demo business so its name isn't an ordinary English word — an invented, distinctive wordmark (\"Northpoint\", \"Vantara\") is what makes the leak gate both safe and passable."
    );
  }

  return check(
    id,
    label,
    "pass",
    `${plural(demoTokens.length, "demo token")} extracted, none of which appear in ordinary business copy: ${list(demoTokens)}.`,
    "Nothing to do — the leak gate can tell this template's demo identity apart from a real client's copy."
  );
}

// ---------------------------------------------------------------------------
// 2. theme_applicable — the check for "the client's colours did nothing"
// ---------------------------------------------------------------------------

/** Distinctive sample colours; only used to ask the planner what it WOULD bind. */
const SAMPLE_THEME = { brand: "#1d4ed8", brand_deep: "#0f2f7a", accent: "#f59e0b" };

function checkThemeApplicable(files: Record<string, string>): HealthCheck {
  const id = "theme_applicable";
  const label = "Client colours can be applied";
  const hintFail =
    "Expose your palette as CSS custom properties on :root (e.g. --primary, --primary-dark, --accent) and use them via var() throughout the stylesheet — that is what the client's colours bind onto.";

  const sheets = Object.keys(files).filter((f) => CSS_RE.test(f)).sort();
  if (sheets.length === 0) {
    return check(
      id,
      label,
      "fail",
      "This template has no stylesheet, so there is nothing for the client's brand colours to be applied to.",
      hintFail
    );
  }

  const boundVars: string[] = [];
  const remapped: string[] = [];
  for (const sheet of sheets) {
    const plan = planThemeApplication(files[sheet], SAMPLE_THEME);
    if (plan.strategy === "vars") boundVars.push(...plan.boundVars);
    else if (plan.strategy === "hex") remapped.push(...Object.keys(plan.replacements));
  }

  if (boundVars.length > 0) {
    return check(
      id,
      label,
      "pass",
      `Colours bind onto this template's own custom ${plural(boundVars.length, "property", "properties")}: ${list([...new Set(boundVars)])}.`,
      "Nothing to do — a client's palette will reach the page through these variables."
    );
  }
  if (remapped.length > 0) {
    return check(
      id,
      label,
      "pass",
      `No usable colour custom properties, so the client's colours are applied by rewriting this template's dominant hex values: ${list([...new Set(remapped)])}.`,
      "Works as is, but declaring the palette as :root custom properties is more precise than remapping raw hex values."
    );
  }

  return check(
    id,
    label,
    "fail",
    `Neither a variable binding nor a hex remap could be planned for ${plural(sheets.length, "stylesheet")} (${list(sheets)}). ` +
      "The client's chosen colours will silently never appear — the site ships in this template's own palette.",
    hintFail
  );
}

// ---------------------------------------------------------------------------
// 3. logo_slot
// ---------------------------------------------------------------------------

const SAMPLE_LOGO = { logoUrl: "https://example.com/client-logo.png", businessName: "Sample Client" };
/** The marker applyLogoToHtml puts on an <img> it had to insert itself. */
const INSERTED_MARKER = 'class="tev2-logo"';

function checkLogoSlot(files: Record<string, string>): HealthCheck {
  const id = "logo_slot";
  const label = "Header has a logo slot";
  const pages = pagesOf(files);

  if (pages.length === 0) {
    return check(id, label, "warn", "This template has no HTML pages to check.", "Upload a template that contains at least one .html page.");
  }

  const missing: string[] = [];
  const inserted: string[] = [];
  const existing: string[] = [];
  for (const page of pages) {
    const res = applyLogoToHtml(files[page], SAMPLE_LOGO);
    if (!res.header) missing.push(page);
    else if (res.html.includes(INSERTED_MARKER)) inserted.push(page);
    else existing.push(page);
  }

  if (missing.length > 0) {
    return check(
      id,
      label,
      "warn",
      `No header or brand area could be found on ${plural(missing.length, "page")} (${list(missing)}), so the client's logo will not render there.`,
      "Give the header a recognisable brand wrapper — a <header> containing an element with class \"logo\" or \"brand\" — so the logo has somewhere to go."
    );
  }
  const detail =
    existing.length > 0 && inserted.length === 0
      ? `Every page already has an <img> in its header brand area (${plural(pages.length, "page")}).`
      : inserted.length > 0 && existing.length === 0
        ? `No page has an <img> slot, so one will be inserted into the header brand area of all ${plural(pages.length, "page")}.`
        : `${plural(existing.length, "page")} already have a header <img>; an <img> will be inserted on ${plural(inserted.length, "page")} (${list(inserted)}).`;
  return check(id, label, "pass", detail, "Nothing to do — the client's logo has a home in the header of every page.");
}

// ---------------------------------------------------------------------------
// 4. nav_prunable
// ---------------------------------------------------------------------------

/** Every internal page target an anchor on this page points at. */
function internalTargets(html: string): string[] {
  const root = parse(html, PARSE_OPTIONS);
  const out: string[] = [];
  for (const a of root.querySelectorAll("a")) {
    const target = internalPageTarget(a.getAttribute("href"));
    if (target) out.push(target);
  }
  return out;
}

function checkNavPrunable(files: Record<string, string>): HealthCheck {
  const id = "nav_prunable";
  const label = "Menu links can be pruned";
  const pages = pagesOf(files);
  const orphans: string[] = [];
  let linked = 0;

  for (const page of pages) {
    if (internalTargets(files[page]).length === 0) continue;
    linked++;
    // Pruning against an empty built-page set dooms every internal link, so if a
    // menu ancestor exists anywhere on the page, one of these two lists is
    // non-empty. Both empty means the links sit outside any detectable menu.
    const pruned = pruneNavToBuiltPages(files[page], []);
    if (pruned.removed.length === 0 && pruned.keptEmptyGuard.length === 0) orphans.push(page);
  }

  if (linked === 0) {
    return check(
      id,
      label,
      "warn",
      "No page links to another page in this template, so there is no menu to prune.",
      "Add a <nav> menu linking the template's pages to each other — without one, visitors can only reach the home page."
    );
  }
  if (orphans.length > 0) {
    return check(
      id,
      label,
      "warn",
      `Internal page links on ${plural(orphans.length, "page")} (${list(orphans)}) sit outside any detectable menu, ` +
        "so links to pages the client never ordered cannot be pruned and will 404.",
      "Wrap the site menu in a <nav> element (or give its container a \"nav\"/\"menu\" class) so unbuilt pages can be removed from it."
    );
  }
  return check(
    id,
    label,
    "pass",
    `Internal page links on all ${plural(linked, "page")} sit inside a detectable menu and can be pruned to the pages the client ordered.`,
    "Nothing to do — a partial page order will not leave dead menu entries."
  );
}

// ---------------------------------------------------------------------------
// 5. links_resolve
// ---------------------------------------------------------------------------

function checkLinksResolve(files: Record<string, string>, manifest?: TemplateManifest | null): HealthCheck {
  const id = "links_resolve";
  const label = "Every link and manifest page exists";

  // Match on the full normalized path OR the bare filename, so "about.html",
  // "./about.html" and "pages/about.html" all resolve against the same file.
  const byPath = new Set<string>();
  const byName = new Set<string>();
  for (const f of Object.keys(files)) {
    byPath.add(normPath(f));
    byName.add(baseName(f));
  }
  const resolves = (target: string) => byPath.has(normPath(target)) || byName.has(baseName(target));

  const dangling = new Map<string, Set<string>>(); // target -> pages linking to it
  for (const page of pagesOf(files)) {
    for (const target of internalTargets(files[page])) {
      if (resolves(target)) continue;
      const from = dangling.get(target) ?? new Set<string>();
      from.add(page);
      dangling.set(target, from);
    }
  }

  const missingManifest = (manifest?.pages ?? [])
    .map((p) => p.file)
    .filter((f) => typeof f === "string" && f.length > 0 && !resolves(f));

  const parts: string[] = [];
  if (dangling.size > 0) {
    parts.push(
      `${plural(dangling.size, "link target")} do not exist in the template: ` +
        list([...dangling].map(([t, from]) => `${t} (from ${list([...from], 2)})`))
    );
  }
  if (missingManifest.length > 0) {
    parts.push(`${plural(missingManifest.length, "manifest page")} have no file: ${list(missingManifest)}`);
  }

  if (parts.length > 0) {
    return check(
      id,
      label,
      "fail",
      `${parts.join("; ")}. These 404 even when every page the client ordered is built.`,
      "Fix or remove the dangling links — every href ending in .html must point at a page the zip actually contains."
    );
  }
  return check(
    id,
    label,
    "pass",
    "Every internal .html link and every manifest page resolves to a file in this template.",
    "Nothing to do — no baked-in 404s."
  );
}

// ---------------------------------------------------------------------------
// 6. image_slots
// ---------------------------------------------------------------------------

function checkImageSlots(files: Record<string, string>): HealthCheck {
  const id = "image_slots";
  const label = "Pages have image slots";
  const pages = pagesOf(files);
  const empty: string[] = [];
  let total = 0;

  for (const page of pages) {
    const n = parse(files[page], PARSE_OPTIONS).querySelectorAll("img").length;
    total += n;
    if (n === 0) empty.push(page);
  }

  if (pages.length === 0) {
    return check(id, label, "warn", "This template has no HTML pages to check.", "Upload a template that contains at least one .html page.");
  }
  if (empty.length > 0) {
    return check(
      id,
      label,
      "warn",
      `${plural(empty.length, "page")} contain no <img> element (${list(empty)}), so image curation has nothing to fill there.`,
      "Add <img> elements where the page should show photography — curated client and stock images can only replace images that already exist."
    );
  }
  return check(
    id,
    label,
    "pass",
    `${plural(total, "image slot")} across ${plural(pages.length, "page")}; every page has at least one.`,
    "Nothing to do — curated photography has somewhere to land on every page."
  );
}

// ---------------------------------------------------------------------------
// 7. structure_parsable
// ---------------------------------------------------------------------------

function checkStructureParsable(files: Record<string, string>): HealthCheck {
  const id = "structure_parsable";
  const label = "Structure fingerprint can be computed";
  const broken: string[] = [];
  let checked = 0;

  for (const [file, content] of Object.entries(files)) {
    if (HTML_RE.test(file)) {
      checked++;
      try {
        parse(content, PARSE_OPTIONS);
        const skel = htmlSkeleton(content);
        // No tags at all means the structure gate has no baseline to compare
        // against, so it would wave every regeneration of this file through.
        if (Object.keys(skel.tags).length === 0) broken.push(`${file} (no HTML elements found)`);
      } catch (e) {
        broken.push(`${file} (${e instanceof Error ? e.message : "parse failed"})`);
      }
    } else if (JS_RE.test(file)) {
      checked++;
      try {
        jsIdentifiers(content);
      } catch (e) {
        broken.push(`${file} (${e instanceof Error ? e.message : "scan failed"})`);
      }
    }
  }

  if (checked === 0) {
    return check(
      id,
      label,
      "fail",
      "This template has no HTML or JS content files, so there is nothing to fingerprint.",
      "Upload a template zip containing the site's .html pages and its .js files."
    );
  }
  if (broken.length > 0) {
    return check(
      id,
      label,
      "fail",
      `A structure fingerprint could not be computed for ${plural(broken.length, "file")}: ${list(broken)}. ` +
        `The structure gate would misbehave on ${broken.length === 1 ? "it" : "them"}, letting the AI silently break the design.`,
      "Fix the malformed markup — every page must be well-formed HTML with real elements before the structure gate can protect it."
    );
  }
  return check(
    id,
    label,
    "pass",
    `All ${plural(checked, "content file")} parse and fingerprint cleanly.`,
    "Nothing to do — the structure gate has a reliable baseline for every file."
  );
}

// ---------------------------------------------------------------------------
// the report
// ---------------------------------------------------------------------------

/**
 * Run every deterministic health check over an uploaded template. Pure: same
 * input, same report, no I/O, no AI, no network.
 */
export function runTemplateHealthChecks(input: HealthInput): HealthReport {
  const files = input.files ?? {};
  const checks: HealthCheck[] = [
    checkPoisonTokens(input.demoTokens ?? []),
    checkThemeApplicable(files),
    checkLogoSlot(files),
    checkNavPrunable(files),
    checkLinksResolve(files, input.manifest),
    checkImageSlots(files),
    checkStructureParsable(files),
  ];
  return { status: worst(checks), checks, checkedAt: input.now ?? new Date().toISOString() };
}

/** Narrowing helper for the `health` jsonb column, which is `unknown` at rest. */
export function isHealthReport(v: unknown): v is HealthReport {
  if (!v || typeof v !== "object") return false;
  const r = v as Partial<HealthReport>;
  return (
    (r.status === "pass" || r.status === "warn" || r.status === "fail") &&
    Array.isArray(r.checks)
  );
}
