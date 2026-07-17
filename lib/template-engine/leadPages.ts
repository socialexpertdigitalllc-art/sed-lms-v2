// Template Engine v2 — map a lead's sales-captured "specify_pages" list onto the
// template's real page files, so the operator never hand-picks pages: the pages
// to build come straight from the lead (the sales team already decided them).
//
// A lead stores page NAMES the way sales phrased them ("Home", "About Us",
// "Service Areas"); a template stores FILES tagged with a PageKind ("index.html"
// = home, "service-areas.html" = areas_hub). This module bridges the two by
// kind. Per-item detail pages (service_detail/area_detail) are deliberately NOT
// emitted here — those are the individual service/area pages, fanned out one per
// service/area by the build pipeline, not chosen from the sales page list.
//
// Pure: no I/O.

export interface ManifestPageLite {
  file: string;
  kind: string;
}

/**
 * The page kinds a sales page-name can request, and the synonyms sales actually
 * type for each. Order here is the canonical page order of a finished site, so
 * the resolved file list reads Home -> About -> Services -> Areas -> Gallery ->
 * Contact regardless of the order the names came in.
 */
export const PAGE_NAME_KINDS: Record<string, string[]> = {
  home: ["home", "homepage", "main", "index", "landing"],
  about: ["about", "about us", "aboutus", "who we are", "our story", "company"],
  services_hub: ["services", "our services", "service", "what we do", "services hub"],
  areas_hub: ["service areas", "service area", "areas", "locations", "location", "areas we serve", "service locations", "coverage"],
  gallery: ["gallery", "portfolio", "projects", "our work", "work", "photos"],
  contact: ["contact", "contact us", "contactus", "get in touch", "get a quote", "quote"],
};

// Canonical output order of kinds — a finished site's natural nav order.
const KIND_ORDER = ["home", "about", "services_hub", "areas_hub", "gallery", "contact"];

// Standard pages to build when a lead specified none — everything except the
// per-item detail pages.
const STANDARD_KINDS = new Set(KIND_ORDER);

function normalize(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9 ]+/g, " ").replace(/\s+/g, " ").trim();
}

/** Resolve one sales page-name to a kind, or null if it matches nothing known. */
function nameToKind(name: string): string | null {
  const n = normalize(name);
  for (const [kind, synonyms] of Object.entries(PAGE_NAME_KINDS)) {
    if (synonyms.includes(n)) return kind;
  }
  // Loose contains-match as a fallback (e.g. "About Our Team" -> about).
  for (const [kind, synonyms] of Object.entries(PAGE_NAME_KINDS)) {
    if (synonyms.some((s) => n.includes(s))) return kind;
  }
  return null;
}

/**
 * Map a lead's `specify_pages` onto the template's files, by kind, PRESERVING
 * the order sales listed them (home always forced first — a site needs one).
 * When the lead specified no pages, fall back to every standard template page
 * in canonical site order. Per-item detail pages are never included here.
 */
export function resolveLeadPages(specifyPages: string[], manifestPages: ManifestPageLite[]): string[] {
  const fileForKind = new Map<string, string>();
  for (const p of manifestPages) {
    if (!fileForKind.has(p.kind)) fileForKind.set(p.kind, p.file); // first file wins per kind
  }

  // Ordered list of kinds to build: home first, then the lead's order (or the
  // canonical standard order when the lead listed nothing).
  const listed = (specifyPages ?? []).map(nameToKind).filter((k): k is string => k !== null && STANDARD_KINDS.has(k));
  const orderedKinds = listed.length === 0 ? [...KIND_ORDER] : ["home", ...listed];

  const out: string[] = [];
  const seenKind = new Set<string>();
  for (const kind of orderedKinds) {
    if (seenKind.has(kind)) continue;
    seenKind.add(kind);
    const file = fileForKind.get(kind);
    if (file && !out.includes(file)) out.push(file);
  }
  return out;
}
