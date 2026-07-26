import { readFile } from "node:fs/promises";
import { join } from "node:path";

/** One operator SOP, rendered by `SopViewer` (Task 3). `path` is repo-root
 *  relative — the same convention every other Site Studio storage-path
 *  constant in this codebase uses — and is never derived from caller input;
 *  it only ever comes from this static array. */
export interface SopEntry {
  slug: string;
  title: string;
  path: string;
}

/** The three operator SOPs (spec §12), in the order an operator would
 *  actually need them: add a template, generate a site, then troubleshoot.
 *  Keep this array and `docs/sops/site-studio/*.md` in sync — `loadSop`
 *  reads straight from `path` at request time, and the test suite asserts
 *  every one of these files exists on disk. */
export const SOPS: SopEntry[] = [
  {
    slug: "01-adding-a-template",
    title: "Adding a template",
    path: "docs/sops/site-studio/01-adding-a-template.md",
  },
  {
    slug: "02-generating-a-website",
    title: "Generating a website",
    path: "docs/sops/site-studio/02-generating-a-website.md",
  },
  {
    slug: "03-troubleshooting",
    title: "Troubleshooting",
    path: "docs/sops/site-studio/03-troubleshooting.md",
  },
];

/** Rejects any shape that could smuggle a path outside `docs/sops/site-studio/`
 *  once joined onto it — traversal in either direction (`..`), an absolute
 *  path or a nested directory (`/`), and a Windows-style separator (`\`).
 *  This function reads a file from disk keyed by a value that, in the route
 *  built on top of it (Task 3's SOPs page), ultimately comes from the URL —
 *  so it is checked explicitly here even though `loadSop` below ALSO only
 *  ever reads a path that came from the static `SOPS` array, never from the
 *  slug directly. Same defense-in-depth reasoning as `isSafeAssetPath`
 *  (`lib/site-studio/preview/assetPath.ts`) in Phase 4a. */
function isSafeSlug(slug: string): boolean {
  if (!slug) return false;
  if (slug.includes("..")) return false;
  if (slug.includes("/")) return false;
  if (slug.includes("\\")) return false;
  return true;
}

/**
 * Reads one SOP's markdown from disk at request time (never cached — these
 * are short files versioned with the code, and a hot-reloadable read costs
 * nothing an operator would notice). An unknown slug, or one shaped like a
 * path-traversal attempt, returns `null` — this function never throws,
 * matching every other lookup-by-caller-supplied-key helper in this module
 * (`loadManifest` is the one exception, by contract, but that is never fed
 * directly from a URL param the way a slug here would be).
 */
export async function loadSop(slug: string): Promise<{ title: string; markdown: string } | null> {
  if (!isSafeSlug(slug)) return null;
  const entry = SOPS.find((s) => s.slug === slug);
  if (!entry) return null;
  try {
    const markdown = await readFile(join(process.cwd(), entry.path), "utf8");
    return { title: entry.title, markdown };
  } catch {
    return null;
  }
}
