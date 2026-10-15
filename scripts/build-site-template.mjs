// Packages a Site Builder template and renders its cover screenshot.
//
//   npm run build:site-template            # builds "lumen"
//   npm run build:site-template -- lumen   # same, by name
//   npm run build:site-template -- lumen --no-cover
//
// Writes site-builder-templates/dist/<name>.zip and <name>-cover.png. Upload both on the
// Site Builder > Templates board (name + zip + cover). The cover is a 16:10 shot of the
// home page, which is the ratio the template picker displays.
import { mkdirSync, readFileSync, writeFileSync, existsSync, statSync } from "node:fs";
import { createServer } from "node:http";
import { extname, join, normalize } from "node:path";
import { collectTemplateFiles, zipTemplateFiles } from "./siteTemplate.lib.mjs";

const args = process.argv.slice(2);
const name = args.find((a) => !a.startsWith("--")) ?? "lumen";
const wantCover = !args.includes("--no-cover");

const src = join("site-builder-templates", name);
const outDir = join("site-builder-templates", "dist");
if (!existsSync(src)) {
  console.error(`No template folder at ${src}`);
  process.exit(1);
}

const files = collectTemplateFiles(src);
if (!files["index.html"]) {
  console.error(`${src} has no index.html — a template needs a home page.`);
  process.exit(1);
}
mkdirSync(outDir, { recursive: true });
const zip = zipTemplateFiles(files);
const zipPath = join(outDir, `${name}.zip`);
writeFileSync(zipPath, zip);
const pages = Object.keys(files).filter((f) => /\.html?$/i.test(f)).length;
console.log(`Wrote ${zipPath}  (${(zip.length / 1024).toFixed(0)} KB, ${pages} pages, ${Object.keys(files).length - pages} assets)`);

if (!wantCover) process.exit(0);

const TYPES = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".svg": "image/svg+xml",
  ".woff2": "font/woff2",
  ".png": "image/png",
  ".jpg": "image/jpeg",
};

// A throwaway static server so the page loads exactly as it would from a host.
const server = createServer((req, res) => {
  const rel = normalize(decodeURIComponent(new URL(req.url, "http://x").pathname)).replace(/^([/\\])+/, "") || "index.html";
  const file = join(src, rel);
  if (rel.startsWith("..") || !existsSync(file) || !statSync(file).isFile()) {
    res.writeHead(404).end("Not found");
    return;
  }
  res.writeHead(200, { "Content-Type": TYPES[extname(file)] ?? "application/octet-stream" }).end(readFileSync(file));
});
await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
const origin = `http://127.0.0.1:${server.address().port}`;

let browser;
try {
  const { chromium } = await import("@playwright/test");
  try {
    browser = await chromium.launch();
  } catch {
    // The cloud image ships Chromium here rather than where Playwright looks.
    browser = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium" });
  }
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1.5, reducedMotion: "reduce" });
  await page.goto(`${origin}/index.html`, { waitUntil: "networkidle" });
  await page.evaluate(() => document.fonts.ready);
  const coverPath = join(outDir, `${name}-cover.png`);
  await page.screenshot({ path: coverPath });
  console.log(`Wrote ${coverPath}  (${(statSync(coverPath).size / 1024).toFixed(0)} KB)`);
} catch (e) {
  console.error(`Zip written, but the cover could not be rendered: ${e instanceof Error ? e.message : e}`);
  console.error("Run `npx playwright install chromium`, or take a 16:10 screenshot of index.html yourself.");
  process.exitCode = 1;
} finally {
  await browser?.close();
  server.close();
}
