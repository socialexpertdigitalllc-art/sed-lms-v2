import { zipFromMap } from "@/lib/site-studio/zip";
import { buildDossier } from "@/lib/site-studio/run/dossier";
import { generatePage, generateNewPage, generateComponents, type AiCall } from "./generate";
import type { TemplateBundle } from "./templates";
import type { BusinessBrief, SuppliedImage, SharedComponents } from "./prompt";

export const BUILDER_SITES_BUCKET = "builder-sites";

export const outputPathFor = (runId: string) => `${runId}/site.zip`;

/**
 * A "generating" run whose row hasn't moved for this long is presumed dead
 * (server restart mid-generation): the generate route may claim it again, and
 * the run route may delete it.
 *
 * IT LIVES HERE, not in either route, because those two decisions have to
 * agree. They were separately-declared numbers and they drifted — deletion
 * used ten minutes long after claiming had been raised to sixty — which made a
 * perfectly healthy paced run deletable eleven minutes into a quiet stretch.
 *
 * SIZED WITH the generate route's `maxDuration`, and it has to be. Its
 * `persist` only fires on a PAGE-STATE change, so the row's quiet period is the
 * gap between the last "generating" emit and the first page to finish — and
 * pacing made that gap long. Worst case for a single page: it can sit in the
 * rate gate for up to GATE_MAX_WAIT_MS (2 min) per attempt, and between
 * attempts wait out a vendor Retry-After capped at 60s, across MAX_ATTEMPTS (4)
 * attempts, each of which may then burn the 5-minute call timeout — call it
 * 4x(2+1+5) minutes, about 21 minutes with nothing written to the row. 60
 * minutes clears that with room for a slower vendor, and still trips long
 * before `maxDuration` (3600s) does.
 *
 * Sizing this too LOW is the dangerous direction: a second tab or a re-click
 * would pass the stale check, win a fresh CAS claim, and run a SECOND
 * concurrent `runSite` against the same throttled provider with two writers
 * racing on `pages`. Too high merely delays recovery from a real crash, which
 * the operator can already force by re-queuing the run — or, faster, with
 * /recover.
 */
export const STALE_GENERATING_MS = 60 * 60 * 1000;

/**
 * Build the BusinessBrief the prompt needs from a raw lead row, by reusing
 * `buildDossier` (lib/site-studio/run/dossier.ts) and projecting it down to
 * BusinessBrief's fields.
 *
 * Reused rather than reimplemented because buildDossier already carries the
 * one guarantee that matters here: it is the ONE place lead columns are
 * read, and it deliberately never surfaces commercial/internal fields
 * (price_quoted, yearly_price, rating, comments, platform) — exactly the
 * "never invent facts" boundary Site Builder's own prompt enforces on the
 * model side. It also already does the fiddly, easy-to-get-wrong parts
 * (tel: normalisation, Google-profile URL sniffing) correctly. BusinessBrief
 * is a strict subset of Dossier's fields, so this is a plain projection, not
 * a cast — see dossier.ts's own warning against ever casting a raw lead into
 * a typed shape.
 */
export function buildBrief(lead: Record<string, unknown>): BusinessBrief {
  const d = buildDossier(lead);
  return {
    business_name: d.business_name,
    phone: d.phone,
    email: d.email,
    profile_link: d.profile_link,
    map_embed: d.map_embed,
    logo: d.logo,
    services: d.services,
    service_areas: d.service_areas,
    color_scheme: d.color_scheme,
    years_experience: d.years_experience,
    about_business: d.about_business,
  };
}

/** lowercase, non-alphanumeric runs -> '-', trimmed, capped at 60 chars. */
function slugify(s: string): string {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60)
    .replace(/-+$/g, "");
}

function fileNameFor(pageName: string, taken: Set<string>): string {
  const base = slugify(pageName) || "page";
  let file = `${base}.html`;
  let n = 2;
  while (taken.has(file)) {
    file = `${base}-${n}.html`;
    n += 1;
  }
  return file;
}

/** The names a lead uses for the entry page — all of them map to the
 *  template's index page rather than spawning a "home.html". */
const HOME_NAMES = new Set(["home", "homepage", "home-page", "index", "main", "main-page", "landing", "landing-page"]);

const isIndexFile = (f: string) => /(^|\/)index\.html?$/i.test(f);

/** The slug of a page FILE — its basename without the extension. */
function fileSlug(file: string): string {
  const base = file.split("/").pop() ?? file;
  return slugify(base.replace(/\.html?$/i, ""));
}

/** Slug tokens, plural-insensitive ("services" and "service" compare equal;
 *  short tokens like "us"/"gas" are left alone so they don't degrade). */
function tokensOf(slug: string): Set<string> {
  return new Set(
    slug
      .split("-")
      .filter(Boolean)
      .map((t) => (t.length > 3 ? t.replace(/s$/, "") : t)),
  );
}

const isSubset = (a: Set<string>, b: Set<string>) => [...a].every((t) => b.has(t));

/**
 * The template page a lead-requested page name refers to, or null when the
 * template has no page of that type (the caller then designs it as a NEW
 * page). Matching is deliberately forgiving — a lead writes "About Us", a
 * template ships "about.html" — but every miss is safe: an unmatched name
 * just becomes a designed page, so a false negative costs one extra AI call,
 * never a wrong site. Preference order:
 *   1. exact slug match ("about-us" = "about-us")
 *   2. any home-ish name → the index page
 *   3. token-subset match, plural-insensitive, fewest leftover tokens wins
 *      ("about-us" ⊇ "about", "contact" ⊆ "contact-us")
 */
export function matchTemplatePage(requestedName: string, pageFiles: string[]): string | null {
  const want = slugify(requestedName);
  if (!want) return null;

  const files = pageFiles.map((f) => ({ f, slug: fileSlug(f) }));
  const exact = files.find((x) => x.slug === want);
  if (exact) return exact.f;

  if (HOME_NAMES.has(want)) {
    const home = files.find((x) => isIndexFile(x.f)) ?? files.find((x) => HOME_NAMES.has(x.slug));
    if (home) return home.f;
  }

  const wantTokens = tokensOf(want);
  let best: string | null = null;
  let bestExtra = Infinity;
  for (const x of files) {
    const haveTokens = tokensOf(x.slug);
    if (!isSubset(wantTokens, haveTokens) && !isSubset(haveTokens, wantTokens)) continue;
    const extra = Math.abs(haveTokens.size - wantTokens.size);
    if (extra < bestExtra) {
      best = x.f;
      bestExtra = extra;
    }
  }
  return best;
}

export interface PagePlan {
  /** Template pages to rewrite — ONLY these ship; unrequested template pages
   *  are never generated and never appear in the output zip. */
  existing: string[];
  /** Requested pages the template lacks — designed from reference pages. */
  newPages: { name: string; file: string }[];
}

/**
 * Which pages this site actually gets, from the lead's own `specify_pages`.
 *
 * A lead that names pages gets EXACTLY those (plus the entry page — a site
 * without an index is undeployable, so the template's home page is always
 * built even when the lead forgot to list it). Each requested name is
 * matched against the template (see `matchTemplatePage`); a name the
 * template has no page for becomes a designed-from-scratch page. A lead
 * that names nothing gets the whole template, unchanged behaviour.
 */
export function selectPages(pageFiles: string[], requestedPages: string[]): PagePlan {
  const requested = requestedPages.map((s) => s.trim()).filter(Boolean);
  if (requested.length === 0) return { existing: [...pageFiles], newPages: [] };

  const existing: string[] = [];
  const claimed = new Set<string>();
  const newPages: { name: string; file: string }[] = [];
  const taken = new Set(pageFiles);

  for (const name of requested) {
    const match = matchTemplatePage(name, pageFiles);
    if (match) {
      // Two requested names resolving to the same template page ("Home" and
      // "Homepage") build it once — never a duplicate, never a forced clone.
      if (!claimed.has(match)) {
        claimed.add(match);
        existing.push(match);
      }
      continue;
    }
    const file = fileNameFor(name, taken);
    taken.add(file);
    newPages.push({ name, file });
  }

  if (pageFiles.length > 0) {
    const home = pageFiles.find(isIndexFile) ?? [...pageFiles].sort()[0];
    if (!claimed.has(home)) {
      claimed.add(home);
      existing.unshift(home);
    }
  }

  return { existing, newPages };
}

/** The template's shared-components file — the `components.js` (or
 *  `components.html`) that renders the header/nav/footer/booking form every
 *  page shares. Detected by basename, the same convention the old template
 *  engine's manifest used (`lib/template-engine/manifest.ts`). */
export interface ComponentsSource {
  file: string;
  source: string;
}

const COMPONENTS_RE = /(^|\/)components\.(js|html?)$/i;

export function findComponentsFile(template: TemplateBundle): ComponentsSource | null {
  const pageHit = template.pageFiles.find((f) => COMPONENTS_RE.test(f));
  if (pageHit !== undefined) return { file: pageHit, source: template.pages[pageHit] };
  const assetHit = template.assetFiles.find((f) => COMPONENTS_RE.test(f));
  if (assetHit !== undefined) return { file: assetHit, source: new TextDecoder().decode(template.assets[assetHit]) };
  return null;
}

/**
 * Pick 2–3 existing pages as design references for a new page: the home
 * page plus the one or two OTHER pages most different in size from it — a
 * cheap proxy for "structurally different" that needs no HTML parsing (see
 * AGENTS.md's hard scope limits: no analysis of a template's HTML beyond the
 * page/asset split). A single reference invites the model to clone that
 * page's particular section rhythm; a size-diverse spread lets it infer
 * shared design vocabulary instead.
 */
export function pickReferencePages(pageFiles: string[], pages: Record<string, string>): string[] {
  if (pageFiles.length === 0) return [];
  const home = pageFiles.includes("index.html") ? "index.html" : [...pageFiles].sort()[0];
  const homeLen = (pages[home] ?? "").length;
  const others = pageFiles
    .filter((f) => f !== home)
    .sort((a, b) => Math.abs((pages[b] ?? "").length - homeLen) - Math.abs((pages[a] ?? "").length - homeLen));
  return [home, ...others.slice(0, 2)];
}

export interface PageState {
  /** "pending" and "generating" exist so a run's row can carry LIVE progress
   *  while generation is still going — the run screen polls the row and shows
   *  exactly which pages are done, running, or still queued. */
  status: "pending" | "generating" | "ok" | "failed";
  kind: "existing" | "new" | "component";
  /** The human page name ("About Us") — present for kind "new" (needed to
   *  reconstruct buildNewPagePrompt on a later regenerate) and for kind
   *  "component" (a display label). */
  name?: string;
  /** For kind "component" this holds the rewritten file SOURCE (usually
   *  JavaScript) — the field name is historical, the content is whatever the
   *  file is. */
  html?: string;
  error?: string;
  /** Whether retrying this failed page can possibly succeed — copied verbatim
   *  from the generation outcome (see GenerateOutcome in generate.ts). Absent
   *  on an extraction failure, which is retryable by nature; `false` only for
   *  a terminal provider failure (bad key, model not found). Never present on
   *  a non-failed entry. */
  retryable?: boolean;
  /** The vendor's Retry-After from a throttled call, when it sent one. */
  retryAfterMs?: number;
}

/** The failure fields of a not-ok generation outcome, projected onto PageState:
 *  the error always, the classification fields only when the outcome carries
 *  them — an extraction failure's ABSENT `retryable` must stay absent (absent
 *  means "retryable by nature", see GenerateOutcome). */
function failureFields(outcome: { error: string; retryable?: boolean; retryAfterMs?: number }) {
  return {
    error: outcome.error,
    ...(outcome.retryable !== undefined && { retryable: outcome.retryable }),
    ...(outcome.retryAfterMs !== undefined && { retryAfterMs: outcome.retryAfterMs }),
  };
}

/** Failed pages worth another round: failed and not marked terminal. */
export function retryablePages(pages: Record<string, PageState>): string[] {
  return Object.entries(pages)
    .filter(([, p]) => p.status === "failed" && p.retryable !== false)
    .map(([file]) => file);
}

/** True when every failed page is terminal — looping cannot help. False when
 *  there are no failures at all: an all-ok map is "done", not "terminal". */
export function allFailuresTerminal(pages: Record<string, PageState>): boolean {
  const failed = Object.values(pages).filter((p) => p.status === "failed");
  return failed.length > 0 && failed.every((p) => p.retryable === false);
}

/** Assemble the output zip from whichever pages currently succeeded, plus
 *  every template asset untouched. A successful "component" entry overrides
 *  the template's own copy of that file (same key). A failed page is simply
 *  absent from the zip until the operator regenerates it — no placeholder,
 *  no fallback to the template's own (wrong-business) copy of that page. */
export function assembleZip(assets: Record<string, Uint8Array>, pages: Record<string, PageState>): Uint8Array {
  const files: Record<string, Uint8Array> = { ...assets };
  const encoder = new TextEncoder();
  for (const [file, state] of Object.entries(pages)) {
    if (state.status === "ok" && state.html !== undefined) files[file] = encoder.encode(state.html);
  }
  return zipFromMap(files);
}

export interface RunSiteArgs {
  aiCall: AiCall;
  brief: BusinessBrief;
  /** The operator's picks, each a direct public image URL (a Pexels CDN link,
   *  a stored library link, or the client's own photo link). These go into
   *  the prompt — and from there into the site's HTML — verbatim. Nothing is
   *  downloaded; see `lib/site-builder/imageLibrary.ts`. */
  images: SuppliedImage[];
  template: TemplateBundle;
  /** The lead's specify_pages — the ONLY pages this site gets (plus the
   *  entry page). Empty means "the whole template" — see `selectPages`. */
  requestedPages: string[];
  /** Called after every page-state change with the CURRENT pages map — the
   *  live-progress seam. The caller persists it (serialised however it
   *  likes); runSite awaits each call so persistence can't fall behind. */
  onProgress?: (pages: Record<string, PageState>) => void | Promise<void>;
  /**
   * Live OUTPUT seam, one level below `onProgress`: every streamed delta of
   * every generation lands here tagged with the FILE it belongs to, as it
   * arrives. Presence of this callback is what switches the underlying model
   * calls to streaming; absent → every call is the non-streaming call it
   * always was. Fire-and-forget by design (never awaited): a slow consumer
   * must not be able to slow a generation down.
   */
  onOutput?: (file: string, delta: string) => void;
  /**
   * Pages carried over from a PREVIOUS attempt at this run. Any entry already
   * `ok` is kept verbatim and never regenerated; everything else is
   * (re)generated from scratch.
   *
   * The page PLAN is still recomputed from `requestedPages` — this map is only
   * consulted for files the fresh plan already contains. A lead whose
   * `specify_pages` changed between attempts therefore gets its CURRENT set,
   * with still-relevant successes carried and dropped pages simply absent.
   * Reading the plan back out of this map instead would quietly pin a run to
   * whatever specification it was first started with.
   */
  resume?: Record<string, PageState>;
}

export interface RunSiteResult {
  /** True when at least one real page generated successfully (a rewritten
   *  components file alone is not a site). */
  ok: boolean;
  pages: Record<string, PageState>;
  zipBytes?: Uint8Array;
}

/**
 * Generate a whole site, components first:
 *
 *  1. The shared-components file (when the template has one) is rewritten
 *     BEFORE anything else — it renders the header/nav/footer/booking form
 *     every page shares, so its rewritten content is context for every page
 *     prompt. Its failure never kills the run: pages still generate (without
 *     the context) and the operator can regenerate it alone.
 *  2. Only the lead-requested pages (see `selectPages`) are then generated in
 *     parallel — template pages the lead didn't ask for are never built and
 *     never ship. Requested pages the template lacks are designed from
 *     reference pages.
 *
 * A per-page failure is recorded in `pages` and never kills the run — only
 * when EVERY page fails does the run itself fail. That holds for a THROWN
 * provider failure too (a sustained 429, a timeout), not just an unusable
 * reply: `generate.ts` catches the call itself and returns the same `ok:false`
 * outcome, so the `Promise.all` below cannot reject and take a run's already-
 * finished pages down with it. Do not move that catch here without reading
 * `callOrFail`'s docblock — `regeneratePage` has no `Promise.all` to guard.
 *
 * RESUMING. `args.resume` carries the page map of a PREVIOUS attempt at this
 * same run, so retrying a failed run costs only what actually failed: a page
 * already `ok` is kept verbatim and no AI call is ever made for it — not for
 * the page, and not for a carried components file, whose stored source is
 * reused as every page prompt's context instead. The plan itself is still
 * recomputed from `requestedPages`, so a lead whose pages changed between
 * attempts gets its current set rather than the one the run first started
 * with. A run whose every requested page is already carried therefore makes
 * NO model call at all and simply re-assembles the zip — which is also how an
 * interrupted upload is recovered without paying for the site twice.
 */
export async function runSite(args: RunSiteArgs): Promise<RunSiteResult> {
  const { aiCall, brief, images, template, requestedPages, onProgress, onOutput, resume } = args;
  /** The per-file streaming callback for one generation — undefined when the
   *  caller wants no live output, so the calls stay non-streaming. */
  const chunkSink = (file: string) => (onOutput ? (delta: string) => onOutput(file, delta) : undefined);

  const components = findComponentsFile(template);
  // A components.html is a page FILE but never a page of the site — it must
  // not be selectable, and must not count toward "did any page succeed".
  const selectablePages = template.pageFiles.filter((f) => f !== components?.file);
  const plan = selectPages(selectablePages, requestedPages);
  const siteFiles = [...plan.existing, ...plan.newPages.map((p) => p.file)];

  /**
   * The fresh plan's entry for a file, upgraded to the carried result when a
   * previous attempt already finished it. `kind` and `name` always come from
   * the PLAN, never from the carried entry: a stale entry describing a file
   * that has since changed kind would otherwise mislabel it for the rest of
   * the run. Only `status` and `html` are carried, and only together — an
   * `ok` entry without USABLE html is not a page and is regenerated.
   *
   * Usable means truthy, not merely present. An `ok` entry carrying an empty
   * string would otherwise be honoured: no AI call is made for it, a zero-byte
   * file goes in the zip, and it counts toward `result.ok` — so a run whose
   * every page was empty would report success. No current extractor can produce
   * that; this is defence against a corrupted row, which is exactly the kind of
   * row `resume` exists to read.
   *
   * Failure metadata (`error`, `retryable`, `retryAfterMs`) is NEVER carried:
   * a carried page is only ever `ok`, and a failed previous attempt's
   * classification describes a call this run is about to redo, not this run.
   */
  const withCarried = (file: string, planned: PageState): PageState => {
    const prev = resume?.[file];
    return prev?.status === "ok" && prev.html ? { ...planned, status: "ok", html: prev.html } : planned;
  };

  const pages: Record<string, PageState> = {};
  if (components) {
    pages[components.file] = withCarried(components.file, {
      status: "pending",
      kind: "component",
      name: "Shared components",
    });
  }
  for (const f of plan.existing) pages[f] = withCarried(f, { status: "pending", kind: "existing" });
  for (const p of plan.newPages) pages[p.file] = withCarried(p.file, { status: "pending", kind: "new", name: p.name });

  const emit = async () => {
    if (onProgress) await onProgress(pages);
  };
  await emit();

  // ---- 1. components, first and alone ----
  let shared: SharedComponents | undefined;
  if (components) {
    const carried = pages[components.file];
    if (carried.status === "ok" && carried.html !== undefined) {
      // A previous attempt already rewrote it. Reuse its source as page
      // context rather than paying for it again — every page prompt below
      // wants the SAME components content this run's pages will ship with.
      shared = { file: components.file, source: carried.html };
    } else {
      pages[components.file] = { ...pages[components.file], status: "generating" };
      await emit();
      const outcome = await generateComponents(
        { aiCall },
        { brief, images, file: components.file, source: components.source, siteFiles, onChunk: chunkSink(components.file) },
      );
      pages[components.file] = outcome.ok
        ? { status: "ok", kind: "component", name: "Shared components", html: outcome.html }
        : { status: "failed", kind: "component", name: "Shared components", ...failureFields(outcome) };
      if (outcome.ok) shared = { file: components.file, source: outcome.html };
      await emit();
    }
  }

  // References come from the WHOLE template (minus the components file) —
  // design vocabulary doesn't shrink just because the lead asked for fewer
  // pages.
  const references = pickReferencePages(selectablePages, template.pages).map((file) => ({
    file,
    html: template.pages[file],
  }));

  // ---- 2. the pages, in parallel ----
  const runExisting = async (file: string) => {
    // Carried from a previous attempt — nothing to do, and nothing to pay for.
    if (pages[file].status === "ok") return;
    pages[file] = { ...pages[file], status: "generating" };
    await emit();
    const outcome = await generatePage({ aiCall }, {
      brief,
      images,
      pageFile: file,
      pageHtml: template.pages[file],
      siteFiles,
      components: shared,
      onChunk: chunkSink(file),
    });
    pages[file] = outcome.ok
      ? { status: "ok", kind: "existing", html: outcome.html }
      : { status: "failed", kind: "existing", ...failureFields(outcome) };
    await emit();
  };

  const runNew = async ({ name, file }: { name: string; file: string }) => {
    // Carried from a previous attempt — nothing to do, and nothing to pay for.
    if (pages[file].status === "ok") return;
    pages[file] = { ...pages[file], status: "generating" };
    await emit();
    const outcome = await generateNewPage({ aiCall }, {
      brief,
      images,
      pageName: name,
      newFile: file,
      references,
      siteFiles,
      components: shared,
      onChunk: chunkSink(file),
    });
    pages[file] = outcome.ok
      ? { status: "ok", kind: "new", name, html: outcome.html }
      : { status: "failed", kind: "new", name, ...failureFields(outcome) };
    await emit();
  };

  await Promise.all([...plan.existing.map(runExisting), ...plan.newPages.map(runNew)]);

  const ok = Object.values(pages).some((p) => p.status === "ok" && p.kind !== "component");
  if (!ok) return { ok: false, pages };

  // When an HTML components file failed to rewrite, ship the template's
  // original — it is a page FILE (not an asset, so `assembleZip` wouldn't
  // otherwise carry it) and every generated page fetches it at runtime; a
  // site whose shared include 404s is broken everywhere, which is worse than
  // demo content the operator will regenerate anyway. A JS components file
  // needs no such step: it lives in `assets` and ships by default.
  const baseAssets = { ...template.assets };
  if (components && template.pages[components.file] !== undefined && pages[components.file]?.status !== "ok") {
    baseAssets[components.file] = new TextEncoder().encode(components.source);
  }

  return { ok: true, pages, zipBytes: assembleZip(baseAssets, pages) };
}

export interface RegeneratePageArgs {
  aiCall: AiCall;
  brief: BusinessBrief;
  images: SuppliedImage[];
  template: TemplateBundle;
  siteFiles: string[];
  file: string;
  kind: "existing" | "new" | "component";
  /** Required when kind is "new" — the page name buildNewPagePrompt needs. */
  name?: string;
  /** The run's current (rewritten) components file, as page-prompt context.
   *  Ignored for kind "component" — that regeneration starts from the
   *  template's own original source. */
  components?: SharedComponents;
  instruction?: string;
  /** Streams the model's output as it arrives, exactly like a full run's
   *  `onOutput`. NOT optional in spirit: omitting it silently puts the call on
   *  the NON-streaming path, whose 300s total timeout a big page (a real
   *  index.html on MiniMax M3) cannot fit — which made the per-page Regenerate
   *  button fail on exactly the pages an operator most wants to fix, while
   *  full runs streamed happily past 300s. Streaming's idle timeout (90s of
   *  SILENCE, not 300s of work) is the correct budget for a single big page. */
  onChunk?: (delta: string) => void;
}

/** Regenerate exactly one entry — an existing page, a newly-designed page,
 *  or the shared components file — optionally steered by an operator
 *  instruction. Used by the regenerate route so a disliked page can be
 *  redone without touching the rest of the run. */
export async function regeneratePage(args: RegeneratePageArgs) {
  const { aiCall, brief, images, template, siteFiles, file, kind, name, components, instruction, onChunk } = args;

  if (kind === "component") {
    const original = findComponentsFile(template);
    if (!original || original.file !== file) {
      return { ok: false as const, error: `${file}: not this template's components file.` };
    }
    return generateComponents({ aiCall }, {
      brief,
      images,
      file,
      source: original.source,
      siteFiles,
      instruction,
      onChunk,
    });
  }

  if (kind === "existing") {
    const pageHtml = template.pages[file];
    if (pageHtml === undefined) {
      return { ok: false as const, error: `${file}: not found in this template.` };
    }
    return generatePage({ aiCall }, { brief, images, pageFile: file, pageHtml, siteFiles, components, instruction, onChunk });
  }

  const componentsFile = findComponentsFile(template)?.file;
  const references = pickReferencePages(
    template.pageFiles.filter((f) => f !== componentsFile),
    template.pages,
  ).map((f) => ({
    file: f,
    html: template.pages[f],
  }));
  return generateNewPage({ aiCall }, {
    brief,
    images,
    pageName: name ?? file,
    newFile: file,
    references,
    siteFiles,
    components,
    instruction,
    onChunk,
  });
}
