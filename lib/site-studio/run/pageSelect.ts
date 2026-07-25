import type { PageDef, PageKind, TemplateManifest } from "../schema";

/** One page the run will build. Repeated `page_id`s are stamped duplicates
 *  (one per service/area) distinguished by their own `output` path. */
export interface SelectedPage {
  page_id: string;
  output?: string;
  stamp_value?: string;
  nav_title?: string;
}

export interface SelectPagesOptions {
  requested: string[];
  services: string[];
  areas: string[];
  fanOutServices?: boolean;
  fanOutAreas?: boolean;
}

export interface SelectPagesResult {
  pages: SelectedPage[];
  /** Requested names the template could not satisfy — surfaced, never
   *  silently dropped (v2 dropped these and then rendered nav links that
   *  404'd). */
  skipped: string[];
}

/** How sales actually types page names, mapped onto the manifest's PageKind
 *  vocabulary. Each phrase is normalised (lowercased, non-alphanumerics
 *  stripped) for lookup. */
const SYNONYMS: [PageKind, string[]][] = [
  ["home", ["home", "homepage", "landing"]],
  ["about", ["about", "about us", "our story"]],
  ["services_hub", ["services", "our services", "what we do"]],
  ["areas_hub", ["areas", "service areas", "locations", "cities we serve"]],
  ["gallery", ["gallery", "portfolio", "our work", "projects"]],
  ["contact", ["contact", "contact us", "get in touch", "quote"]],
  ["reviews", ["testimonials", "reviews", "customer reviews", "what our customers say", "feedback"]],
];

const normalise = (s: string): string => s.toLowerCase().replace(/[^a-z0-9]/g, "");

const EXACT_LOOKUP = new Map<string, PageKind>();
for (const [kind, phrases] of SYNONYMS) {
  for (const phrase of phrases) EXACT_LOOKUP.set(normalise(phrase), kind);
}

/** Maps a free-text page name (as sales actually types it) to a PageKind, or
 *  null when nothing recognisable matches. Exact match first, then a
 *  contains-fallback for phrases sales tacks extra words onto (e.g. "Areas We
 *  Serve" contains the canonical "areas"). Deliberately one-directional: the
 *  reverse (a canonical phrase containing the input) would let short or
 *  garbled input like "Us" or "Do" match "about"/"what we do" — building a
 *  plausible-but-wrong page is worse than not matching, so an unrecognised
 *  name is surfaced via `skipped` instead. */
export function pageKindForName(name: string): PageKind | null {
  const n = normalise(name);
  if (!n) return null;

  const exact = EXACT_LOOKUP.get(n);
  if (exact) return exact;

  for (const [kind, phrases] of SYNONYMS) {
    for (const phrase of phrases) {
      const p = normalise(phrase);
      if (n.includes(p)) return kind;
    }
  }
  return null;
}

/** lowercase, non-alphanumeric runs -> '-', trimmed, capped at 60 chars. */
export function slugify(s: string): string {
  const base = s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return base.slice(0, 60).replace(/-+$/g, "");
}

const nonStampablePages = (manifest: TemplateManifest): PageDef[] =>
  manifest.pages.filter((p) => !p.stampable);

const firstPageOfKind = (manifest: TemplateManifest, kind: PageKind): PageDef | undefined =>
  nonStampablePages(manifest).find((p) => p.kind === kind);

/** Maps the lead's requested page names onto the template's actual pages,
 *  always builds home first, and stamps fan-out (per-service / per-area)
 *  pages from the template's stampable page defs. Pure. */
export function selectPages(manifest: TemplateManifest, opts: SelectPagesOptions): SelectPagesResult {
  const { requested, services, areas, fanOutServices, fanOutAreas } = opts;
  const home = firstPageOfKind(manifest, "home");

  const selected: SelectedPage[] = [];
  const seen = new Set<string>();
  const skipped: string[] = [];

  const add = (page: PageDef): void => {
    if (seen.has(page.id)) return;
    seen.add(page.id);
    selected.push({ page_id: page.id });
  };

  if (requested.length === 0) {
    // Nothing requested: every non-stampable page, manifest order, home first.
    if (home) add(home);
    for (const p of nonStampablePages(manifest)) add(p);
  } else {
    for (const name of requested) {
      const kind = pageKindForName(name);
      const page = kind ? firstPageOfKind(manifest, kind) : undefined;
      if (!page) {
        skipped.push(name);
        continue;
      }
      add(page);
    }
    // Force home first, whether or not it was explicitly requested.
    if (home) {
      if (seen.has(home.id)) {
        const idx = selected.findIndex((p) => p.page_id === home.id);
        if (idx > 0) {
          const [h] = selected.splice(idx, 1);
          selected.unshift(h);
        }
      } else {
        selected.unshift({ page_id: home.id });
        seen.add(home.id);
      }
    }
  }

  if (fanOutServices && services.length) {
    const svcPage = manifest.pages.find((p) => p.stampable && p.kind === "service");
    if (svcPage) {
      // Distinct services can slugify to the same output path (e.g. "Drain
      // Cleaning" and "drain  cleaning!"); the renderer has no duplicate-
      // output guard, so a collision here would silently overwrite one
      // stamped page with another. Catch it: keep the first, surface the
      // rest via `skipped` rather than losing them.
      const usedOutputs = new Set<string>();
      for (const service of services) {
        const output = `services/${slugify(service)}.html`;
        if (usedOutputs.has(output)) {
          skipped.push(service);
          continue;
        }
        usedOutputs.add(output);
        selected.push({
          page_id: svcPage.id,
          output,
          stamp_value: service,
          nav_title: service,
        });
      }
    }
  }

  if (fanOutAreas && areas.length) {
    const areaPage = manifest.pages.find((p) => p.stampable && p.kind === "area");
    if (areaPage) {
      const usedOutputs = new Set<string>();
      for (const area of areas) {
        const output = `areas/${slugify(area)}.html`;
        if (usedOutputs.has(output)) {
          skipped.push(area);
          continue;
        }
        usedOutputs.add(output);
        selected.push({
          page_id: areaPage.id,
          output,
          stamp_value: area,
          nav_title: area,
        });
      }
    }
  }

  return { pages: selected, skipped };
}
