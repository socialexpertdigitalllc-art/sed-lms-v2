import { parse } from "node-html-parser";

export const idToken = (key: string) => `{{id:${key}}}`;
export const slotToken = (id: string) => `{{slot:${id}}}`;
export const imgToken = (id: string) => `{{img:${id}}}`;
export const linkToken = (pageId: string) => `{{link:${pageId}}}`;
export const TITLE_TOKEN = "{{title}}";
export const NAV_TITLE = "{{nav:title}}";
export const NAV_HREF = "{{nav:href}}";
export const repeatMarker = (id: string) => `<!--@repeat:${id}-->`;
export const navMarker = (id: string) => `<!--@nav:${id}-->`;

export interface FoundToken { kind: string; key: string; raw: string }

const TOKEN_RE = /\{\{(id|slot|img|link|title)(?::([A-Za-z0-9_./-]+))?\}\}|\{\{nav:(title|href)\}\}|<!--@(repeat|nav):([A-Za-z0-9_-]+)-->/g;

/** Every token/marker occurrence in a string (markers report kind "repeat"/"nav"). */
export function findTokens(s: string): FoundToken[] {
  const out: FoundToken[] = [];
  for (const m of s.matchAll(TOKEN_RE)) {
    if (m[1]) out.push({ kind: m[1], key: m[2] ?? "", raw: m[0] });
    else if (m[3]) out.push({ kind: `nav_${m[3]}`, key: "", raw: m[0] });
    else out.push({ kind: m[4], key: m[5], raw: m[0] });
  }
  return out;
}

export function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}

// Plain text-node escaping: & < > only. Slot values land inside element text
// content (not attributes), so quotes/apostrophes need no escaping there —
// unlike escapeHtml above, which also escapes them for attribute-safety and
// is used for identity/title/image-src/attribute contexts.
export const escapeText = (s: string): string =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

/** Shared by the production renderer and the annotated-build path (see
 *  render/annotate.ts) so both compute a slot's rendered value identically. */
export const fillSlot = (value: string, sample: string, html: boolean): string =>
  html ? (value === sample ? value : sanitizeInline(value)) : escapeText(value);

const INLINE_ALLOWED = new Set(["b", "i", "em", "strong", "br", "span", "small"]);

/** Strip all markup except harmless inline formatting; text is preserved. */
export function sanitizeInline(s: string): string {
  const root = parse(s);
  const walk = (node: any): string => {
    if (node.nodeType === 3) return escapeHtml(node.text);
    const tag = (node.rawTagName ?? "").toLowerCase();
    const inner = node.childNodes.map(walk).join("");
    if (tag && INLINE_ALLOWED.has(tag)) return tag === "br" ? "<br>" : `<${tag}>${inner}</${tag}>`;
    return inner;
  };
  return root.childNodes.map(walk).join("");
}
