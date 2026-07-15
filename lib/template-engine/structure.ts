// Template Engine v2 — the structure-preservation gate.
//
// v2 rewrites whole files with an LLM, which is the only way to evict a demo
// business that is spread across markup, copy and JS data. The cost of that
// power is that nothing structural stops the model from "improving" the
// template: renaming a class, collapsing a section, dropping a method. The
// design lives in `style.css`, which we never regenerate — so the CSS keeps
// working only for as long as the markup keeps its hooks. This module is the
// tripwire: the AI may change words, never the skeleton.
//
// Regex-only by design — pure, dependency-free, and it never has to parse a
// document it cannot handle. It is a canary, not a compiler: it is checked
// against ITSELF (the same extractor runs over before and after), so a shape it
// misreads is misread identically on both sides and cancels out. See the
// "Known limits" note on each extractor.

export interface HtmlSkeleton {
  /** tag name (lowercased) -> number of opening tags */
  tags: Record<string, number>;
  classes: Set<string>;
  ids: Set<string>;
  /** every `data-*` attribute NAME present, e.g. `data-faq`. Names only. */
  dataAttrs: Set<string>;
  /** inline handler name (lowercased) -> occurrences, e.g. `{ onclick: 3 }` */
  handlers: Record<string, number>;
}

export interface SkeletonDiff {
  ok: boolean;
  missingClasses: string[];
  missingIds: string[];
  missingDataAttrs: string[];
  /** one `tag: before -> after` line per tag whose count dropped */
  tagDiff: string[];
  /** one `handler: before -> after` line per inline handler that was dropped */
  handlerDiff: string[];
}

export interface JsDiff {
  ok: boolean;
  missing: string[];
}

/**
 * Comments are stripped first: templates are full of commented-out blocks
 * (`<!-- <div class="alt-hero"> -->`), a rewriting model routinely drops them,
 * and counting their markup would fail the generation over dead text. Stripping
 * cannot hide a real removal — markup the model moves INTO a comment still
 * disappears from the after-skeleton and still fails the gate.
 */
const HTML_COMMENT_RE = /<!--[\s\S]*?-->/g;

/** Opening tags only — `</div>` and `<!doctype` do not start with a letter. */
const TAG_RE = /<([a-zA-Z][\w-]*)\b/g;

/**
 * Both quote styles and the unquoted form. A model that re-emits `class='hero'`
 * has preserved the design; a matcher that only understood double quotes would
 * see every class vanish and fail it.
 */
const CLASS_ATTR_RE = /\bclass\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+))/gi;
const ID_ATTR_RE = /\bid\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+))/gi;

/**
 * Behavioural attributes are scanned ONLY inside an opening tag, because copy
 * is not markup. A page that reads "our big-data-driven process" or links to
 * `/big-data-analysis` must not register a phantom `data-driven` — that phantom
 * would vanish the moment the AI rewrote the sentence, failing a good page over
 * prose. Confining the scan to tags is what makes this rule safe to enforce.
 */
const TAG_OPEN_RE = /<[a-zA-Z][\w-]*\b[^>]*>/g;
/** `data-faq="1"` and the valueless `data-faq` alike; the name, never the value. */
const DATA_ATTR_RE = /(?:^|\s)(data-[a-zA-Z][\w-]*)(?=[\s=/>]|$)/gi;
/** `on` + at least two letters + `=` — tight enough that prose ("on = ") cannot match. */
const HANDLER_RE = /(?:^|\s)(on[a-z]{2,})\s*=/gi;

/**
 * The structural fingerprint of a page: which tags, how many, every styling
 * hook, and every behavioural hook. Values (text, href, src, alt, and the value
 * side of a data attribute) are deliberately absent — those are exactly what
 * regeneration is supposed to change.
 *
 * `dataAttrs` is not decoration. This template binds its interactivity entirely
 * through data attributes — `script.js` reaches for `[data-faq]`, `[data-faq-q]`,
 * `[data-faq-a]` — so a dropped or renamed `data-faq` is a silently dead
 * accordion: no leaked token, no tag change, green gate, broken site in front of
 * a paying client. Styling hooks alone do not cover behaviour.
 *
 * Known limits: the tag scan is textual, so an inline script with a tight
 * comparison (`i<divs.length`, no space) registers a phantom tag named `divs`,
 * and markup built inside a JS string is counted as real structure. An opening
 * tag whose attribute value contains a raw `>` is read as ending early. All are
 * harmless while stable — they are read identically on both sides — and only a
 * phantom that DISAPPEARS trips the gate: a false failure, never a silent pass.
 */
export function htmlSkeleton(html: string): HtmlSkeleton {
  const src = html.replace(HTML_COMMENT_RE, " ");

  const tags: Record<string, number> = {};
  for (const m of src.matchAll(TAG_RE)) {
    const tag = m[1].toLowerCase(); // HTML tag names are case-insensitive
    tags[tag] = (tags[tag] ?? 0) + 1;
  }

  const classes = new Set<string>();
  for (const m of src.matchAll(CLASS_ATTR_RE)) {
    const value = m[1] ?? m[2] ?? m[3] ?? "";
    for (const token of value.split(/\s+/)) if (token) classes.add(token);
  }

  const ids = new Set<string>();
  for (const m of src.matchAll(ID_ATTR_RE)) {
    const value = (m[1] ?? m[2] ?? m[3] ?? "").trim();
    if (value) ids.add(value);
  }

  const dataAttrs = new Set<string>();
  const handlers: Record<string, number> = {};
  for (const tag of src.matchAll(TAG_OPEN_RE)) {
    const open = tag[0];
    // HTML attribute names are case-insensitive, so `data-Faq` and `data-faq`
    // are the same hook and must not read as two.
    for (const m of open.matchAll(DATA_ATTR_RE)) dataAttrs.add(m[1].toLowerCase());
    for (const m of open.matchAll(HANDLER_RE)) {
      const name = m[1].toLowerCase();
      handlers[name] = (handlers[name] ?? 0) + 1;
    }
  }

  return { tags, classes, ids, dataAttrs, handlers };
}

/** `name: before -> after` for every key whose count dropped. Growth is fine. */
function countDrops(before: Record<string, number>, after: Record<string, number>): string[] {
  const drops: string[] = [];
  for (const [name, count] of Object.entries(before)) {
    const now = after[name] ?? 0;
    if (now < count) drops.push(`${name}: ${count} -> ${now}`);
  }
  return drops;
}

/**
 * `a` is the template, `b` the regenerated file. Passes only when b kept every
 * class and id of a and no tag's count dropped.
 *
 * Additions are allowed on purpose: a real business with five services where
 * the demo had three needs two more `<article class="card">`, and a model may
 * add a modifier class or a new data attribute. Growth is legitimate; LOSS is
 * the failure — a dropped class is a dead CSS rule and a visibly broken
 * section, a dropped `data-*` is a control that no longer responds.
 *
 * Data attributes compare by NAME, not by count: five FAQ items collapsing to
 * one still leaves `data-faq` present, but that loss is already caught by the
 * tag and class counts.
 */
export function compareSkeleton(a: HtmlSkeleton, b: HtmlSkeleton): SkeletonDiff {
  const missingClasses = [...a.classes].filter((c) => !b.classes.has(c));
  const missingIds = [...a.ids].filter((i) => !b.ids.has(i));
  const missingDataAttrs = [...a.dataAttrs].filter((d) => !b.dataAttrs.has(d));
  const tagDiff = countDrops(a.tags, b.tags);
  const handlerDiff = countDrops(a.handlers, b.handlers);

  return {
    ok:
      missingClasses.length === 0 &&
      missingIds.length === 0 &&
      missingDataAttrs.length === 0 &&
      tagDiff.length === 0 &&
      handlerDiff.length === 0,
    missingClasses,
    missingIds,
    missingDataAttrs,
    tagDiff,
    handlerDiff,
  };
}

/**
 * Comments and string/template literals, blanked in ONE left-to-right pass so
 * each construct is recognized only where it actually starts: `'http://x'` is a
 * string (not a comment), and `// it's fine` is a comment (not a string).
 *
 * Quoted literals may not span a raw newline. That is not pedantry: it bounds
 * the damage of a stray quote (a `'` inside a regex character class, say) to
 * its own line instead of letting it swallow the rest of the file — which would
 * hide real declarations and turn this gate into a rubber stamp.
 */
const JS_SCRUB_RE =
  /\/\*[\s\S]*?\*\/|\/\/[^\n]*|"(?:[^"\\\n]|\\[\s\S])*"|'(?:[^'\\\n]|\\[\s\S])*'|`(?:[^`\\]|\\[\s\S])*`/g;

const CLASS_DECL_RE = /\bclass\s+([A-Za-z_$][\w$]*)/g;
const FUNCTION_DECL_RE = /\bfunction\s*\*?\s*([A-Za-z_$][\w$]*)/g;
const VAR_DECL_RE = /\b(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=/g;
/** `init() {`, `async bindFaq() {`, `get title() {` — a name, a flat arg list, a body. */
const METHOD_RE = /(?:^|[\s;{}(,])([A-Za-z_$][\w$]*)\s*\([^()]*\)\s*\{/g;
const WINDOW_RE = /\bwindow\.([A-Za-z_$][\w$]*)\s*=/g;

/**
 * Keywords the method pattern would otherwise harvest: `if (x) {` and
 * `for (...) {` are shaped exactly like `init() {`. Left in, they would be
 * reported as missing "identifiers" named `if` — noise in the gate report, and
 * a false failure whenever a legitimate data rewrite changes a branch.
 *
 * Trade-off: a method deliberately named after a keyword (`delete() {}`) is not
 * tracked, so its removal is not caught. Rare, and preferable to reporting the
 * language itself as an identifier.
 */
const RESERVED = new Set([
  "if", "for", "while", "switch", "catch", "function", "return", "do", "else",
  "try", "finally", "with", "typeof", "instanceof", "new", "delete", "void",
  "in", "of", "case", "default", "throw", "await", "yield", "super", "class",
  "const", "let", "var", "import", "export",
]);

function collect(src: string, re: RegExp, into: Set<string>): void {
  for (const m of src.matchAll(re)) {
    const name = m[1];
    if (name && !RESERVED.has(name)) into.add(name);
  }
}

/**
 * Every name the file declares: classes, functions, methods, assigned
 * variables, and `window.*` globals.
 *
 * This is the JS analogue of the HTML skeleton. `script.js` is where the
 * template keeps its testimonial arrays and service data — the very things
 * regeneration must rewrite — while the surrounding `NorthpointApp` machinery
 * is wired to the markup and must survive intact. Blanking literals before
 * scanning draws that line precisely: data is invisible here, so rewriting it
 * cannot move the identifier set, and dropping the method that binds the FAQ
 * accordion cannot hide.
 *
 * Known limits: object keys and destructured bindings (`const { a } = o`) are
 * not tracked; a declaration-shaped string that survives scrubbing (inside an
 * unblanked regex literal, say) would register as a phantom name — which can
 * only cause a false failure, never a silent pass.
 */
export function jsIdentifiers(js: string): Set<string> {
  const src = js.replace(JS_SCRUB_RE, " ");
  const names = new Set<string>();
  collect(src, CLASS_DECL_RE, names);
  collect(src, FUNCTION_DECL_RE, names);
  collect(src, VAR_DECL_RE, names);
  collect(src, METHOD_RE, names);
  collect(src, WINDOW_RE, names);
  return names;
}

/**
 * `a` is the template's identifier set, `b` the regenerated file's. Every name
 * the template declared must still exist; new names are allowed.
 */
export function compareJs(a: Set<string>, b: Set<string>): JsDiff {
  const missing = [...a].filter((name) => !b.has(name));
  return { ok: missing.length === 0, missing };
}
