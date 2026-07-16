// Template Engine v2 — decide which content files actually get regenerated + shipped.
//
// runnerV2 used to regenerate EVERY content file classifyFiles handed it, ignoring
// what the client actually asked for. On the first real run that shipped
// `area-cherry-creek.html` — a demo service-area page nobody requested — for a
// client with NO service areas of their own, so its geography could never be
// de-leaked: a guaranteed verification failure for a page the client never wanted
// built in the first place. This module is the fix: build only pages the client
// requested (plus shared content JS, which every page depends on and which is
// never itself a "page" a client requests), and never build an area page when the
// client has no service areas to put in its place.
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
 * Page kinds whose entire reason for existing is a service area. Without a real
 * area to name, the AI has nothing to replace the demo geography with — the
 * leak gate would fail every time — so these are dropped rather than built.
 */
const AREA_KINDS = new Set(["area_detail", "areas_hub"]);

/**
 * Decide which content files to regenerate + ship.
 * - Shared content JS (a content file NOT listed as a manifest page, e.g. script.js,
 *   components.js) is ALWAYS built — it holds testimonial content + app logic used by every page.
 * - A manifest HTML page is built only if it's in requestedPages...
 * - ...and dropped if it's an area page (kind area_detail/areas_hub) while the client has no
 *   service areas (its geography can't be de-leaked).
 */
export function selectContentFiles(args: {
  contentFiles: string[];
  manifestPages: ManifestPage[];
  requestedPages: string[];
  hasServiceAreas: boolean;
}): PageSelection {
  const { contentFiles, manifestPages, requestedPages, hasServiceAreas } = args;
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
    if (AREA_KINDS.has(page.kind) && !hasServiceAreas) {
      dropped.push({ file, reason: "no service areas" });
      continue;
    }
    build.push(file);
  }

  return { build, dropped };
}
