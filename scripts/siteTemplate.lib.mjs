// Pure helpers for packaging a Site Builder template from site-builder-templates/<name>/.
// Kept free of side effects so tests/siteBuilderLumenTemplate.test.ts can import it;
// the CLI that writes files and renders the cover is scripts/build-site-template.mjs.
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { zipSync } from "fflate";

/** Files in a template folder that are documentation, not part of the site. */
const NOT_SHIPPED = /^(readme|changelog)(\.|$)/i;

/**
 * Relative path (forward slashes) -> bytes, for everything that ships in the zip.
 * @param {string} dir
 * @returns {Record<string, Uint8Array>}
 */
export function collectTemplateFiles(dir) {
  /** @type {Record<string, Uint8Array>} */
  const files = {};
  (function walk(current) {
    for (const entry of readdirSync(current).sort()) {
      if (entry.startsWith(".") || NOT_SHIPPED.test(entry)) continue;
      const full = join(current, entry);
      if (statSync(full).isDirectory()) walk(full);
      else files[relative(dir, full).split("\\").join("/")] = new Uint8Array(readFileSync(full));
    }
  })(dir);
  return files;
}

/** Fonts and images are already compressed — storing them avoids wasted work. */
const ALREADY_COMPRESSED = /\.(woff2?|png|jpe?g|webp|avif)$/i;
const FIXED_MTIME = new Date("2026-01-01T00:00:00Z");

/**
 * A reproducible zip: same files in, same bytes out. Files sit at the zip root.
 * @param {Record<string, Uint8Array>} files
 * @returns {Uint8Array}
 */
export function zipTemplateFiles(files) {
  /** @type {Record<string, [Uint8Array, { level: 0 | 9, mtime: Date }]>} */
  const entries = {};
  for (const [path, data] of Object.entries(files)) {
    entries[path] = [data, { level: ALREADY_COMPRESSED.test(path) ? 0 : 9, mtime: FIXED_MTIME }];
  }
  return zipSync(entries);
}
