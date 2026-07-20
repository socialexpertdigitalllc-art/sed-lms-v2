// Template Engine v2 — the demo business's identity, derived from the template
// itself, and the scan that proves it is gone.
//
// This is the module that makes the v1 bug impossible to ship. v1 sold a site to
// "Warrior Contracting" that still said "Northpoint Remodeling", "Denver" and
// "Cherry Creek" — the template's demo business — and then marked it
// `ready_for_review`, because nothing ever checked. `extractDemoTokens` runs once
// at upload and records who the template's demo business is; `findLeaks` runs
// after regeneration and fails the build if any of that identity survived.
//
// Pure by construction: no I/O, no dependencies, regex only. The gate has to be
// unit-testable, and a check that can fail for environmental reasons is a check
// people learn to skip.
//
// THE ASYMMETRY THAT SHAPES EVERY RULE HERE. The two failure directions are not
// equal:
//   - A false positive (an over-eager token) fails a good build. Annoying, but
//     loud, immediate, and fixable by a human looking at a diff.
//   - A false negative (a missed token) ships the demo business to a paying
//     client. Silent, and the exact bug v2 exists to eliminate.
// So every judgement call below is biased toward catching too much.
//
// THE ONE COUNTERWEIGHT. A token so generic it can never pass — "Home",
// "Services", a bare "Kitchen" — fails EVERY build, and a gate that always fails
// is a gate someone disables. A disabled gate is worse than no gate, because it
// looks like protection. So distinctive identity is caught aggressively, and
// industry/marketing/chrome vocabulary is deliberately let through: see
// GENERIC_WORDS.

export interface Leak {
  file: string;
  token: string;
  /** the token in +/-40 characters of its surroundings, whitespace collapsed */
  excerpt: string;
}

/**
 * Markup and code vocabulary. These are never identity — they are the language
 * the file is written in, and they appear in every file of every site.
 */
const MARKUP_WORDS = new Set([
  "html", "head", "body", "span", "div", "class", "const", "window", "function",
  "script", "style", "title", "meta", "link", "href", "http", "https", "www",
  "doctype", "charset", "utf-8", "viewport", "initial-scale", "content", "src",
  "alt", "type", "name", "value", "form", "input", "button", "label", "table",
  "header", "footer", "main", "section", "article", "aside", "nav", "img", "svg",
  "path", "rect", "true", "false", "null", "undefined", "return", "var", "let",
  "new", "this", "document", "console", "query", "selector", "element", "event",
  "addeventlistener", "queryselector", "queryselectorall", "classlist", "data",
  "width", "height", "color", "background", "font", "family", "weight", "size",
  "center", "flex", "grid", "block", "none", "auto", "left", "right", "top",
  "bottom", "middle", "hidden", "visible", "text", "list", "item", "items",
  "container", "wrapper", "row", "column", "card", "cards", "btn", "icon",
]);

/**
 * The too-generic line, drawn on purpose.
 *
 * Every word here is one a LEGITIMATE client site is expected to contain. If any
 * became a token on its own, the gate would fail correct work forever and get
 * switched off. The list is industry vocabulary, marketing adjectives, company
 * suffixes and site chrome — the words that describe ANY business in this
 * template's market, as opposed to the words that identify THIS demo business.
 *
 * The concrete case that sets the line: this template's logo is two spans,
 * `<span>NORTHPOINT</span><span>REMODELING</span>`. "Northpoint" is invented and
 * identifies the demo business — it is caught. "Remodeling" is the industry the
 * template SELLS to; a real remodeling client's site says "Remodeling" correctly
 * on every page, so tokenising it would fail every build in the template's core
 * market. Only the distinctive half is a token.
 *
 * A word being here does NOT make it invisible to the gate: it only blocks the
 * word from being a token BY ITSELF. "Denver Kitchens" and "Northpoint
 * Remodeling" are still caught whole, because each carries a distinctive word.
 */
const GENERIC_WORDS = new Set([
  // the industries these templates are sold into
  "remodeling", "remodel", "remodels", "renovation", "renovations", "reno",
  "contracting", "contractor", "contractors", "construction", "builder",
  "builders", "building", "painting", "painters", "painter", "roofing",
  "roofers", "roofer", "plumbing", "plumber", "plumbers", "electrical",
  "electric", "electrician", "electricians", "landscaping", "landscape",
  "landscapes", "lawn", "hvac", "heating", "cooling", "air", "flooring",
  "floors", "floor", "carpentry", "carpenter", "masonry", "concrete", "paving",
  "cleaning", "cleaners", "cleaner", "restoration", "repair", "repairs",
  "installation", "installations", "install", "kitchen", "kitchens", "bath",
  "baths", "bathroom", "bathrooms", "basement", "basements", "deck", "decks",
  "fence", "fencing", "roof", "roofs", "window", "windows", "door", "doors",
  "siding", "gutter", "gutters", "tile", "tiling", "cabinet", "cabinets",
  "countertop", "countertops", "granite", "marble", "hardwood", "drywall",
  // company suffixes and collective nouns
  "company", "companies", "group", "groups", "inc", "llc", "ltd", "corp",
  "corporation", "enterprises", "solutions", "services", "service", "systems",
  "partners", "associates", "studio", "studios", "works", "pros", "experts",
  "expert", "specialists", "specialist", "team", "teams", "sons", "brothers",
  "trades", "craft", "crafts", "craftsmanship",
  // marketing adjectives — the reason "Quality Painting" must not yield "Quality"
  "quality", "premier", "premium", "elite", "best", "professional",
  "professionals", "reliable", "trusted", "affordable", "superior", "precision",
  "custom", "modern", "classic", "luxury", "beautiful", "finest", "fine",
  "first", "top", "prime", "advanced", "complete", "total", "ultimate",
  "perfect", "master", "masters", "quick", "fast", "rapid", "easy", "simple",
  "smart", "clear", "bright", "fresh", "clean", "local", "family", "owned",
  "operated", "licensed", "insured", "certified", "award", "winning", "trust",
  "care", "caring", "honest", "proven", "leading", "exceptional", "excellence",
  // site chrome — page names and nav labels
  "home", "about", "contact", "gallery", "areas", "area", "blog", "news", "faq",
  "faqs", "testimonials", "reviews", "review", "projects", "project",
  "portfolio", "work", "careers", "privacy", "terms", "sitemap", "menu",
  "search", "login", "page", "pages", "process", "steps", "step", "guarantee",
  "warranty", "financing", "pricing", "price", "prices", "cost", "costs",
  // generic business nouns and CTAs
  "design", "designs", "designer", "build", "builds", "house", "houses",
  "property", "properties", "residential", "commercial", "interior",
  "exterior", "indoor", "outdoor", "free", "estimate", "estimates", "quote",
  "quotes", "consultation", "booking", "book", "schedule", "scheduling", "call",
  "now", "today", "get", "started", "start", "learn", "more", "view", "all",
  "why", "how", "what", "when", "where", "who", "the", "and", "for", "with",
  "from", "our", "your", "you", "we", "us", "this", "that", "here", "there",
  "client", "clients", "customer", "customers", "homeowner", "homeowners",
  "project", "job", "jobs", "room", "rooms", "space", "spaces", "style",
  "styles", "look", "looks", "photo", "photos", "image", "images", "video",
  "phone", "email", "mail", "address", "hours", "open", "closed", "monday",
  "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday",
  "january", "february", "march", "april", "may", "june", "july", "august",
  "september", "october", "november", "december",
]);

/**
 * Ordinary English words that also read as brand names.
 *
 * These are NOT noise — "King Painting" and "Summit Roofing" are real identity
 * and are caught whole. What is unusable is the BARE word: a template whose
 * demo business is "King Painting" yields the token "King", and "King" as a
 * token on its own has no upside (the phrase already catches the brand) and one
 * fatal downside — it is a word a legitimate client's copy is allowed to use.
 * The production failure that put this list here was exactly that: the gate
 * flagged `King` and the operator could never pass it.
 *
 * Kept deliberately separate from GENERIC_WORDS/isNoise: a word here must still
 * make a PHRASE distinctive ("King Painting" survives on "king"), so it must not
 * feed isDistinctive(). It only blocks the word from standing alone as a token.
 */
const COMMON_WORDS = new Set([
  // royalty / rank — the classic small-business brand well
  "king", "kings", "queen", "queens", "prince", "royal", "crown", "crowns",
  "noble", "regal", "sovereign", "monarch", "empire", "imperial", "legacy",
  "heritage", "dynasty", "champion", "champions", "victory", "triumph",
  // height / summit
  "summit", "summits", "apex", "peak", "peaks", "pinnacle", "zenith", "vertex",
  "crest", "ridge", "height", "heights", "high", "highland", "highlands",
  // landscape nouns
  "river", "rivers", "creek", "lake", "lakes", "bay", "harbor", "harbour",
  "shore", "coast", "island", "valley", "canyon", "meadow", "meadows", "grove",
  "groves", "forest", "woods", "wood", "field", "fields", "prairie", "desert",
  "mountain", "mountains", "hill", "hills", "cliff", "brook", "creekside",
  // trees / plants
  "oak", "oaks", "pine", "pines", "cedar", "maple", "birch", "willow", "aspen",
  "elm", "ivy", "rose", "roses", "lily", "laurel", "olive",
  // materials and elements — remodeling copy is full of these
  "stone", "stones", "rock", "iron", "steel", "copper", "bronze", "gold",
  "golden", "silver", "diamond", "crystal", "brick", "timber", "slate",
  // sky / weather / light
  "sun", "sunrise", "sunset", "star", "stars", "moon", "sky", "dawn", "dusk",
  "storm", "thunder", "lightning", "blaze", "flame", "spark", "beacon",
  "lighthouse", "horizon", "compass", "north", "south", "east", "west",
  // animals
  "eagle", "eagles", "falcon", "hawk", "lion", "lions", "bear", "wolf",
  // ("Phoenix" is deliberately absent — it is a city before it is a bird, and
  //  demo geography is the highest-value leak this gate catches.)
  "wolves", "fox", "stag", "bull", "raven", "dolphin", "shark",
  // structures and tools
  "bridge", "bridges", "gate", "gates", "tower", "towers", "castle", "arch",
  "anchor", "arrow", "shield", "hammer", "anvil", "forge", "keystone",
  "cornerstone", "foundation", "pillar", "pillars",
  // abstractions used as names
  "liberty", "freedom", "unity", "union", "alliance", "guardian", "sentinel",
  "titan", "atlas", "apollo", "olympus", "pioneer", "frontier", "patriot",
  "horizon", "vision", "insight", "clarity", "harmony", "balance", "essence",
  "core", "edge", "point", "line", "level", "mark", "range", "scope", "sphere",
  "bold", "sharp", "solid", "strong", "steady", "swift", "vital",
]);

const isNoise = (w: string) => MARKUP_WORDS.has(w) || GENERIC_WORDS.has(w);

/** Nothing below this length is ever a token (well above the 3-char floor). */
const MIN_TOKEN_CHARS = 4;

/** Splits a phrase into comparable lowercase words, dropping punctuation. */
function words(phrase: string): string[] {
  return phrase
    .toLowerCase()
    .split(/[^a-z0-9]+/i)
    .filter(Boolean);
}

/**
 * A phrase is identity if ANY of its words is distinctive. "Denver Kitchens"
 * survives on "denver"; "Our Services" has nothing distinctive and is dropped.
 * Purely numeric strings (phones, addresses) are handled by their own rules and
 * bypass this test.
 */
function isDistinctive(phrase: string): boolean {
  const w = words(phrase);
  if (w.length === 0) return false;
  return w.some((x) => x.length >= 4 && !isNoise(x));
}

function decodeEntities(s: string): string {
  return s
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&(?:#0?39|#x27|apos|rsquo|#8217);/gi, "'");
}

const norm = (s: string) => decodeEntities(s).replace(/\s+/g, " ").trim();

const HTML_RE = /\.html?$/i;
const HTML_COMMENT_RE = /<!--[\s\S]*?-->/g;
const SCRIPT_STYLE_RE = /<(script|style)\b[^>]*>[\s\S]*?<\/\1>/gi;
const TAG_RE = /<[^>]+>/g;
/** JS string literals — where human-facing copy lives inside a script. */
const JS_STRING_RE = /"((?:[^"\\\n]|\\.)*)"|'((?:[^'\\\n]|\\.)*)'|`((?:[^`\\]|\\.)*)`/g;

/**
 * The human-readable copy of a file, with the code removed.
 *
 * HTML: comments, <script>/<style> bodies and tags are stripped, because the
 * prose rules below look for Capitalised runs and raw code is full of them
 * (`new Date`, `JSON.parse`) — phantom "places" that would fail good builds.
 *
 * JS: only string literals are read. This template's `components.js` renders its
 * markup — including the demo email and "NORTHPOINT" — from strings, so the copy
 * is genuinely there; the surrounding identifiers are not copy and are left to
 * the JS-identifier rule.
 */
function prose(file: string, content: string): string {
  if (HTML_RE.test(file)) {
    return norm(
      content.replace(HTML_COMMENT_RE, " ").replace(SCRIPT_STYLE_RE, " ").replace(TAG_RE, " ")
    );
  }
  const out: string[] = [];
  for (const m of content.matchAll(JS_STRING_RE)) {
    out.push(m[1] ?? m[2] ?? m[3] ?? "");
  }
  return norm(out.join(" ").replace(TAG_RE, " "));
}

const TITLE_RE = /<title[^>]*>([\s\S]*?)<\/title>/gi;
/** en/em dash, pipe, middot, colon — the separators real titles actually use. */
const TITLE_SPLIT_RE = /\s+[-–—|·:]\s+/;

/**
 * A run of Capitalised words. Deliberately NOT case-insensitive: the capital is
 * the whole signal, and an `i` flag would make `[A-Z]` match anything.
 */
const CAP_RUN = "[A-Z][a-zA-Z'’.&-]*(?:\\s+[A-Z][a-zA-Z'’.&-]*)*";

/**
 * Place triggers. "Serving Denver", "in Cherry Creek", "throughout Wash Park".
 * The trailing run may be a conjunction list ("Serving Cherry Creek and
 * Denver"), which is split apart afterwards.
 */
const PLACE_RE = new RegExp(
  `(?:[Ss]erving|[Ss]ervicing|[Ss]erves?|[Ll]ocated in|[Bb]ased in|[Tt]hroughout|[Aa]cross|[Aa]round|[Nn]ear|[Ii]n)\\s+(${CAP_RUN}(?:\\s*(?:,|&|and)\\s*${CAP_RUN})*)`,
  "g"
);
const REPEATED_PHRASE_RE = new RegExp(`[A-Z][a-z]+(?:\\s+[A-Z][a-z]+)+`, "g");

/**
 * Phones, in every shape this template and its neighbours actually use.
 *
 * `tel:` is matched separately and loosely because the real template's only
 * phone link is `tel:5552104400` — bare digits, matching neither of the
 * formatted patterns. A rule that only understood `(303) 555-1234` and
 * `+13035551234` would have let the demo phone number through untouched.
 */
const PHONE_TEXT_RE = /\(\d{3}\)\s?\d{3}[-.\s]?\d{4}|\b\d{3}[-.]\d{3}[-.]\d{4}\b|\+1\d{10}\b/g;
const TEL_HREF_RE = /tel:([+\d()\s.-]{7,})/gi;
const EMAIL_RE = /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g;
/** `?q=` of an embedded map — where this template parks its demo geography. */
const MAPS_Q_RE = /[?&]q=([^&"'\s>]+)/gi;
const APP_CLASS_RE = /\b([A-Z][a-zA-Z]*App)\b/g;
const WINDOW_APP_RE = /window\.([a-zA-Z]+App)\b/g;

/** Strips a trailing possessive so "Denver's" and "Denver" are one token. */
const depossess = (s: string) => s.replace(/['’]s$/i, "").trim();

/**
 * A candidate that is ONE ordinary English word — "King", "Summit", "Apex".
 *
 * Such a candidate is dropped rather than emitted: the multi-word identity
 * phrase it came from ("King Painting", "Summit Roofing") is captured by the
 * title/brand/phrase rules above and is genuinely distinctive, so the bare word
 * adds no catching power and costs an unpassable gate. This is not a relaxation
 * of the asymmetry doctrine — a token that fails EVERY build, including correct
 * ones, protects nobody; it is the GENERIC_WORDS counterweight applied to the
 * one class of word that list did not anticipate.
 */
function isCommonSingleWord(token: string): boolean {
  const w = words(depossess(token));
  return w.length === 1 && COMMON_WORDS.has(w[0]);
}

/**
 * Derives the identity of the template's demo business from the template's own
 * files. Returns deduplicated tokens (case-insensitive, first spelling wins) in
 * descending order of specificity.
 *
 * `files` is a map of template-relative path -> text content; pass only text
 * files (HTML/JS). Binaries would produce garbage tokens.
 */
export function extractDemoTokens(files: Record<string, string>): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  const add = (raw: string) => {
    const t = norm(raw);
    if (t.length < MIN_TOKEN_CHARS) return;
    const key = t.toLowerCase();
    if (seen.has(key)) return;
    if (isNoise(key)) return;
    // A lone ordinary English word is provably unusable as a gate token — the
    // phrase it belongs to is kept instead. See isCommonSingleWord.
    if (isCommonSingleWord(t)) return;
    seen.add(key);
    out.push(t);
  };
  /** for tokens that are their own proof (phones, emails): skip the word filter */
  const addLiteral = (raw: string) => {
    const t = norm(raw);
    if (t.length < MIN_TOKEN_CHARS) return;
    const key = t.toLowerCase();
    if (seen.has(key)) return;
    seen.add(key);
    out.push(t);
  };

  const entries = Object.entries(files);

  // ---- titles -------------------------------------------------------------
  // The whole title is a token: it is long, unique, and embeds the brand, so a
  // correctly regenerated page can never contain it.
  const titles: string[] = [];
  for (const [, content] of entries) {
    for (const m of content.matchAll(TITLE_RE)) {
      const t = norm(m[1]);
      if (t) titles.push(t);
    }
  }

  // The brand is the title segment the pages AGREE on. Seven of this template's
  // eight titles are "<Page> - Northpoint Remodeling" — the brand TRAILS — so
  // taking the leading segment would have derived "About Us" as the business
  // name. Intersecting the segments finds the brand wherever it sits; the
  // leading segment is only the fallback for a single-page template.
  const segFreq = new Map<string, { text: string; n: number }>();
  for (const t of titles) {
    const segs = new Set(
      t
        .split(TITLE_SPLIT_RE)
        .map((s) => s.trim())
        .filter(Boolean)
    );
    for (const s of segs) {
      const k = s.toLowerCase();
      const cur = segFreq.get(k);
      if (cur) cur.n++;
      else segFreq.set(k, { text: s, n: 1 });
    }
  }
  let brand = "";
  const repeated = [...segFreq.values()]
    .filter((s) => s.n >= 2 && isDistinctive(s.text))
    .sort((a, b) => b.n - a.n || b.text.length - a.text.length);
  if (repeated.length) brand = repeated[0].text;
  else if (titles.length) {
    const lead = titles[0].split(TITLE_SPLIT_RE)[0]?.trim() ?? "";
    if (isDistinctive(lead)) brand = lead;
  }

  if (brand) add(brand);
  for (const t of titles) add(t);

  // Individual brand words. This is what catches the logo, which this template
  // splits across two elements — `<span>NORTHPOINT</span><span>REMODELING</span>`
  // — so the phrase "Northpoint Remodeling" is never adjacent in the markup and
  // the phrase token alone would sail straight past it. It also catches every
  // other variant the demo wears: "Northpoint Design & Build", "The Northpoint
  // Guarantee", "northpointremodel.com", "NorthpointApp".
  if (brand) {
    for (const w of brand.split(/\s+/)) {
      const bare = depossess(w.replace(/[^a-zA-Z0-9'’-]/g, ""));
      if (bare.length >= 4 && !isNoise(bare.toLowerCase())) add(bare);
    }
  }

  // ---- contact details ----------------------------------------------------
  for (const [, content] of entries) {
    for (const m of content.matchAll(PHONE_TEXT_RE)) addLiteral(m[0]);
    for (const m of content.matchAll(TEL_HREF_RE)) {
      const digits = m[1].replace(/[^\d+]/g, "");
      if (digits.replace(/\D/g, "").length >= 7) addLiteral(digits);
    }
    for (const m of content.matchAll(EMAIL_RE)) {
      addLiteral(m[0]);
      const domain = m[0].split("@")[1];
      // The domain is the durable half: `hello@` becomes `info@` in the rewrite,
      // but a surviving `northpointremodel.com` is still the demo business.
      if (domain && domain.length >= 4) addLiteral(domain);
    }
  }

  // ---- geography ----------------------------------------------------------
  for (const [file, content] of entries) {
    const text = prose(file, content);
    for (const m of text.matchAll(PLACE_RE)) {
      for (const part of m[1].split(/\s*(?:,|&|\band\b)\s*/)) {
        const p = depossess(part);
        if (p && isDistinctive(p)) add(p);
      }
    }
    // An embedded map's `?q=` is unambiguous demo geography: this template
    // pins `q=Cherry Creek, Denver`, `q=Platt Park, Denver`, and its own
    // street address. Nobody writes a map query about a place they do not serve.
    for (const m of content.matchAll(MAPS_Q_RE)) {
      let q = "";
      try {
        q = decodeURIComponent(m[1].replace(/\+/g, " "));
      } catch {
        continue; // a malformed escape is not worth failing an upload over
      }
      for (const part of q.split(",")) {
        const p = norm(part);
        if (p && isDistinctive(p)) add(p);
      }
    }
  }

  // ---- repeated capitalised phrases ---------------------------------------
  // A demo identity recurs across PAGES; a headline lives on one. Requiring two
  // files is what separates "Cherry Creek" from "Two Decades Of Work", and keeps
  // this — the loosest rule here — from minting gate-disabling junk.
  const phraseFiles = new Map<string, { text: string; files: Set<string> }>();
  for (const [file, content] of entries) {
    for (const m of prose(file, content).matchAll(REPEATED_PHRASE_RE)) {
      const p = norm(m[0]);
      if (!isDistinctive(p)) continue;
      const k = p.toLowerCase();
      const cur = phraseFiles.get(k);
      if (cur) cur.files.add(file);
      else phraseFiles.set(k, { text: p, files: new Set([file]) });
    }
  }
  for (const p of phraseFiles.values()) if (p.files.size >= 2) add(p.text);

  // ---- JS identity --------------------------------------------------------
  // `class NorthpointApp` / `window.northpointApp`. v1 never regenerated
  // `script.js` at all, so this identity shipped verbatim in every client site.
  for (const [, content] of entries) {
    for (const m of content.matchAll(APP_CLASS_RE)) add(m[1]);
    for (const m of content.matchAll(WINDOW_APP_RE)) add(m[1]);
  }

  return out;
}

/** Regex metacharacters — tokens are literal text ("(303) 555-1234", "a+b.co"). */
const RE_META = /[.*+?^${}()|[\]\\]/g;
const escapeRe = (s: string) => s.replace(RE_META, "\\$&");

/** The character class JS's own `\b` is built from. */
const WORD_CHAR_CLASS = "A-Za-z0-9_";
const WORD_CHAR_RE = /[A-Za-z0-9_]/;

/**
 * What may sit BETWEEN the words of a multi-word token in the output.
 *
 * Collapsed whitespace and newlines are the obvious case ("Northpoint\n
 * Remodeling"). Markup is the case that matters: this template's logo is
 * `<span>NORTHPOINT</span><span>REMODELING</span>`, so the phrase is never
 * adjacent in the file. Widening the gap can only ever catch MORE leaks, which
 * is the direction this module is allowed to err in.
 */
const TOKEN_GAP = "(?:\\s|&nbsp;|<[^>]*>)+";

/**
 * A token as a WHOLE WORD (or whole phrase), case-insensitive.
 *
 * The bug this replaces: matching was a raw `indexOf` on lowercased text, so the
 * token "King" — a real template's demo business — matched inside wor·king,
 * boo·king, par·king, ma·king, ta·king. Every generated page contains at least
 * one of those, so the gate was unpassable for that template forever, and no
 * amount of AI repair could fix copy that must avoid every word containing
 * "king".
 *
 * The boundary is a lookaround on the WORD characters either side, not `\b`,
 * because `\b` is defined relative to the neighbouring character and would
 * misfire on tokens that begin or end with punctuation: `\b\(303\)` only matches
 * a phone number glued to a letter. So the guard is applied only at an edge the
 * token itself makes a word edge — "King" gets both, "(303) 555-1234" gets only
 * the trailing one, "+13035551234" likewise.
 *
 * The substring bug cannot come back through this: the pattern is built from
 * escaped literal words with a mandatory non-word boundary on every word-char
 * edge, so a match can never begin or end in the middle of a longer word.
 * `King` matches `King`, `KING`, `King's`, `King-Painting`, `>King<`; it does
 * not match `working`, `booking`, `parking`, `making`.
 */
function tokenPattern(token: string): RegExp | null {
  const t = token.trim();
  if (!t) return null;
  const parts = t.split(/\s+/).filter(Boolean).map(escapeRe);
  if (!parts.length) return null;
  const lead = WORD_CHAR_RE.test(t[0]) ? `(?<![${WORD_CHAR_CLASS}])` : "";
  const tail = WORD_CHAR_RE.test(t[t.length - 1]) ? `(?![${WORD_CHAR_CLASS}])` : "";
  return new RegExp(lead + parts.join(TOKEN_GAP) + tail, "i");
}

/**
 * Structural identifiers, blanked before the scan.
 *
 * `class`, `id` and `data-*` VALUES are the hooks the template's untouched CSS
 * and JS are wired to; the regenerator is required to reproduce them verbatim
 * and the structure gate fails if it does not. A demo word inside one is
 * therefore something the model is FORBIDDEN to change — flagging it is the same
 * dead end as the substring bug: a gate no correct output can pass.
 *
 * Everything a human actually reads is still scanned: visible text, comments,
 * `alt`, `title`, `href` and `src`. A demo domain in a link is a real leak.
 *
 * The mask is the same LENGTH as the value it replaces, so every match offset
 * still points at the right place in the original text and excerpts stay honest.
 */
const STRUCTURAL_ATTR_RE = /(\b(?:class|id|data-[a-zA-Z0-9_-]+)\s*=\s*)("[^"]*"|'[^']*'|[^\s"'`=<>]+)/gi;
const MASK_CHAR = " ";

function maskStructuralAttrs(content: string): string {
  return content.replace(STRUCTURAL_ATTR_RE, (_m, head: string, value: string) => {
    const quote = value[0] === '"' || value[0] === "'" ? value[0] : "";
    const innerLen = quote ? Math.max(0, value.length - 2) : value.length;
    return head + quote + MASK_CHAR.repeat(innerLen) + quote;
  });
}

/**
 * Every place a demo token survived into the generated output. `[]` is the pass
 * condition — the only thing that lets a site reach a client.
 *
 * Case-insensitive whole-word/whole-phrase matching, because "NORTHPOINT" in a
 * logo, "Northpoint" in prose and "northpointApp" in JS are the same leak — but
 * "working" is not a leak of "King". One entry per (file, token) so a token
 * repeated 40 times reports once; `files` should be the text files of the
 * generated site.
 *
 * Still pure and regex-only: the pattern cache is per-call, so the function has
 * no state to go stale and no reason to fail for environmental reasons.
 */
export function findLeaks(files: Record<string, string>, tokens: string[]): Leak[] {
  const patterns: { token: string; re: RegExp }[] = [];
  for (const token of tokens) {
    const re = tokenPattern(token);
    if (re) patterns.push({ token, re });
  }

  const leaks: Leak[] = [];
  for (const [file, content] of Object.entries(files)) {
    const hay = maskStructuralAttrs(content);
    for (const { token, re } of patterns) {
      const m = re.exec(hay);
      if (!m) continue;
      const at = m.index;
      leaks.push({
        file,
        token,
        excerpt: content.slice(Math.max(0, at - 40), at + m[0].length + 40).replace(/\s+/g, " ").trim(),
      });
    }
  }
  return leaks;
}
