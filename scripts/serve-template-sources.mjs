#!/usr/bin/env node
// Serves every website in a folder on its own localhost port, so candidate
// templates can be browsed side by side before they are converted.
//
//   node scripts/serve-template-sources.mjs "C:\My Web Sites\New templates websites"
//   node scripts/serve-template-sources.mjs "<folder>" --port 5600 --open
//
// Each sub-folder is one website. Its root is the shallowest folder (up to 3
// levels down) that holds an index.html, so "site/site/index.html" and
// "site/dist/index.html" both work. Each site gets its own port, so
// root-absolute links like "/css/style.css" resolve as they would online.
// Folders that are source projects (package.json, no built index.html) and
// .zip files are listed with what to do instead. Nothing is installed or
// built, and nothing is written. Ctrl+C stops every server.
//
// Plain Node 18+, no dependencies.
import { createServer } from "node:http";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { extname, join, normalize, relative, resolve, sep } from "node:path";
import { spawn } from "node:child_process";

const args = process.argv.slice(2);
const flag = (name) => args.includes(name);
const option = (name, fallback) => {
  const i = args.indexOf(name);
  return i >= 0 && args[i + 1] ? args[i + 1] : fallback;
};
const WINDOWS_DEFAULT = "C:\\My Web Sites\\New templates websites";
const base = resolve(args.find((a) => !a.startsWith("--") && a !== option("--port", "")) ?? (existsSync(WINDOWS_DEFAULT) ? WINDOWS_DEFAULT : "."));
const firstPort = Number(option("--port", "5501"));
const openBrowser = flag("--open");

if (!existsSync(base) || !statSync(base).isDirectory()) {
  console.error(`Folder not found: ${base}`);
  process.exit(1);
}

const TYPES = {
  ".html": "text/html; charset=utf-8", ".htm": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".mjs": "text/javascript; charset=utf-8",
  ".json": "application/json", ".map": "application/json", ".xml": "application/xml", ".txt": "text/plain; charset=utf-8",
  ".svg": "image/svg+xml", ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".gif": "image/gif",
  ".webp": "image/webp", ".avif": "image/avif", ".ico": "image/x-icon",
  ".woff": "font/woff", ".woff2": "font/woff2", ".ttf": "font/ttf", ".otf": "font/otf", ".eot": "application/vnd.ms-fontobject",
  ".mp4": "video/mp4", ".webm": "video/webm", ".mp3": "audio/mpeg", ".pdf": "application/pdf",
};

const SKIP_DIRS = new Set(["node_modules", ".git", "__MACOSX"]);

/** The shallowest folder (depth ≤ 3) containing index.html, or null. */
function findRoot(dir, depth = 0) {
  if (existsSync(join(dir, "index.html")) || existsSync(join(dir, "index.htm"))) return dir;
  if (depth >= 3) return null;
  const subs = readdirSync(dir, { withFileTypes: true })
    .filter((d) => d.isDirectory() && !SKIP_DIRS.has(d.name) && !d.name.startsWith("."))
    .map((d) => d.name)
    .sort((a, b) => (/^(dist|build|public|out|site|www)$/i.test(a) ? -1 : 0) - (/^(dist|build|public|out|site|www)$/i.test(b) ? -1 : 0) || a.localeCompare(b));
  for (const s of subs) {
    const hit = findRoot(join(dir, s), depth + 1);
    if (hit) return hit;
  }
  return null;
}

function countPages(dir, depth = 0) {
  let n = 0;
  for (const d of readdirSync(dir, { withFileTypes: true })) {
    if (d.isDirectory() && !SKIP_DIRS.has(d.name) && depth < 4) n += countPages(join(dir, d.name), depth + 1);
    else if (/\.html?$/i.test(d.name)) n++;
  }
  return n;
}

const sites = [];
const notes = [];
for (const entry of readdirSync(base, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
  const full = join(base, entry.name);
  if (entry.isFile() && /\.zip$/i.test(entry.name)) {
    notes.push(`  ${entry.name}  — a zip: extract it into its own folder here, then run this again`);
    continue;
  }
  if (!entry.isDirectory() || SKIP_DIRS.has(entry.name) || entry.name.startsWith(".")) continue;
  const root = findRoot(full);
  if (root) {
    sites.push({ name: entry.name, root, pages: countPages(root) });
  } else if (existsSync(join(full, "package.json"))) {
    notes.push(`  ${entry.name}  — a source project (package.json, no built index.html): open a terminal in it and run "npm install" then "npm run dev"`);
  } else {
    notes.push(`  ${entry.name}  — no index.html found (up to 3 folders deep)`);
  }
}
// A folder that is itself one website (index.html directly inside it).
if (!sites.length && findRoot(base) === base) sites.push({ name: base.split(sep).pop(), root: base, pages: countPages(base) });

if (!sites.length) {
  console.error(`No websites found in ${base}`);
  if (notes.length) console.error(notes.join("\n"));
  process.exit(1);
}

function serve(site, port) {
  return new Promise((resolvePort) => {
    const server = createServer((req, res) => {
      let rel;
      try {
        rel = decodeURIComponent(new URL(req.url, "http://localhost").pathname);
      } catch {
        res.writeHead(400).end("Bad request");
        return;
      }
      let file = normalize(join(site.root, rel));
      if (relative(site.root, file).startsWith("..")) {
        res.writeHead(403).end("Forbidden");
        return;
      }
      if (existsSync(file) && statSync(file).isDirectory()) file = join(file, existsSync(join(file, "index.html")) ? "index.html" : "index.htm");
      if (!existsSync(file) && existsSync(file + ".html")) file += ".html"; // pretty URLs: /about -> about.html
      if (!existsSync(file) || !statSync(file).isFile()) {
        res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" }).end(`Not found: ${rel}`);
        return;
      }
      res.writeHead(200, { "Content-Type": TYPES[extname(file).toLowerCase()] ?? "application/octet-stream", "Cache-Control": "no-store" });
      res.end(readFileSync(file));
    });
    server.on("error", (e) => {
      if (e.code === "EADDRINUSE") resolvePort(serve(site, port + 1));
      else throw e;
    });
    server.listen(port, "127.0.0.1", () => resolvePort(port));
  });
}

const rows = [];
let port = firstPort;
for (const site of sites) {
  const used = await serve(site, port);
  rows.push({ ...site, port: used, url: `http://localhost:${used}/` });
  port = used + 1;
}

const pad = (s, n) => String(s).padEnd(n);
const nameWidth = Math.max(4, ...rows.map((r) => r.name.length));
console.log(`\nServing ${rows.length} website${rows.length === 1 ? "" : "s"} from ${base}\n`);
console.log(`  ${pad("#", 3)} ${pad("Site", nameWidth)}  ${pad("URL", 24)} Pages`);
rows.forEach((r, i) => console.log(`  ${pad(i + 1, 3)} ${pad(r.name, nameWidth)}  ${pad(r.url, 24)} ${r.pages}`));
if (notes.length) console.log(`\nNot served:\n${notes.join("\n")}`);
console.log("\nPress Ctrl+C to stop.\n");

if (openBrowser) {
  for (const r of rows) {
    const [cmd, cmdArgs] =
      process.platform === "win32" ? ["cmd", ["/c", "start", "", r.url]] : process.platform === "darwin" ? ["open", [r.url]] : ["xdg-open", [r.url]];
    spawn(cmd, cmdArgs, { stdio: "ignore", detached: true }).unref();
  }
}
