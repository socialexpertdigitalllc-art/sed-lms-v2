import { zipFromMap } from "@/lib/site-studio/zip";
import { buildDossier } from "@/lib/site-studio/run/dossier";
import { generatePage, generateNewPage, type AiCall } from "./generate";
import type { TemplateBundle } from "./templates";
import type { BusinessBrief, SuppliedImage } from "./prompt";

export const BUILDER_SITES_BUCKET = "builder-sites";

export const outputPathFor = (runId: string) => `${runId}/site.zip`;

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
    site_type: d.site_type,
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
  status: "ok" | "failed";
  kind: "existing" | "new";
  /** The human page name ("About Us") — present for kind "new" only, needed
   *  to reconstruct buildNewPagePrompt on a later regenerate. */
  name?: string;
  html?: string;
  error?: string;
}

/** Assemble the output zip from whichever pages currently succeeded, plus
 *  every template asset untouched. A failed page is simply absent from the
 *  zip until the operator regenerates it — no placeholder, no fallback to
 *  the template's own (wrong-business) copy of that page. */
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
  images: SuppliedImage[];
  template: TemplateBundle;
  /** The lead's specify_pages — page names the lead asked for. Any that the
   *  template doesn't already have (by slug) are designed as new pages. */
  requestedPages: string[];
}

export interface RunSiteResult {
  /** True when at least one page generated successfully. False only when
   *  every page — existing and new — failed. */
  ok: boolean;
  pages: Record<string, PageState>;
  zipBytes?: Uint8Array;
}

/**
 * Generate a whole site: every template page rewritten in parallel, plus
 * any lead-requested pages the template lacks (designed from reference
 * pages), assets copied through untouched. A per-page failure is recorded
 * in `pages` and never kills the run — only when EVERY page fails does the
 * run itself fail.
 */
export async function runSite(args: RunSiteArgs): Promise<RunSiteResult> {
  const { aiCall, brief, images, template, requestedPages } = args;

  const existingSlugs = new Set(template.pageFiles.map((f) => slugify(f.replace(/\.html?$/i, ""))));
  const taken = new Set(template.pageFiles);
  const newPages: { name: string; file: string }[] = [];
  for (const name of requestedPages) {
    const slug = slugify(name);
    if (!slug || existingSlugs.has(slug)) continue;
    const file = fileNameFor(name, taken);
    taken.add(file);
    newPages.push({ name, file });
  }

  const siteFiles = [...template.pageFiles, ...newPages.map((p) => p.file)];
  const references = pickReferencePages(template.pageFiles, template.pages).map((file) => ({
    file,
    html: template.pages[file],
  }));

  const [existingResults, newResults] = await Promise.all([
    Promise.all(
      template.pageFiles.map(async (file) => {
        const outcome = await generatePage({ aiCall }, {
          brief,
          images,
          pageFile: file,
          pageHtml: template.pages[file],
          siteFiles,
        });
        return [file, outcome] as const;
      }),
    ),
    Promise.all(
      newPages.map(async ({ name, file }) => {
        const outcome = await generateNewPage({ aiCall }, {
          brief,
          images,
          pageName: name,
          newFile: file,
          references,
          siteFiles,
        });
        return [file, outcome, name] as const;
      }),
    ),
  ]);

  const pages: Record<string, PageState> = {};
  for (const [file, outcome] of existingResults) {
    pages[file] = outcome.ok
      ? { status: "ok", kind: "existing", html: outcome.html }
      : { status: "failed", kind: "existing", error: outcome.error };
  }
  for (const [file, outcome, name] of newResults) {
    pages[file] = outcome.ok
      ? { status: "ok", kind: "new", name, html: outcome.html }
      : { status: "failed", kind: "new", name, error: outcome.error };
  }

  const ok = Object.values(pages).some((p) => p.status === "ok");
  if (!ok) return { ok: false, pages };

  return { ok: true, pages, zipBytes: assembleZip(template.assets, pages) };
}

export interface RegeneratePageArgs {
  aiCall: AiCall;
  brief: BusinessBrief;
  images: SuppliedImage[];
  template: TemplateBundle;
  siteFiles: string[];
  file: string;
  kind: "existing" | "new";
  /** Required when kind is "new" — the page name buildNewPagePrompt needs. */
  name?: string;
  instruction?: string;
}

/** Regenerate exactly one page, existing or newly-designed, optionally
 *  steered by an operator instruction. Used by the regenerate route so a
 *  disliked page can be redone without touching the rest of the run. */
export async function regeneratePage(args: RegeneratePageArgs) {
  const { aiCall, brief, images, template, siteFiles, file, kind, name, instruction } = args;
  if (kind === "existing") {
    const pageHtml = template.pages[file];
    if (pageHtml === undefined) {
      return { ok: false as const, error: `${file}: not found in this template.` };
    }
    return generatePage({ aiCall }, { brief, images, pageFile: file, pageHtml, siteFiles, instruction });
  }
  const references = pickReferencePages(template.pageFiles, template.pages).map((f) => ({
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
    instruction,
  });
}
