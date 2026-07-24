import { HTMLElement, NodeType } from "node-html-parser";
import { Diagnostic, SlotDef } from "../schema";
import { findTokens, imgToken, slotToken, TITLE_TOKEN } from "../tokens";
import { PageSource } from "./inventory";

const INLINE = new Set(["b", "i", "em", "strong", "span", "br", "small"]);
const SKIP = new Set(["script", "style", "title", "noscript"]);

/**
 * Leaf = the element itself isn't inline/skip, EVERY descendant element
 * (at any depth) is inline-only, and it carries ≥3 chars of real (non-token)
 * text. A single level of inline wrapping around a link or image (e.g.
 * `<span><a>...</a></span>`) must not defeat this check — the whole subtree
 * is walked, not just direct children.
 */
export function isSlottableLeaf(el: HTMLElement): boolean {
  const tag = el.rawTagName?.toLowerCase() ?? "";
  if (!tag || SKIP.has(tag) || INLINE.has(tag) || tag === "a") return false;
  for (const desc of el.querySelectorAll("*")) {
    const t = desc.rawTagName?.toLowerCase() ?? "";
    if (!INLINE.has(t)) return false;
  }
  const textOnly = el.text.replace(/\{\{[^}]+\}\}/g, "").trim();
  const anyText = el.text.trim();
  if (anyText.length < 3) return false;
  // pure-token content (e.g. a <p> holding only {{id:phone}}) is identity, not a slot
  if (textOnly.length === 0) return false;
  return true;
}

/** An element's own direct text-node content (not descendant text), tokens stripped. */
const ownFreeText = (el: HTMLElement): string =>
  el.childNodes
    .filter((c) => c.nodeType === NodeType.TEXT_NODE)
    .map((c) => c.text)
    .join("")
    .replace(/\{\{[^}]+\}\}/g, "")
    .trim();

/** True when some descendant element's tag falls outside the inline-allowed set. */
const hasNonInlineDescendant = (el: HTMLElement): boolean =>
  el.querySelectorAll("*").some((d) => !INLINE.has(d.rawTagName?.toLowerCase() ?? ""));

const aspectOf = (w?: string, h?: string): string | undefined => {
  const a = Number(w), b = Number(h);
  if (!a || !b) return undefined;
  const g = (x: number, y: number): number => (y ? g(y, x % y) : x);
  const d = g(a, b);
  return `${a / d}:${b / d}`;
};

export function extractSlots(page: PageSource): { slots: SlotDef[]; titleSample: string; diagnostics: Diagnostic[] } {
  const slots: SlotDef[] = [];
  const diagnostics: Diagnostic[] = [];
  let n = 0;

  const titles = page.root.querySelectorAll("title");
  let titleSample = "";
  if (titles.length === 0) {
    diagnostics.push({
      level: "warn",
      code: "title_missing",
      page: page.file,
      message: `${page.file} has no <title> element`,
    });
    const head = page.root.querySelector("head");
    if (head) head.insertAdjacentHTML("beforeend", `<title>${TITLE_TOKEN}</title>`);
  } else {
    const [first, ...extra] = titles;
    titleSample = first.text;
    first.set_content(TITLE_TOKEN);
    if (extra.length > 0) {
      diagnostics.push({
        level: "warn",
        code: "title_duplicate",
        page: page.file,
        message: `${page.file} has ${titles.length} <title> elements — only the first is kept, the rest removed`,
      });
      for (const t of extra) t.remove();
    }
  }

  for (const el of page.root.querySelectorAll("*")) {
    const tag = el.rawTagName?.toLowerCase() ?? "";
    if (tag === "img") {
      const src = el.getAttribute("src") ?? "";
      if (!src || findTokens(src).length > 0) continue;
      const id = `${page.id}_i${++n}`;
      slots.push({
        id, type: "image", sample: src, html: false,
        aspect: aspectOf(el.getAttribute("width"), el.getAttribute("height")),
      });
      el.setAttribute("src", imgToken(id));
      const alt = el.getAttribute("alt");
      if (alt && findTokens(alt).length === 0) {
        const altId = `${id}_alt`;
        slots.push({ id: altId, type: "text", sample: alt, html: false, max_chars: Math.max(40, Math.ceil(alt.length * 1.5)) });
        el.setAttribute("alt", slotToken(altId));
      } else if (!el.hasAttribute("alt")) {
        diagnostics.push({
          level: "info",
          code: "img_alt_missing",
          page: page.file,
          message: `${src}: <img> has no alt attribute`,
        });
      }
      continue;
    }
    if (!isSlottableLeaf(el)) {
      if (hasNonInlineDescendant(el)) {
        const stray = ownFreeText(el);
        if (stray.length >= 3) {
          diagnostics.push({
            level: "warn",
            code: "stranded_text",
            page: page.file,
            message: `Stranded text near "${stray.slice(0, 40)}" sits outside any slot and won't be editable`,
          });
        }
      }
      continue;
    }
    const sample = el.innerHTML.trim();
    const plain = el.text.trim();
    const id = `${page.id}_s${++n}`;
    slots.push({
      id, type: "text", sample,
      html: sample !== plain,
      max_chars: Math.max(40, Math.ceil(plain.length * 1.5)),
    });
    el.set_content(slotToken(id));
  }

  return { slots, titleSample, diagnostics };
}
