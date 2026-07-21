// Template Engine v2 — string-literal extraction for JavaScript.
//
// `script.js` is where a template parks its testimonials, service names, FAQ
// entries and labels — the data that MUST become the client's — wrapped in code
// that must not move a character. Sending the file to a model and asking for it
// back whole is exactly what collapsed on a small model: nearly every declared
// identifier went missing from the rebuilt `script.js`.
//
// So this module lexes the file, records the byte range of every string
// literal, and reassembles by splicing. Identifiers, control flow, comments,
// regexes and whitespace are never in the payload and therefore cannot change.
//
// Reassembly is byte-exact for unchanged strings: an item written back with its
// original text is restored from the ORIGINAL slice, so quote style and the
// original escaping survive untouched.

export interface JsStringItem {
  id: string;
  /** The literal's content, with escape sequences decoded. */
  text: string;
  /**
   * False for literals that are code in disguise — module paths, selectors,
   * URLs, class-name tokens, markup fragments. These are still REPLACEABLE
   * (the deterministic demo-identity pass uses them, so a demo email hiding in
   * `const CONTACT = "hello@demo.com"` is still evicted) but they are never
   * offered to the model.
   */
  translatable: boolean;
  /** Quote character the literal was written with. */
  quote: "'" | '"' | "`";
}

export interface ExtractedJs {
  items: JsStringItem[];
  /** Splice replacements back in by id. Omitted / blank / unchanged => original slice. */
  apply(map: Record<string, string | undefined | null>): string;
}

interface Slot {
  id: string;
  text: string;
  translatable: boolean;
  quote: "'" | '"' | "`";
  /** Range of the literal's CONTENT, excluding the quotes. */
  start: number;
  end: number;
}

/** Keywords after which a `/` can only begin a regex literal, never a division. */
const REGEX_PRECEDING_WORDS = new Set([
  "return", "typeof", "instanceof", "in", "of", "new", "delete", "void", "do",
  "else", "case", "yield", "await", "throw",
]);

/** Punctuation after which a `/` can only begin a regex literal. */
const REGEX_PRECEDING_PUNCT = new Set([
  "(", ",", "=", ":", "[", "!", "&", "|", "?", "{", "}", ";", "+", "-", "*", "%",
  "~", "^", "<", ">",
]);

const MIN_TRANSLATABLE_CHARS = 3;

/** `from "x"`, `import("x")`, `require("x")` — module specifiers, never copy. */
const MODULE_SPECIFIER_RE = /(?:\bfrom|\bimport|\brequire)\s*\(?\s*$/;

/** `.card`, `#hero`, `[data-faq]`, `> .item` — selectors, never copy. */
const SELECTOR_RE = /^[.#[>]|\[data-|^[a-z]+\s*[>+~]\s*[.#[]/i;

/** Absolute, root-relative and dot-relative paths, plus protocol URLs. */
const URLISH_RE = /^(?:https?:)?\/\/|^\/|^\.{1,2}\/|:\/\//;

/** A bare filename with an asset extension. */
const FILENAME_RE = /\.(?:js|mjs|cjs|css|json|html?|png|jpe?g|gif|svg|webp|avif|ico|woff2?|ttf|mp4|webm)$/i;

/** One lowercase token: `click`, `active`, `is-open`, `data_id` — DOM/CSS vocabulary. */
const CODE_TOKEN_RE = /^[a-z][a-z0-9_-]*$/;

/** SCREAMING_CASE constants. */
const CONST_TOKEN_RE = /^[A-Z][A-Z0-9_]*$/;

/** A markup fragment built in JS — rewriting it could move structure. */
const MARKUP_RE = /<\/?[a-zA-Z][\w-]*[\s>/]/;

function hasLetter(s: string): boolean {
  return /\p{L}/u.test(s);
}

/**
 * Is this literal human-readable copy, or is it code?
 *
 * Biased toward "code": a false negative costs one string that keeps its
 * template wording (which the leak gate would still catch if it carried demo
 * identity, because the deterministic pass runs over EVERY literal); a false
 * positive hands the model a class name or an event name to "improve", and a
 * renamed `"click"` is a silently dead button that no gate checks.
 */
export function isTranslatableJsString(text: string, precedingCode: string): boolean {
  const t = text.trim();
  if (t.length < MIN_TRANSLATABLE_CHARS) return false;
  if (!hasLetter(t)) return false;
  if (MODULE_SPECIFIER_RE.test(precedingCode)) return false;
  if (SELECTOR_RE.test(t)) return false;
  if (URLISH_RE.test(t)) return false;
  if (FILENAME_RE.test(t)) return false;
  if (MARKUP_RE.test(t)) return false;
  if (CODE_TOKEN_RE.test(t)) return false;
  if (CONST_TOKEN_RE.test(t)) return false;
  return true;
}

/** Decode the escape sequences a template's strings actually use. */
export function decodeJsString(raw: string): string {
  return raw.replace(/\\(u\{[0-9a-fA-F]+\}|u[0-9a-fA-F]{4}|x[0-9a-fA-F]{2}|[\s\S])/g, (_m, esc: string) => {
    if (esc.startsWith("u{")) return String.fromCodePoint(Number.parseInt(esc.slice(2, -1), 16));
    if (esc.startsWith("u")) return String.fromCharCode(Number.parseInt(esc.slice(1), 16));
    if (esc.startsWith("x")) return String.fromCharCode(Number.parseInt(esc.slice(1), 16));
    if (esc === "n") return "\n";
    if (esc === "r") return "\r";
    if (esc === "t") return "\t";
    if (esc === "b") return "\b";
    if (esc === "f") return "\f";
    if (esc === "v") return "\v";
    if (esc === "0") return "\0";
    if (esc === "\n") return ""; // line continuation
    return esc; // \\ \' \" \` and anything else: the character itself
  });
}

/** Re-escape a replacement for the quote style the literal was written in. */
export function encodeJsString(value: string, quote: "'" | '"' | "`"): string {
  let out = value.replace(/\\/g, "\\\\").replace(/\r/g, "\\r");
  out = quote === "`" ? out.replace(/`/g, "\\`").replace(/\$\{/g, "\\${") : out.replace(/\n/g, "\\n");
  return out.split(quote).join(`\\${quote}`);
}

/**
 * Extract every string literal in `js`, in source order.
 *
 * Single- and double-quoted literals always qualify. Template literals qualify
 * only when they contain no `${}` interpolation — an interpolated template is
 * code with holes in it, and splicing text around the holes is not safe.
 */
export function extractJsStrings(js: string): ExtractedJs {
  const slots: Slot[] = [];
  let n = 0;
  let lastSignificant = ""; // last non-space code character seen
  let lastWord = "";

  const noteCode = (from: number, to: number) => {
    for (let i = from; i < to; i++) {
      const c = js[i];
      if (/\s/.test(c)) continue;
      lastSignificant = c;
      if (/[A-Za-z_$]/.test(c)) {
        let j = i;
        while (j < to && /[\w$]/.test(js[j])) j++;
        lastWord = js.slice(i, j);
        i = j - 1;
        lastSignificant = js[j - 1];
      } else {
        lastWord = "";
      }
    }
  };

  let i = 0;
  let codeFrom = 0;
  while (i < js.length) {
    const c = js[i];

    if (c === "/" && js[i + 1] === "/") {
      noteCode(codeFrom, i);
      while (i < js.length && js[i] !== "\n") i++;
      codeFrom = i;
      continue;
    }
    if (c === "/" && js[i + 1] === "*") {
      noteCode(codeFrom, i);
      const end = js.indexOf("*/", i + 2);
      i = end === -1 ? js.length : end + 2;
      codeFrom = i;
      continue;
    }
    if (c === "/") {
      noteCode(codeFrom, i);
      codeFrom = i;
      const regex = lastSignificant === "" || REGEX_PRECEDING_PUNCT.has(lastSignificant) || REGEX_PRECEDING_WORDS.has(lastWord);
      if (regex) {
        i = skipRegex(js, i);
        codeFrom = i;
        lastSignificant = "/";
        lastWord = "";
        continue;
      }
      i++;
      continue;
    }

    if (c === '"' || c === "'" || c === "`") {
      noteCode(codeFrom, i);
      const preceding = js.slice(Math.max(0, i - 60), i);
      const start = i + 1;
      const { end, interpolated } = scanString(js, i);
      const raw = js.slice(start, end);
      if (!(c === "`" && interpolated)) {
        const text = decodeJsString(raw);
        slots.push({
          id: `s${++n}`,
          text,
          translatable: isTranslatableJsString(text, preceding),
          quote: c,
          start,
          end,
        });
      }
      i = end + 1;
      codeFrom = i;
      lastSignificant = c;
      lastWord = "";
      continue;
    }

    i++;
  }
  noteCode(codeFrom, js.length);

  const items: JsStringItem[] = slots.map((s) => ({
    id: s.id,
    text: s.text,
    translatable: s.translatable,
    quote: s.quote,
  }));

  return {
    items,
    apply(map) {
      let out = "";
      let cursor = 0;
      for (const slot of slots) {
        out += js.slice(cursor, slot.start);
        const next = map[slot.id];
        const changed = typeof next === "string" && next.trim().length > 0 && next !== slot.text;
        out += changed ? encodeJsString(next, slot.quote) : js.slice(slot.start, slot.end);
        cursor = slot.end;
      }
      return out + js.slice(cursor);
    },
  };
}

/** Index of the closing quote of the literal opening at `open`, and whether a template interpolated. */
function scanString(js: string, open: number): { end: number; interpolated: boolean } {
  const quote = js[open];
  let interpolated = false;
  let i = open + 1;
  while (i < js.length) {
    const c = js[i];
    if (c === "\\") {
      i += 2;
      continue;
    }
    if (quote === "`" && c === "$" && js[i + 1] === "{") {
      interpolated = true;
      i = skipInterpolation(js, i + 1);
      continue;
    }
    // A quoted literal may not span a raw newline: bounding it there keeps a
    // stray apostrophe from swallowing the rest of the file.
    if (quote !== "`" && c === "\n") return { end: i, interpolated };
    if (c === quote) return { end: i, interpolated };
    i++;
  }
  return { end: js.length, interpolated };
}

/** Index just past the `}` closing the `${` that starts at `open`. */
function skipInterpolation(js: string, open: number): number {
  let depth = 0;
  let i = open;
  while (i < js.length) {
    const c = js[i];
    if (c === "{") depth++;
    else if (c === "}") {
      depth--;
      if (depth === 0) return i + 1;
    } else if (c === '"' || c === "'" || c === "`") {
      i = scanString(js, i).end + 1;
      continue;
    }
    i++;
  }
  return js.length;
}

/** Index just past a regex literal starting at `open` (its `/` plus flags). */
function skipRegex(js: string, open: number): number {
  let i = open + 1;
  let inClass = false;
  while (i < js.length) {
    const c = js[i];
    if (c === "\\") {
      i += 2;
      continue;
    }
    if (c === "\n") return i; // unterminated — bound the damage to the line
    if (c === "[") inClass = true;
    else if (c === "]") inClass = false;
    else if (c === "/" && !inClass) {
      i++;
      while (i < js.length && /[a-z]/i.test(js[i])) i++;
      return i;
    }
    i++;
  }
  return js.length;
}
