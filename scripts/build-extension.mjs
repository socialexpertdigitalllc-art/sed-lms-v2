// Zips photo-extractor/ into public/downloads/ so agents can install it.
// Uses fflate, already a dependency. Run via `npm run build:extension`.
import { readFileSync, writeFileSync, mkdirSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { zipSync } from "fflate";

const SRC = "photo-extractor";
const OUT_DIR = "public/downloads";
const SKIP = new Set(["node_modules", "test", "docs", ".git"]);

function collect(dir, files = {}) {
  for (const entry of readdirSync(dir)) {
    if (SKIP.has(entry)) continue;
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) collect(full, files);
    else files[relative(SRC, full).split("\\").join("/")] = new Uint8Array(readFileSync(full));
  }
  return files;
}

const { version } = JSON.parse(readFileSync(join(SRC, "manifest.json"), "utf8"));
mkdirSync(OUT_DIR, { recursive: true });
const name = `business-photo-extractor-v${version}.zip`;
writeFileSync(join(OUT_DIR, name), zipSync(collect(SRC), { level: 6 }));
console.log(`Wrote ${OUT_DIR}/${name}`);
