// Builds site-builder-templates/sdhome/script.js from the two sources in this folder:
//   site.js    the Site Builder layer — icons, menu, forms, the fixed hero video and the
//              page hooks the engine needs. Readable; edit it freely.
//   engine.js  the site's own smooth scroll, scroll animation and WebGL scenes, with
//              GSAP, Lenis and OGL bundled in (from the original site's build).
// Run after editing either, then the template tests:
//   node site-builder-templates/sdhome-src/build.mjs
//   npx vitest run tests/siteBuilderAuthoredTemplates.test.ts
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { transform } from "esbuild";

const here = path.dirname(fileURLToPath(import.meta.url));
const read = (f) => readFileSync(path.join(here, f), "utf8");

const engine = await transform(read("engine.js"), { minify: true, format: "iife", target: "es2020", legalComments: "none" });

const banner = `/* ---- Experience engine: built from sdhome-src/engine.js (do not edit here).
   Includes GSAP 3.15 with ScrollTrigger, SplitText and DrawSVG (GreenSock standard licence,
   https://gsap.com/standard-license), Lenis 1.3 (MIT, https://github.com/darkroomengineering/lenis)
   and OGL (Unlicense, https://github.com/oframe/ogl). An error in here never stops part 1. */
`;

// The engine needs matchMedia (GSAP registers ScrollTrigger against it); without it the page stays static.
const out = `${read("site.js").trimEnd()}\n\n${banner}if(window.matchMedia)try{${engine.code.trim()}}catch(e){window.console&&console.warn(e)}\nwindow.SDHome&&window.SDHome.boot();\n`;
const dest = path.join(here, "..", "sdhome", "script.js");
writeFileSync(dest, out);
console.log(`wrote ${path.relative(process.cwd(), dest)} (${(out.length / 1024).toFixed(1)} KB)`);
