// Template Engine v2 — translatable-text extraction for HTML.
//
// WHY THIS EXISTS. The original personalisation path sent a whole template file
// (up to ~100KB of markup) to the model and demanded the whole file back with
// every tag, class, id, data-* and JS identifier reproduced exactly. That only
// survives on a top-tier long-output model: routed at a small/cheap one the
// output collapsed (`circle: 8 -> 0`, `svg: 19 -> 11`) and the demo business's
// name and phone number came back untouched.
//
// So the markup never goes to the model any more. This module pulls out ONLY
// the strings a human reads, hands back a stable id per string, and reassembles
// by splicing the replacements back into the ORIGINAL source at the original
// byte offsets. The model cannot damage what it never sees, and the structure
// gate becomes a cheap safety net instead of the thing that fails.
//
// THE ROUND-TRIP GUARANTEE. `apply` never re-serialises the document — it
// splices. An item whose replacement equals its extracted text is written back
// as the ORIGINAL raw slice, byte for byte, entities and quoting intact. So
// `apply({})` and `apply(identityMap)` both return the input unchanged, for any
// input: doctype, comments, void tags, SVG, <script> bodies and all.

import { parse, type HTMLElement, type Node } from "node-html-parser";

/** What kind of string this is — drives how it is escaped and whether the model sees it. */
export type TextKind =
  /** A visible text node. */
  | "text"
  /** A <title> element's text (document or SVG). */
  | "title"
  /** alt / title / placeholder / aria-label. */
  | "attr"
  /** <meta name="description|keywords"> / <meta property="og:*"> content. */
  | "meta"
  /** A mailto:/tel: href — deterministic substitution only, never model-rewritten. */
  | "contact";

export interface TextItem {
  /** Stable within one extraction; the key the model answers with. */
  id: string;
  kind: TextKind;
  /** Entity-decoded text, ready to show a model. */
  text: string;
  /** Where it came from, e.g. `h1`, `img[alt]`, `meta:description`. */
  context?: string;
}

export interface ExtractedText {
  items: TextItem[];
  /**
   * Splice replacements back in by id and return the document. Ids the map does
   * not mention — and values that are not non-empty strings — keep their
   * original text: an omission can never blank a string.
   */
  apply(map: Record<string, string | undefined | null>): string;
}

/** How a slot's replacement must be escaped when it is written back. */
export type Escape = "text" | "double" | "single";

interface Slot {
  id: string;
  kind: TextKind;
  text: string;
  context?: string;
  start: number;
  end: number;
  escape: Escape;
}

/** Raw-text elements: their content is code, never copy. */
const OPAQUE_TAGS = new Set(["script", "style", "noscript"]);

/** Attributes that hold human-readable text on any element. */
const TEXT_ATTRS = ["alt", "title", "placeholder", "aria-label"] as const;

/** <meta name="..."> values whose `content` is copy. */
const META_NAMES = new Set(["description", "keywords"]);

const CONTACT_HREF_RE = /^(?:mailto:|tel:)/i;

const NAMED_ENTITIES: Record<string, string> = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
  nbsp: " ",
  "#39": "'",
  "#x27": "'",
};

/**
 * Decode the entity forms a template actually contains. Unknown entities are
 * left verbatim — an item whose text still reads `&hellip;` round-trips fine,
 * because an unchanged item is written back from the original slice anyway.
 */
export function decodeEntities(s: string): string {
  return s.replace(/&(#x?[0-9a-fA-F]+|[a-zA-Z][a-zA-Z0-9]*);/g, (whole, name: string) => {
    const key = name.toLowerCase();
    if (key in NAMED_ENTITIES) return NAMED_ENTITIES[key];
    if (key.startsWith("#x")) {
      const code = Number.parseInt(key.slice(2), 16);
      return Number.isFinite(code) && code > 0 ? String.fromCodePoint(code) : whole;
    }
    if (key.startsWith("#")) {
      const code = Number.parseInt(key.slice(1), 10);
      return Number.isFinite(code) && code > 0 ? String.fromCodePoint(code) : whole;
    }
    return whole;
  });
}

/** Escape a replacement for the position it is written into. Exported for the image pass. */
export function escapeFor(mode: Escape, value: string): string {
  const base = value.replace(/&/g, "&amp;");
  if (mode === "text") return base.replace(/</g, "&lt;").replace(/>/g, "&gt;");
  if (mode === "double") return base.replace(/"/g, "&quot;");
  return base.replace(/'/g, "&#39;");
}

function hasLetter(s: string): boolean {
  return /\p{L}/u.test(s);
}

/** A bare phone number: no letters, but very much the demo identity. */
const PHONE_ISH_RE = /\d[\d\s().+-]{5,}\d/;

/**
 * Is this string worth extracting? Anything without a letter is a number, a
 * symbol run or layout — "24/7", "—", "5.0", "1200" — and rewriting it can only
 * do harm. The ONE exception is a bare phone number: it carries no letter and
 * is exactly what the leak gate fails a build over, so it must be reachable by
 * the deterministic identity pass. (It never reaches the model: personalize.ts
 * only sends strings that contain letters.)
 */
function isCopyworthy(s: string): boolean {
  return hasLetter(s) || PHONE_ISH_RE.test(s);
}

/**
 * Absolute [start,end) of an attribute's VALUE, plus the quote style.
 * Exported so the deterministic image pass can splice src/srcset the same way.
 */
export function attrValueRange(
  html: string,
  el: HTMLElement,
  name: string,
): { start: number; end: number; escape: Escape } | null {
  const rawAttrs = el.rawAttrs;
  if (!rawAttrs) return null;
  const base = html.indexOf(rawAttrs, el.range[0]);
  if (base < 0) return null;
  const re = new RegExp(`(^|[\\s/])(${name})\\s*=\\s*("([^"]*)"|'([^']*)')`, "i");
  const m = re.exec(rawAttrs);
  if (!m) return null; // unquoted or absent — not worth rewriting
  const quoted = m[3]; // includes both quote characters; always ends the match
  const start = base + m.index + (m[0].length - quoted.length) + 1;
  return { start, end: start + quoted.length - 2, escape: quoted[0] === '"' ? "double" : "single" };
}

/** Leading / trailing whitespace lengths, so indentation is never sent or rewritten. */
function trimBounds(raw: string): { lead: number; tail: number } {
  const lead = raw.length - raw.trimStart().length;
  const tail = raw.length - raw.trimEnd().length;
  return { lead, tail };
}

const TEXT_NODE = 3;

/**
 * Pull every translatable string out of `html`.
 *
 * EXTRACTED: visible text nodes; `alt`/`title`/`placeholder`/`aria-label`;
 * `<title>`; `<meta name="description|keywords">` and `<meta property="og:*">`
 * content; and `href` values that are `mailto:` or `tel:`.
 *
 * NEVER EXTRACTED: <script>/<style>/<noscript> bodies (jsStrings.ts handles JS),
 * class/id/data-* values, any other structural attribute, and every URL that is
 * not mailto:/tel:. Whitespace-only nodes and strings with no letter in them are
 * skipped — they are punctuation, digits or layout, not copy.
 */
export function extractTranslatable(html: string): ExtractedText {
  const root = parse(html);
  const slots: Slot[] = [];
  let n = 0;
  const nextId = () => `t${++n}`;

  const pushText = (kind: TextKind, text: string, start: number, end: number, context: string) => {
    if (end <= start) return;
    slots.push({ id: nextId(), kind, text, context, start, end, escape: "text" });
  };

  const visitAttrs = (el: HTMLElement) => {
    const tag = (el.rawTagName ?? "").toLowerCase();

    for (const attr of TEXT_ATTRS) {
      const raw = el.getAttribute(attr);
      if (raw === undefined || raw === null) continue;
      const value = decodeEntities(raw).trim();
      if (!value || !isCopyworthy(value)) continue;
      const range = attrValueRange(html, el, attr);
      if (!range) continue;
      slots.push({
        id: nextId(),
        kind: "attr",
        text: value,
        context: `${tag}[${attr}]`,
        start: range.start,
        end: range.end,
        escape: range.escape,
      });
    }

    if (tag === "meta") {
      const name = (el.getAttribute("name") ?? "").toLowerCase();
      const property = (el.getAttribute("property") ?? "").toLowerCase();
      const wanted = META_NAMES.has(name) || property.startsWith("og:");
      if (wanted) {
        const raw = el.getAttribute("content");
        const value = raw ? decodeEntities(raw).trim() : "";
        const range = value && isCopyworthy(value) ? attrValueRange(html, el, "content") : null;
        if (range) {
          slots.push({
            id: nextId(),
            kind: "meta",
            text: value,
            context: `meta:${name || property}`,
            start: range.start,
            end: range.end,
            escape: range.escape,
          });
        }
      }
    }

    if (tag === "a") {
      const href = el.getAttribute("href") ?? "";
      if (CONTACT_HREF_RE.test(href.trim())) {
        const range = attrValueRange(html, el, "href");
        if (range) {
          slots.push({
            id: nextId(),
            kind: "contact",
            text: decodeEntities(href).trim(),
            context: "a[href]",
            start: range.start,
            end: range.end,
            escape: range.escape,
          });
        }
      }
    }
  };

  const walk = (node: Node, parentTag: string | null) => {
    if (node.nodeType === TEXT_NODE) {
      // A text node with no element parent is the doctype (or stray top-level
      // text) — never copy. Raw-text elements hold code, not prose.
      if (!parentTag || OPAQUE_TAGS.has(parentTag)) return;
      const raw = html.slice(node.range[0], node.range[1]);
      const { lead, tail } = trimBounds(raw);
      const inner = raw.slice(lead, raw.length - tail);
      if (!inner) return;
      const text = decodeEntities(inner);
      if (!isCopyworthy(text)) return;
      pushText(parentTag === "title" ? "title" : "text", text, node.range[0] + lead, node.range[1] - tail, parentTag);
      return;
    }
    const el = node as HTMLElement;
    const tag = (el.rawTagName ?? "").toLowerCase();
    if (tag) {
      if (OPAQUE_TAGS.has(tag)) return; // do not descend into code
      visitAttrs(el);
    }
    for (const child of el.childNodes ?? []) walk(child, tag || null);
  };

  walk(root, null);
  slots.sort((a, b) => a.start - b.start);

  const items: TextItem[] = slots.map((s) => ({ id: s.id, kind: s.kind, text: s.text, context: s.context }));

  return {
    items,
    apply(map) {
      let out = "";
      let cursor = 0;
      for (const slot of slots) {
        if (slot.start < cursor) continue; // overlapping slot — impossible, but never corrupt output
        out += html.slice(cursor, slot.start);
        const next = map[slot.id];
        const changed = typeof next === "string" && next.trim().length > 0 && next !== slot.text;
        // Unchanged (or omitted, or blank) => the ORIGINAL slice, byte for byte.
        out += changed ? escapeFor(slot.escape, next) : html.slice(slot.start, slot.end);
        cursor = slot.end;
      }
      return out + html.slice(cursor);
    },
  };
}
