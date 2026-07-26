import { parse, type HTMLElement } from "node-html-parser";
import { PageDef, ContentDocPage } from "../schema";
import { escapeHtml, fillSlot, imgToken, slotToken } from "../tokens";

/**
 * Marks the element that renders one Content Document PAGE — the value is
 * the page's INDEX in `doc.pages` (same index as `renderSite`'s internal
 * `built` array), NOT its `page_id` and NOT the manifest def id. A stamped
 * fan-out page (a services/areas hub duplicated per row) shares a `page_id`
 * with the page it was stamped from but has its own doc index, and an edit
 * made from the preview must land on THAT doc entry — so the index is what
 * gets stamped, never the id.
 */
export const PAGE_ATTR = "data-ss-page";

/**
 * Marks the element that carries one content slot's value. The value is
 * `"${docPageIndex}:${slotId}"` — the SAME key format already used by 3b's
 * `SlotImageState` (see `lib/site-studio/run/types.ts`), the `/images`
 * route, and `ImagePicker`. Task 7 reuses `ImagePicker` unmodified because
 * this format is identical everywhere it appears — do not invent a
 * different one here.
 */
export const SLOT_ATTR = "data-ss-slot";

/** Marks the `<img>` element itself, in addition to `SLOT_ATTR`, so the
 *  preview shell can tell an image slot from a text slot without re-deriving
 *  it from the manifest on every click. */
export const IMAGE_ATTR = "data-ss-image";

export interface RenderOptions {
  /**
   * Emit preview-only `SLOT_ATTR`/`PAGE_ATTR`/`IMAGE_ATTR` markers instead of
   * plain substitution. MUST default to false wherever this is consumed —
   * every deployed client site is rendered by the same `renderSite()`, and
   * annotation must never leak into it. See renderer.ts's byte-equality
   * guarantee and tests/siteStudioAnnotate.test.ts.
   */
  annotate?: boolean;
}

/**
 * Applies one page's text/image slots to its (nav + repeat already
 * substituted) skeleton HTML — computing the exact same values the
 * production path in renderer.ts computes (same `fillSlot`/`escapeHtml`) —
 * but ALSO marks each slot's element, and the page root, so the editable
 * preview can find them. Only ever called when `opts.annotate` is true;
 * the production branch in renderer.ts never imports this module's DOM
 * machinery into its own code path, so nothing here can affect it.
 *
 * MECHANISM: renderSite's production path is plain string substitution
 * (`html.split(token).join(value)`) — it never parses the skeleton into a
 * DOM. Locating "the element enclosing this token" therefore needs a real
 * parse, so this function parses the skeleton with `node-html-parser`
 * (already a dependency, used throughout `lib/site-studio/compiler/`,
 * including to serialize the very skeletons stored in `tpl.pages` — see
 * `compiler/compile.ts`'s `page.root.toString()`), mutates real element
 * nodes, and re-serializes with `.toString()`.
 *
 * PLACEMENT, per slot:
 *  - image: the token is always the WHOLE `src` attribute value written by
 *    the compiler's `extractSlots()` — unambiguous — so `SLOT_ATTR` and
 *    `IMAGE_ATTR` go directly on the `<img>`. No markup added.
 *  - text, "element" case: `extractSlots()` always writes a leaf text
 *    slot's token as the ENTIRE content of its element (`el.set_content(...)`
 *    at compile time) — so when an element's `innerHTML` is exactly the
 *    token, `SLOT_ATTR` goes directly on that real element. No markup added.
 *  - text, "attribute" case: the one other place `extractSlots()` writes a
 *    text-slot token is an `<img>`'s `alt` attribute. That's unambiguous
 *    too, but the SAME `<img>` may already carry `SLOT_ATTR` for its OWN
 *    image slot (previous case) — one attribute name can't hold two values.
 *    Rather than emit an invalid duplicate attribute, this inserts an
 *    adjacent, EMPTY, hidden `<span>` carrying `SLOT_ATTR` for the alt key.
 *    Empty means it can never add visible text (an empty element strips to
 *    nothing), and `hidden` keeps it out of layout.
 *  - text, "wrap" case (fallback — not produced by this compiler today, but
 *    a hand-authored manifest or a future template shape could position a
 *    token amid other text/markup): the substituted value is wrapped in
 *    `<span data-ss-slot="…">…</span>` via the same plain string
 *    `.split(token).join(...)` mechanism the production renderer uses.
 *
 *    WRAPPER TRADEOFF: this is the one case that changes the page's DOM
 *    shape at all — a wrapper `<span>` can shift `:first-child` or
 *    direct-child (`>`) CSS selectors that assume the slot's original
 *    element is a direct, unwrapped child of its parent. That is exactly
 *    why annotation is preview-only, and why the production `renderSite()`
 *    path never reaches this file: a deployed client site must never carry
 *    that risk.
 */
export function annotatePageHtml(
  html: string,
  def: PageDef,
  page: ContentDocPage,
  docPageIndex: number,
): string {
  const root = parse(html);
  const key = (slotId: string) => `${docPageIndex}:${slotId}`;

  const pageRoot =
    root.querySelector("body") ??
    root.querySelector("html") ??
    (root.querySelectorAll("*")[0] as HTMLElement | undefined);
  pageRoot?.setAttribute(PAGE_ATTR, String(docPageIndex));

  const handled = new Set<string>();

  // Images first: unambiguous (the token is the whole `src`), and doing
  // this before text slots means an alt-text slot on the SAME <img>
  // (handled below) can see that the element already carries SLOT_ATTR for
  // the image itself, and route itself to the adjacent-span case instead.
  for (const s of def.slots) {
    if (s.type !== "image") continue;
    const token = imgToken(s.id);
    const img = root.querySelectorAll("img").find((el) => el.getAttribute("src") === token);
    if (!img) continue;
    img.setAttribute("src", escapeHtml(page.slots[s.id] ?? ""));
    img.setAttribute(SLOT_ATTR, key(s.id));
    img.setAttribute(IMAGE_ATTR, "");
    handled.add(s.id);
  }

  for (const s of def.slots) {
    if (s.type === "image") continue;
    const token = slotToken(s.id);
    const value = fillSlot(page.slots[s.id] ?? "", s.sample, s.html);

    // "element" case: the token is the WHOLE content of one element.
    const el = root.querySelectorAll("*").find((e) => e.innerHTML === token);
    if (el) {
      el.setAttribute(SLOT_ATTR, key(s.id));
      el.set_content(value);
      handled.add(s.id);
      continue;
    }

    // "attribute" case: the token is the WHOLE value of one attribute
    // (today, only an <img alt="…">) on an element already spoken for.
    let attrOwner: HTMLElement | undefined;
    let attrName: string | undefined;
    for (const e of root.querySelectorAll("*")) {
      const attrs = e.attributes;
      const found = Object.keys(attrs).find((k) => attrs[k] === token);
      if (found) { attrOwner = e; attrName = found; break; }
    }
    if (attrOwner && attrName) {
      attrOwner.setAttribute(attrName, value);
      attrOwner.insertAdjacentHTML("afterend", `<span ${SLOT_ATTR}="${key(s.id)}" hidden></span>`);
      handled.add(s.id);
      continue;
    }
    // else: "wrap" case, resolved below after serialization.
  }

  let out = root.toString();
  for (const s of def.slots) {
    if (s.type === "image" || handled.has(s.id)) continue;
    const token = slotToken(s.id);
    const value = fillSlot(page.slots[s.id] ?? "", s.sample, s.html);
    out = out.split(token).join(`<span ${SLOT_ATTR}="${key(s.id)}">${value}</span>`);
  }
  return out;
}
