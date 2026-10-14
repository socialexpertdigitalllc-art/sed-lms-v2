// lib/site-agent/brief.ts
/**
 * The SITE MAP handed to the agent with every run: the site's files, each
 * page's sections with line numbers, what scripts render at runtime, and the
 * colour variables. Generated from the workspace files, so it is always true.
 *
 * Why: on 2026-10-14 a two-file colour fix took 12.6 minutes and ~45 tool
 * calls, and a logo + colour fix took ~80. Most of those calls were the agent
 * surveying the site — listing folders, searching for hex colours, reading
 * the 46 KB style.css in pieces again and again. Nearly every request names a
 * section ("the hero", "the header") or a colour, and this map answers
 * "where is it" up front, so the agent can go straight to the lines it must
 * change.
 *
 * Pure and dependency-free: it runs on the worker box against the
 * materialized map, and is unit-tested directly.
 */

const TEXT_EXT = /\.(?:html?|css|js|mjs|json|txt|xml|php|webmanifest)$/i;
const MAX_CHARS = 7000;
const MAX_TEXT_FILES = 40;
const MAX_PAGES = 12;
const MAX_LANDMARKS_PER_PAGE = 24;
const MAX_VARIABLES = 40;
const MAX_COLOURS = 10;

const dec = new TextDecoder();

function kb(bytes: number): string {
  return bytes < 1024 ? `${bytes} B` : `${Math.round(bytes / 1024)} KB`;
}

function textOf(bytes: Uint8Array): string {
  return dec.decode(bytes);
}

const ENTITIES: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " ", "#39": "'" };

/** Site text quoted into the map: entities decoded, whitespace collapsed, and
 *  unable to fake our "---" fences. */
function inert(s: string): string {
  return s
    .replace(/&(amp|lt|gt|quot|apos|nbsp|#39);/g, (_, e: string) => ENTITIES[e])
    .replace(/-{3,}/g, "--")
    .replace(/\s+/g, " ")
    .trim();
}

function lineAt(src: string, index: number): number {
  let line = 1;
  for (let i = 0; i < index; i++) if (src.charCodeAt(i) === 10) line++;
  return line;
}

const fileOrder = (f: string) =>
  f === "index.html" ? 0 : /\.html?$/i.test(f) ? 1 : /\.css$/i.test(f) ? 2 : /\.m?js$/i.test(f) ? 3 : 4;

function filesSection(map: Record<string, Uint8Array>, runtime: Map<string, string[]>): string[] {
  const text = Object.keys(map).filter((f) => TEXT_EXT.test(f))
    .sort((a, b) => fileOrder(a) - fileOrder(b) || a.localeCompare(b));
  const out = ["Files:"];
  for (const f of text.slice(0, MAX_TEXT_FILES)) {
    const src = textOf(map[f]);
    const lines = src.split("\n").length;
    const renders = runtime.get(f);
    out.push(
      `- ${f} — ${kb(map[f].byteLength)}, ${lines} lines` +
        (renders ? ` — builds the ${renders.map((t) => `<${t}>`).join(", ")} at runtime` : ""),
    );
  }
  if (text.length > MAX_TEXT_FILES) out.push(`- …and ${text.length - MAX_TEXT_FILES} more text files`);
  // Images, fonts and the like: counted per folder, never listed one by one.
  const assets = new Map<string, { n: number; ext: Set<string> }>();
  for (const f of Object.keys(map)) {
    if (TEXT_EXT.test(f)) continue;
    const folder = f.includes("/") ? `${f.slice(0, f.lastIndexOf("/"))}/` : "(root)";
    const a = assets.get(folder) ?? { n: 0, ext: new Set<string>() };
    a.n++;
    a.ext.add((f.split(".").pop() ?? "").toLowerCase());
    assets.set(folder, a);
  }
  for (const [folder, a] of [...assets].sort()) {
    out.push(`- ${folder} — ${a.n} other file${a.n === 1 ? "" : "s"} (${[...a.ext].sort().join(", ")})`);
  }
  return out;
}

/** Scripts that write header/nav/footer markup: on these sites the shared
 *  chrome lives in components.js, not in the pages — the #1 thing the agent
 *  used to go looking for. */
function runtimeRenderers(map: Record<string, Uint8Array>): Map<string, string[]> {
  const out = new Map<string, string[]>();
  for (const f of Object.keys(map)) {
    if (!/\.m?js$/i.test(f)) continue;
    const src = textOf(map[f]);
    const tags = ["header", "nav", "footer"].filter((t) => new RegExp(`<${t}[\\s>]`, "i").test(src));
    if (tags.length) out.set(f, tags);
  }
  return out;
}

const LANDMARK = /<(header|nav|main|section|footer|aside)\b([^>]*)>/gi;
const HEADING = /<h([1-4])\b[^>]*>([\s\S]*?)<\/h\1>/i;

function attr(attrs: string, name: string): string | null {
  const m = new RegExp(`\\b${name}\\s*=\\s*(["'])([^"']*)\\1`, "i").exec(attrs);
  return m ? m[2].trim() : null;
}

function pagesSection(map: Record<string, Uint8Array>): string[] {
  const pages = Object.keys(map).filter((f) => /\.html?$/i.test(f))
    .sort((a, b) => fileOrder(a) - fileOrder(b) || a.localeCompare(b));
  const out = ["Pages (line numbers point at each section's opening tag):"];
  for (const f of pages.slice(0, MAX_PAGES)) {
    const src = textOf(map[f]);
    const title = /<title[^>]*>([\s\S]*?)<\/title>/i.exec(src)?.[1];
    out.push(`${f}${title ? ` — "${inert(title).slice(0, 70)}"` : ""}`);
    let count = 0;
    for (const m of src.matchAll(LANDMARK)) {
      if (count >= MAX_LANDMARKS_PER_PAGE) {
        out.push("  …more sections");
        break;
      }
      const id = attr(m[2], "id");
      const cls = attr(m[2], "class")?.split(/\s+/).filter(Boolean).slice(0, 3) ?? [];
      const name = `${m[1].toLowerCase()}${id ? `#${id}` : ""}${cls.map((c) => `.${c}`).join("")}`;
      // The section's own heading, looked for before the next landmark opens.
      const after = src.slice(m.index! + m[0].length, m.index! + m[0].length + 4000);
      const nextLandmark = after.search(/<(header|nav|main|section|footer|aside)\b/i);
      const scope = nextLandmark >= 0 ? after.slice(0, nextLandmark) : after;
      const heading = HEADING.exec(scope)?.[2].replace(/<[^>]+>/g, " ");
      const empty = /^\s*<\/(header|nav|footer)>/i.test(after) ? " (empty — filled at runtime)" : "";
      out.push(`  L${lineAt(src, m.index!)} ${name}${heading ? ` — "${inert(heading).slice(0, 60)}"` : ""}${empty}`);
      count++;
    }
    if (!count) out.push("  (no header/section/footer tags)");
  }
  if (pages.length > MAX_PAGES) out.push(`…and ${pages.length - MAX_PAGES} more pages`);
  return out;
}

/** A colour value we list: hex, rgb(a), hsl(a) or a named colour (not a
 *  shadow, a gradient or a size). */
const COLOUR_VALUE = /^(?:#[0-9a-f]{3,8}\b|rgba?\(|hsla?\(|[a-z]+$)/i;
/** Shades computed from another variable: change the base, never these. */
const DERIVED = /color-mix\(|var\(--/i;

interface ThemeVar { name: string; value: string; file: string; line: number; note: string | null }

function themeVariables(f: string, src: string): ThemeVar[] {
  const out: ThemeVar[] = [];
  // CSS syntax, in stylesheets AND in scripts that inject a <style> at runtime
  // (the generated sites' SITE_THEME), with any same-line comment:
  //   --accent-warm: #B85D19;   /* ACCENT — buttons, highlights, icons */
  for (const m of src.matchAll(/(--[\w-]+)\s*:\s*([^;{}\n]+);?[ \t]*(?:\/\*\s*([^*\n]*?)\s*\*\/)?/g)) {
    out.push({ name: m[1], value: m[2].trim(), file: f, line: lineAt(src, m.index!), note: m[3] ?? null });
  }
  // JS object syntax: { '--accent': '#B85D19' }.
  if (/\.m?js$/i.test(f)) {
    for (const m of src.matchAll(/["'](--[\w-]+)["']\s*:\s*["']([^"']+)["']/g)) {
      out.push({ name: m[1], value: m[2].trim(), file: f, line: lineAt(src, m.index!), note: null });
    }
  }
  return out;
}

function themeSection(map: Record<string, Uint8Array>): string[] {
  const counts = new Map<string, { n: number; files: Set<string> }>();
  // Scripts first: a theme a script injects at runtime overrides the stylesheet.
  const sources = Object.keys(map).filter((f) => /\.(?:css|m?js|html?)$/i.test(f))
    .sort((a, b) => Number(!/\.m?js$/i.test(a)) - Number(!/\.m?js$/i.test(b)) || fileOrder(a) - fileOrder(b) || a.localeCompare(b));
  const listed: string[] = [];
  const injected = new Set<string>();
  let derived = 0;
  const seen = new Set<string>();
  for (const f of sources) {
    const src = textOf(map[f]);
    for (const v of themeVariables(f, src)) {
      const key = `${f}|${v.name}`;
      if (seen.has(key)) continue;
      seen.add(key);
      const font = /font/i.test(v.name);
      if (DERIVED.test(v.value)) {
        if (!font) derived++;
        continue;
      }
      if (!font && !COLOUR_VALUE.test(v.value)) continue;
      if (/\.m?js$/i.test(f)) injected.add(f);
      if (listed.length < MAX_VARIABLES) {
        listed.push(
          `- ${v.name}: ${inert(v.value).slice(0, 48)}${v.note ? `  /* ${inert(v.note).slice(0, 50)} */` : ""} (${f} L${v.line})`,
        );
      }
    }
    for (const m of src.matchAll(/#[0-9a-f]{6}\b|#[0-9a-f]{3}\b/gi)) {
      const hex = m[0].toLowerCase();
      const c = counts.get(hex) ?? { n: 0, files: new Set<string>() };
      c.n++;
      c.files.add(f);
      counts.set(hex, c);
    }
  }
  const out: string[] = [];
  if (listed.length) {
    out.push("Colour and font variables:");
    out.push(...listed);
    for (const f of injected) {
      out.push(`  ${f} injects its variables into the page at runtime, so they override the same names in the CSS — change colours there first.`);
    }
    if (derived) out.push(`  (+${derived} shades derived from these with color-mix()/var() — change the base colours, not the shades.)`);
  }
  const top = [...counts].sort((a, b) => b[1].n - a[1].n).slice(0, MAX_COLOURS);
  if (top.length) {
    out.push("Most-used hard-coded hex colours:");
    out.push(...top.map(([hex, c]) => `- ${hex} ×${c.n} (${[...c.files].join(", ")})`));
  }
  return out;
}

/** The site map for `map` (path → bytes), at most ~7,000 characters. */
export function buildSiteBrief(map: Record<string, Uint8Array>): string {
  const runtime = runtimeRenderers(map);
  const parts = [filesSection(map, runtime), pagesSection(map), themeSection(map)].map((s) => s.join("\n"));
  let brief = parts.filter(Boolean).join("\n\n");
  if (brief.length > MAX_CHARS) brief = `${brief.slice(0, MAX_CHARS)}\n…(map cut short — search for anything not listed)`;
  return brief;
}
