import { parse, type HTMLElement } from "node-html-parser";
import { PageDef, ContentDocPage, SlotDef } from "../schema";
import { escapeHtml, fillSlotValue, imgToken, slotToken } from "../tokens";

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
 * Marks the element that carries one content slot's value.
 *
 *  - A page-level slot's key is `"${docPageIndex}:${slotId}"` — the SAME
 *    key format already used by 3b's `SlotImageState` (see
 *    `lib/site-studio/run/types.ts`), the `/images` route, and
 *    `ImagePicker`. Task 7 reuses `ImagePicker` unmodified because this
 *    format is identical everywhere it appears.
 *  - A REPEAT ROW slot's key is `"${docPageIndex}:${repeatId}#${rowIndex}:${slotId}"`
 *    — the same leading `docPageIndex:` segment (so anything that only needs
 *    "which doc page" can split on the first `:` uniformly for both shapes),
 *    then the repeat id, then a `#`-separated `rowIndex:slotId` pair. `#` is
 *    the delimiter because a plain page-level key never contains one, so a
 *    consumer can always tell the two shapes apart with a single
 *    `key.includes("#")` check before deciding how to parse the rest. This
 *    is a NEW string this phase introduces — repeats had no preview story
 *    before it — so Task 7's click handler and the `PATCH /content` route
 *    are the first and only consumers and must both parse it this way.
 */
export const SLOT_ATTR = "data-ss-slot";

/** Marks the `<img>` element itself, in addition to `SLOT_ATTR`, so the
 *  preview shell can tell an image slot from a text slot without re-deriving
 *  it from the manifest on every click. */
export const IMAGE_ATTR = "data-ss-image";

/**
 * Marks an element carrying an ATTRIBUTE-BOUND text slot's key (today, only
 * an `<img>`'s alt text — see `SlotDef.attr`, set by `compiler/slots.ts`).
 * Kept separate from `SLOT_ATTR` deliberately: the element usually already
 * carries `SLOT_ATTR`/`IMAGE_ATTR` for its OWN image slot, so a second,
 * differently-named attribute is the only way to mark both without
 * colliding — and editing "this image's alt text" is a distinct action from
 * editing "this image" (Task 7 offers it as a secondary action from the
 * image click), so keeping them addressable separately is the right shape
 * even where there's no collision. No extra DOM node is inserted for this —
 * it lives on the `<img>` itself. Same key format as `SLOT_ATTR`.
 */
export const ALT_ATTR = "data-ss-alt";

export interface RenderOptions {
  /**
   * Emit preview-only `SLOT_ATTR`/`PAGE_ATTR`/`IMAGE_ATTR`/`ALT_ATTR` markers
   * instead of plain substitution. MUST default to false wherever this is
   * consumed — every deployed client site is rendered by the same
   * `renderSite()`, and annotation must never leak into it. See renderer.ts's
   * byte-equality guarantee and tests/siteStudioAnnotate.test.ts.
   */
  annotate?: boolean;
}

/**
 * Marks every text/image slot's element in an already-parsed root, in
 * place, and returns the set of slot ids for which it found and annotated a
 * real element directly (a `type:"image"` slot is always included; a
 * `type:"text"` slot is included only when its element or attribute was
 * found — the caller is responsible for the "wrap" fallback for anything
 * left out).
 *
 * Shared between page-level annotation (`annotatePageHtml`) and per-row
 * repeat annotation (`annotateRepeatRow`) so both compute placement
 * identically — the same three cases apply at either scope:
 *
 *  - image: the token is always the WHOLE `src` attribute value written by
 *    the compiler's `extractSlots()` — unambiguous — so `SLOT_ATTR` and
 *    `IMAGE_ATTR` go directly on the `<img>`. No markup added.
 *  - text, attribute-bound (`slot.attr` set, e.g. an `<img>`'s `alt`): the
 *    token is the WHOLE value of that attribute — unambiguous — so the
 *    resolved value replaces it in place and `ALT_ATTR` (never `SLOT_ATTR`;
 *    see that constant's own note) goes on the same element. No markup
 *    added, no extra DOM node inserted.
 *  - text, element-bound: `extractSlots()`/`extractRepeats()` both always
 *    write a leaf text slot's token as the ENTIRE content of its element
 *    (`el.set_content(...)` at compile time) — so when an element's
 *    `innerHTML` is exactly the token, `SLOT_ATTR` goes directly on that
 *    real element. No markup added.
 *
 * Anything not resolved here (not produced by this compiler today, but a
 * hand-authored manifest or a future template shape could position a token
 * amid other text/markup) is left as a bare token in the DOM for the caller
 * to wrap after serialization — see the "wrap" case documented on
 * `annotatePageHtml`.
 */
function annotateSlotsInPlace(
  root: HTMLElement,
  slots: SlotDef[],
  values: Record<string, string>,
  key: (slotId: string) => string,
): Set<string> {
  const handled = new Set<string>();

  // Images first: unambiguous (the token is the whole `src`), and doing
  // this before attribute-bound text slots means an alt-text slot on the
  // SAME <img> (below) finds the element already carrying SLOT_ATTR/
  // IMAGE_ATTR for the image itself and marks it with ALT_ATTR instead.
  for (const s of slots) {
    if (s.type !== "image") continue;
    const token = imgToken(s.id);
    const img = root.querySelectorAll("img").find((el) => el.getAttribute("src") === token);
    if (!img) continue;
    img.setAttribute("src", escapeHtml(values[s.id] ?? ""));
    img.setAttribute(SLOT_ATTR, key(s.id));
    img.setAttribute(IMAGE_ATTR, "");
    handled.add(s.id);
  }

  for (const s of slots) {
    if (s.type === "image") continue;
    const token = slotToken(s.id);
    const value = fillSlotValue(s, values[s.id] ?? "");

    if (s.attr) {
      // Attribute-bound: find the element whose named attribute IS the
      // token (unambiguous by construction — see compiler/slots.ts), write
      // the resolved value into that same attribute, and mark it with
      // ALT_ATTR rather than SLOT_ATTR (see that constant's note).
      const attrName = s.attr;
      const el = root.querySelectorAll("*").find((e) => e.getAttribute(attrName) === token);
      if (el) {
        el.setAttribute(attrName, value);
        el.setAttribute(ALT_ATTR, key(s.id));
        handled.add(s.id);
      }
      continue; // never falls through to the element-content case below
    }

    const el = root.querySelectorAll("*").find((e) => e.innerHTML === token);
    if (el) {
      el.setAttribute(SLOT_ATTR, key(s.id));
      el.set_content(value);
      handled.add(s.id);
    }
    // else: "wrap" case, left as a bare token for the caller.
  }

  return handled;
}

/**
 * Applies one page's text/image slots to its (nav + repeat already
 * substituted) skeleton HTML — computing the exact same values the
 * production path in renderer.ts computes (same `fillSlotValue`) — but ALSO
 * marks each slot's element, and the page root, so the editable preview can
 * find them. Only ever called when `opts.annotate` is true; the production
 * branch in renderer.ts never imports this module's DOM machinery into its
 * own code path, so nothing here can affect it.
 *
 * MECHANISM: renderSite's production path is plain string substitution
 * (`html.split(token).join(value)`) — it never parses the skeleton into a
 * DOM. Locating "the element enclosing this token" therefore needs a real
 * parse, so this function parses the skeleton with `node-html-parser`
 * (already a dependency, used throughout `lib/site-studio/compiler/`,
 * including to serialize the very skeletons stored in `tpl.pages` — see
 * `compiler/compile.ts`'s `page.root.toString()`), mutates real element
 * nodes, and re-serializes with `.toString()`. `{ comment: true }` matches
 * `compiler/inventory.ts`'s own parse options — belt-and-braces, since the
 * compiler already strips every comment from a skeleton before it's stored,
 * but there's no reason to parse this differently from the rest of the
 * pipeline.
 *
 * Per-slot placement is documented on `annotateSlotsInPlace` above; the one
 * case handled here instead is the "wrap" fallback:
 *
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
 *
 * ANOTHER BYTE-FIDELITY CAVEAT (harmless, but real): `pageRoot.setAttribute`
 * below re-serializes ALL of that one element's attributes through
 * node-html-parser's own quoting (`HTMLElement.setAttribute` →
 * `quoteAttribute`), so e.g. `<body class='home' data-theme=light>` becomes
 * `<body class="home" data-theme="light">` in the annotated build even
 * though neither of those attributes was touched. No functional difference
 * has been found, but it means the page-root element is never byte-
 * identical to production in an annotated build — worth knowing alongside
 * the wrapper tradeoff above, since both are reasons annotation can never
 * be a byte-for-byte superset of the production markup.
 */
export function annotatePageHtml(
  html: string,
  def: PageDef,
  page: ContentDocPage,
  docPageIndex: number,
): string {
  const root = parse(html, { comment: true });
  const key = (slotId: string) => `${docPageIndex}:${slotId}`;

  const pageRoot =
    root.querySelector("body") ??
    root.querySelector("html") ??
    (root.querySelectorAll("*")[0] as HTMLElement | undefined);
  pageRoot?.setAttribute(PAGE_ATTR, String(docPageIndex));

  const handled = annotateSlotsInPlace(root, def.slots, page.slots, key);

  let out = root.toString();
  for (const s of def.slots) {
    if (s.type === "image" || s.attr || handled.has(s.id)) continue;
    const token = slotToken(s.id);
    const value = fillSlotValue(s, page.slots[s.id] ?? "");
    out = out.split(token).join(`<span ${SLOT_ATTR}="${key(s.id)}">${value}</span>`);
  }
  return out;
}

/**
 * The repeat-row counterpart to `annotatePageHtml`: applies one repeat
 * instance's slots to its fragment HTML (the same per-row substitution
 * renderer.ts's production path does, via the same `fillSlotValue`), but
 * marks each slot with the ROW-scoped key documented on `SLOT_ATTR` above —
 * `"${docPageIndex}:${repeatId}#${rowIndex}:${slotId}"` — so two rows of
 * the same repeat (e.g. two service cards) never collide, and an edit from
 * the preview can be routed back to the exact row it came from.
 *
 * Only ever called when `opts.annotate` is true, from renderer.ts's repeat
 * loop; the production branch there still does plain
 * `.split(token).join(fillSlotValue(...))` per row, untouched.
 */
export function annotateRepeatRow(
  fragmentHtml: string,
  slots: SlotDef[],
  row: Record<string, string>,
  docPageIndex: number,
  repeatId: string,
  rowIndex: number,
): string {
  const root = parse(fragmentHtml, { comment: true });
  const key = (slotId: string) => `${docPageIndex}:${repeatId}#${rowIndex}:${slotId}`;

  const handled = annotateSlotsInPlace(root, slots, row, key);

  let out = root.toString();
  for (const s of slots) {
    if (s.type === "image" || s.attr || handled.has(s.id)) continue;
    const token = slotToken(s.id);
    const value = fillSlotValue(s, row[s.id] ?? "");
    out = out.split(token).join(`<span ${SLOT_ATTR}="${key(s.id)}">${value}</span>`);
  }
  return out;
}
