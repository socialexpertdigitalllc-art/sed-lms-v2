// Template Engine v2 — decide which content files actually get regenerated + shipped.
//
// runnerV2 used to regenerate EVERY content file classifyFiles handed it, ignoring
// what the client actually asked for. On the first real run that shipped
// `area-cherry-creek.html` — a demo service-area page nobody requested — for a
// client with NO service areas of their own. This module is the fix: build only
// pages the client requested (plus shared content JS, which every page depends
// on and which is never itself a "page" a client requests).
//
// HISTORY — the retired "no service areas" drop rule. This module originally
// also dropped REQUESTED area pages (kind `area_detail`/`areas_hub`) whenever
// the client had no service areas, on the grounds that the demo geography could
// never be de-leaked without real areas to put in its place: a guaranteed
// verification failure. That precondition is gone. personalize.ts now runs a
// deterministic scrub (buildScrubMachine/scrubText) that removes demo geography
// cleanly for no-areas clients — "Serving the local area", grammar tidied —
// even when the model changes nothing, so an areas page for a no-areas client
// verifies fine with generic local-area copy. The rule outlived its reason and
// caused real damage: a requested `service-areas.html` was silently dropped
// while the template's JS-rendered nav kept linking to it — a built-in 404.
// A page the client explicitly requested is now ALWAYS honoured.
//
// Pure: no I/O, no dependencies — consumed by the v2 runner.

export interface ManifestPage {
  file: string;
  kind: string;
}

export interface PageSelection {
  build: string[];
  dropped: { file: string; reason: string }[];
}

/**
 * Decide which content files to regenerate + ship.
 * - Shared content JS (a content file NOT listed as a manifest page, e.g. script.js,
 *   components.js) is ALWAYS built — it holds testimonial content + app logic used by every page.
 * - A manifest HTML page is built if and only if it's in requestedPages. An
 *   explicitly requested page is built, full stop — including area pages for
 *   clients with no service areas (the deterministic scrub in personalize.ts
 *   guarantees no demo geography survives, so there is nothing left to protect
 *   by dropping them).
 */
export function selectContentFiles(args: {
  contentFiles: string[];
  manifestPages: ManifestPage[];
  requestedPages: string[];
}): PageSelection {
  const { contentFiles, manifestPages, requestedPages } = args;
  const pageByFile = new Map(manifestPages.map((p) => [p.file, p]));
  const requested = new Set(requestedPages);

  const build: string[] = [];
  const dropped: { file: string; reason: string }[] = [];

  for (const file of contentFiles) {
    const page = pageByFile.get(file);
    if (!page) {
      // Not a manifest page at all — shared content JS (script.js, components.js,
      // any other content .js/.mjs). It carries content (testimonials, app logic)
      // used by every page, and a client never "requests" it by name, so it is
      // always built.
      build.push(file);
      continue;
    }
    if (!requested.has(file)) {
      dropped.push({ file, reason: "not requested" });
      continue;
    }
    build.push(file);
  }

  return { build, dropped };
}
