import type { EditOp } from "./types";

const MAX_OPS = 200;

/**
 * Robustly extract edit ops from raw LLM output.
 * Accepts `{ "ops": [...] }` or a bare array, with or without ```json fences
 * and surrounding prose. Entries without non-empty string find/replace are dropped.
 */
export function parseOps(text: string): EditOp[] {
  if (!text) return [];
  let t = String(text).trim();

  const fenced = t.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fenced) t = fenced[1].trim();

  const objIdx = t.indexOf("{");
  const arrIdx = t.indexOf("[");
  let start = -1;
  if (objIdx === -1) start = arrIdx;
  else if (arrIdx === -1) start = objIdx;
  else start = Math.min(objIdx, arrIdx);
  if (start === -1) return [];
  t = t.slice(start);

  let parsed: unknown;
  try {
    parsed = JSON.parse(t);
  } catch {
    const end = Math.max(t.lastIndexOf("}"), t.lastIndexOf("]"));
    if (end === -1) return [];
    try {
      parsed = JSON.parse(t.slice(0, end + 1));
    } catch {
      return [];
    }
  }

  const rawOps: unknown[] = Array.isArray(parsed)
    ? parsed
    : parsed && typeof parsed === "object" && Array.isArray((parsed as { ops?: unknown }).ops)
      ? ((parsed as { ops: unknown[] }).ops)
      : [];

  const ops: EditOp[] = [];
  for (const item of rawOps) {
    if (ops.length >= MAX_OPS) break;
    if (!item || typeof item !== "object") continue;
    const rec = item as Record<string, unknown>;
    if (typeof rec.find !== "string" || rec.find.length === 0) continue;
    if (typeof rec.replace !== "string" || rec.replace.length === 0) continue;
    const file = typeof rec.file === "string" && rec.file.trim().length > 0 ? rec.file.trim() : undefined;
    ops.push(file ? { file, find: rec.find, replace: rec.replace } : { find: rec.find, replace: rec.replace });
  }
  return ops;
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Apply ops sequentially on the evolving html.
 * Exact indexOf replacement first (first occurrence); if the find string is not
 * present verbatim, retry with a whitespace-normalized fuzzy match (runs of
 * whitespace match any whitespace). Ops that still miss are returned.
 */
export function applyOps(html: string, ops: EditOp[]): { html: string; applied: number; missed: EditOp[] } {
  let out = html;
  let applied = 0;
  const missed: EditOp[] = [];

  for (const op of ops) {
    const idx = out.indexOf(op.find);
    if (idx !== -1) {
      out = out.slice(0, idx) + op.replace + out.slice(idx + op.find.length);
      applied++;
      continue;
    }

    const pattern = escapeRegExp(op.find).replace(/\s+/g, "\\s+");
    let matched = false;
    try {
      const match = new RegExp(pattern).exec(out);
      if (match) {
        out = out.slice(0, match.index) + op.replace + out.slice(match.index + match[0].length);
        applied++;
        matched = true;
      }
    } catch {
      // fall through to missed
    }
    if (!matched) missed.push(op);
  }

  return { html: out, applied, missed };
}

const IMAGE_REF_RE = /\.(png|jpe?g|webp|gif|svg|avif)$/i;

function isExternalRef(ref: string): boolean {
  const low = ref.toLowerCase();
  return (
    low.startsWith("http://") ||
    low.startsWith("https://") ||
    low.startsWith("//") ||
    low.startsWith("data:") ||
    low.startsWith("#") ||
    low.startsWith("mailto:") ||
    low.startsWith("tel:")
  );
}

/**
 * Scan generated text files for image references that point at files we do not
 * ship (template leftovers). HTML files: src/href on <img>/<source> tags plus
 * inline url(...); CSS files: url(...). External (http/https/data) refs are ignored.
 * Returns unique "file: ref" strings.
 */
export function residualImageRefs(textFiles: Record<string, string>, availableImages: Set<string>): string[] {
  const out: string[] = [];
  const seen = new Set<string>();

  for (const [file, content] of Object.entries(textFiles)) {
    const lower = file.toLowerCase();
    const isHtml = lower.endsWith(".html") || lower.endsWith(".htm");
    const isCss = lower.endsWith(".css");
    if (!isHtml && !isCss) continue;

    const refs: string[] = [];

    if (isHtml) {
      const tagRe = /<(?:img|source)\b[^>]*>/gi;
      let tag: RegExpExecArray | null;
      while ((tag = tagRe.exec(content))) {
        const attrRe = /(?:src|href)\s*=\s*(?:"([^"]*)"|'([^']*)')/gi;
        let attr: RegExpExecArray | null;
        while ((attr = attrRe.exec(tag[0]))) refs.push(attr[1] ?? attr[2] ?? "");
      }
    }

    // url(...) in css files and inline styles in html
    const urlRe = /url\(\s*(?:"([^"]*)"|'([^']*)'|([^)"']+))\s*\)/gi;
    let url: RegExpExecArray | null;
    while ((url = urlRe.exec(content))) refs.push((url[1] ?? url[2] ?? url[3] ?? "").trim());

    for (const ref of refs) {
      if (!ref || isExternalRef(ref)) continue;
      const clean = ref.split(/[?#]/)[0];
      if (!IMAGE_REF_RE.test(clean)) continue;
      const basename = clean.split("/").pop() ?? clean;
      if (availableImages.has(basename) || availableImages.has(clean) || availableImages.has(clean.replace(/^\.\//, ""))) continue;
      const entry = `${file}: ${ref}`;
      if (!seen.has(entry)) {
        seen.add(entry);
        out.push(entry);
      }
    }
  }

  return out;
}
