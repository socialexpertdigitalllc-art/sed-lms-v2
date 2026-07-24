import { HTMLElement, NodeType } from "node-html-parser";
import { Diagnostic, SlotDef } from "../schema";
import { findTokens, imgToken, slotToken, TITLE_TOKEN } from "../tokens";
import { PageSource } from "./inventory";

const INLINE = new Set(["b", "i", "em", "strong", "span", "br", "small"]);
const SKIP = new Set(["script", "style", "title", "noscript"]);

/** Leaf = only text/inline children, ≥3 chars of real text, and not itself inline/skip. */
export function isSlottableLeaf(el: HTMLElement): boolean {
  const tag = el.rawTagName?.toLowerCase() ?? "";
  if (!tag || SKIP.has(tag) || INLINE.has(tag) || tag === "a") return false;
  for (const child of el.childNodes) {
    if (child.nodeType === NodeType.ELEMENT_NODE) {
      const t = (child as HTMLElement).rawTagName?.toLowerCase() ?? "";
      if (!INLINE.has(t)) return false;
    }
  }
  const textOnly = el.text.replace(/\{\{[^}]+\}\}/g, "").trim();
  const anyText = el.text.trim();
  if (anyText.length < 3) return false;
  // pure-token content (e.g. a <p> holding only {{id:phone}}) is identity, not a slot
  if (textOnly.length === 0) return false;
  return true;
}

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

  const titleEl = page.root.querySelector("title");
  const titleSample = titleEl?.text ?? "";
  if (titleEl) titleEl.set_content(TITLE_TOKEN);

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
      }
      continue;
    }
    if (!isSlottableLeaf(el)) continue;
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
