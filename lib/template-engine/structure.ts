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
}

export interface SkeletonDiff {
  ok: boolean;
  missingClasses: string[];
  missingIds: string[];
  /** one `tag: before -> after` line per tag whose count dropped */
  tagDiff: string[];
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
 * The structural fingerprint of a page: which tags, how many, and every styling
 * hook. Values (text, href, src, alt) are deliberately absent — those are
 * exactly what regeneration is supposed to change.
 *
 * Known limits: the scan is textual, so an inline script with a tight
 * comparison (`i<divs.length`, no space) registers a phantom tag named `divs`,
 * and markup built inside a JS string is counted as real structure. Both are
 * harmless while stable — they are counted identically on both sides — and only
 * a phantom that DISAPPEARS trips the gate: a false failure, never a silent
 * pass. Values are not the only blind spot either: `data-*` attributes and
 * inline handlers, which the regeneration prompt also promises to preserve, are
 * not fingerprinted here.
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

  return { tags, classes, ids };
}

/**
 * `a` is the template, `b` the regenerated file. Passes only when b kept every
 * class and id of a and no tag's count dropped.
 *
 * Additions are allowed on purpose: a real business with five services where
 * the demo had three needs two more `<article class="card">`, and a model may
 * add a modifier class. Growth is legitimate; LOSS is the failure — a dropped
 * class is a dead CSS rule and a visibly broken section.
 */
export function compareSkeleton(a: HtmlSkeleton, b: HtmlSkeleton): SkeletonDiff {
  const missingClasses = [...a.classes].filter((c) => !b.classes.has(c));
  const missingIds = [...a.ids].filter((i) => !b.ids.has(i));

  const tagDiff: string[] = [];
  for (const [tag, count] of Object.entries(a.tags)) {
    const after = b.tags[tag] ?? 0;
    if (after < count) tagDiff.push(`${tag}: ${count} -> ${after}`);
  }

  return {
    ok: missingClasses.length === 0 && missingIds.length === 0 && tagDiff.length === 0,
    missingClasses,
    missingIds,
    tagDiff,
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
