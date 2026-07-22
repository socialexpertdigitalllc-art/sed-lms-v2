// Template Engine v2 — the template's own NICHE vocabulary: what the demo
// business the template was built for actually DOES, as opposed to demoTokens.ts
// (who the demo business IS).
//
// THE BUG CLASS THIS CLOSES. "Knights Auto Window Tint" (tinting, ceramic
// coating, PPF, wraps) was generated from a Denver remodeling template. The
// build PASSED — the leak gate is green, no demo name/phone/email survived —
// but the shipped copy still said "Full-service remodeling, start to finish.",
// alt="Kitchen remodeling", "<option>Kitchen remodel</option>", "cabinetry",
// "subcontractor" on every page below the <h1>. None of that is IDENTITY (it
// carries no business name, city or contact detail), so nothing in demoTokens.ts
// was ever going to catch it — trade vocabulary is deliberately GENERIC_WORDS
// there, on purpose, because a real remodeling client's site is SUPPOSED to say
// "remodeling". The gap is real: a weaker/cheaper model routed to this pipeline
// takes the personalize prompt's "return unchanged if unsure" exit constantly on
// copy it does not know how to rewrite for an unfamiliar trade, and nothing ever
// checked that the rewrite matched the CLIENT's trade rather than the
// TEMPLATE's.
//
// WHAT THIS MODULE DOES. Runs ONCE per template (upload + health re-check —
// mirrors extractDemoTokens's lifecycle), over the template's ORIGINAL,
// pre-personalization files, and derives the recurring service/category phrases
// a template's copy is built around: "kitchen remodeling", "bathroom
// remodeling", "cabinetry", and so on. Stored as `website_templates.niche_terms`
// — a SEPARATE column from `demo_tokens`: niche terms describe what the
// template's demo business SELLS, demo tokens describe WHO it is, and merging
// the two lists would make the identity leak gate fire on a client's own,
// perfectly legitimate trade vocabulary.
//
// THE SAME SURFACE, ON PURPOSE. `extractDemoTokens` reads the template with its
// own hand-rolled prose walk; this module instead reuses the EXACT extraction
// personalize.ts sends to the model — `extractTranslatable` (HTML) and
// `extractJsStrings` (JS) — because that is the surface a weak model is actually
// asked to rewrite. A niche-term list built from some OTHER reading of the
// template would not describe what the model saw, and (per the leakGuarantee.ts
// doctrine this module follows) a second hand-maintained definition of "the
// content" is exactly how the last three leak bugs shipped.
//
// Pure: no I/O, no AI, regex/string work only over already-loaded file text.

import { extractTranslatable } from "./textExtract";
import { extractJsStrings } from "./jsStrings";
import { GENERIC_WORDS, MARKUP_WORDS } from "./demoTokens";

const HTML_RE = /\.html?$/i;
const JS_RE = /\.m?js$/i;

/** Utterance-ending punctuation — a candidate phrase never crosses one. */
const SENTENCE_SPLIT_RE = /[.!?:;|•\n]+/;

/**
 * Grammatical connective words. Distinct from GENERIC_WORDS (industry/marketing
 * vocabulary a real client site legitimately uses) — these are pure function
 * words that carry no meaning on their own ("a", "of", "to"), so a phrase made
 * ENTIRELY of these-plus-GENERIC_WORDS is chrome, never a service descriptor.
 */
const STOPWORDS = new Set([
  "a", "an", "of", "to", "in", "on", "at", "is", "are", "was", "were", "be",
  "been", "being", "it", "its", "by", "as", "or", "if", "so", "do", "does",
  "did", "has", "have", "had", "will", "would", "can", "could", "should",
  "may", "might", "not", "no", "yes", "up", "out", "off", "over", "under",
  "into", "onto", "than", "then", "such", "any", "some", "each", "every",
]);

/** Contiguous word-run sizes that count as a candidate niche phrase. */
const N_GRAM_SIZES = [2, 3, 4] as const;

/** A phrase must recur across at least this many distinct extracted items. */
const MIN_ITEM_RECURRENCE = 2;

/** Bound on the returned list — cheap, and an operator-readable size. */
export const MAX_NICHE_TERMS = 40;

/**
 * demoTokens.ts's GENERIC_WORDS lumps two very different things into one set,
 * on purpose, FOR ITS OWN JOB: the identity gate only needs to know that
 * neither kind can stand alone as a brand token, so "kitchen" (industry
 * vocabulary) and "learn"/"quote" (site chrome) sit side by side in it.
 *
 * For NICHE-TERM extraction the two are opposites. "Kitchen Remodeling" and
 * "cabinetry" are exactly the recurring service vocabulary this module exists
 * to find; "Learn More" and "Get a Quote" are exactly the chrome it must
 * ignore. Treating the whole of GENERIC_WORDS as "chrome to filter out" would
 * therefore throw away the template's own service vocabulary — the industries
 * list IS that vocabulary. So this carves the industries back OUT of the
 * imported set (copied verbatim from demoTokens.ts's GENERIC_WORDS comment
 * block, not re-derived) before using the rest as the chrome filter.
 */
const INDUSTRY_WORDS = new Set([
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
]);

/** GENERIC_WORDS minus the industry vocabulary — company suffixes, marketing
 * adjectives, site chrome/nav labels and generic CTAs only. This — not the raw
 * import — is the "common template chrome" a niche phrase must avoid being
 * made ENTIRELY of. Extend HERE (not GENERIC_WORDS) for more chrome noise like
 * "Learn More" / "Get a Quote" / "Book Now" — each already resolves via its
 * constituent words ("learn", "more", "get", "quote", "book", "now" are all
 * already in GENERIC_WORDS), so no extension has been needed yet. */
const CHROME_WORDS = new Set([...GENERIC_WORDS].filter((w) => !INDUSTRY_WORDS.has(w)));

/** A word this phrase-builder treats as too generic/functional to carry meaning. */
function isChromeWord(w: string): boolean {
  return MARKUP_WORDS.has(w) || CHROME_WORDS.has(w) || STOPWORDS.has(w);
}

/** Lowercase word tokens, punctuation and possessive apostrophes stripped. */
function wordsOf(segment: string): string[] {
  return segment
    .toLowerCase()
    .split(/[^a-z0-9']+/i)
    .map((w) => w.replace(/^'+|'+$/g, ""))
    .filter(Boolean);
}

/**
 * Is this word-run worth keeping as a candidate? Every rule here is biased
 * toward DROPPING a candidate — this is the opposite asymmetry from
 * demoTokens.ts (which is biased toward catching too much identity): a missed
 * niche phrase costs nothing but a slightly smaller list, while a chrome phrase
 * kept as a "niche term" would make the drift guarantee rewrite or scrub
 * copy that was never wrong in the first place.
 */
function isKeepableGram(words: string[]): boolean {
  if (words.length < 2) return false;
  if (words.every((w) => /^[0-9]+$/.test(w))) return false; // purely numeric
  if (words.every(isChromeWord)) return false; // purely chrome/function words
  // At least one substantive (non-chrome, length >= 3) word — the same
  // "distinctive word" bar isDistinctive() applies in demoTokens.ts, adapted
  // from brand-detection to ordinary service vocabulary.
  return words.some((w) => w.length >= 3 && !isChromeWord(w));
}

/** One extracted item's translatable text, from the SAME surface personalize.ts sends to the model. */
function extractableTexts(file: string, content: string): string[] {
  if (HTML_RE.test(file)) {
    return extractTranslatable(content)
      .items.filter((i) => i.kind !== "contact") // mailto:/tel: — never prose
      .map((i) => i.text);
  }
  if (JS_RE.test(file)) {
    return extractJsStrings(content)
      .items.filter((i) => i.translatable) // code-shaped literals are never copy
      .map((i) => i.text);
  }
  return [];
}

/**
 * Derive the template's recurring niche/category vocabulary from its own,
 * pre-personalization files. `files` is a map of template-relative path -> text
 * content, exactly like `extractDemoTokens`'s argument — pass only text files.
 *
 * Returned phrases are lowercase-normalized, deduplicated, sorted by how many
 * distinct extracted items they recurred across (ties broken by phrase length
 * then alphabetically, so the result is deterministic for a given input), and
 * capped at MAX_NICHE_TERMS.
 */
export function extractNicheTerms(files: Record<string, string>): string[] {
  const freq = new Map<string, Set<string>>();
  let itemSeq = 0;

  for (const [file, content] of Object.entries(files)) {
    for (const text of extractableTexts(file, content)) {
      const itemKey = `${file}#${itemSeq++}`;
      for (const segment of text.split(SENTENCE_SPLIT_RE)) {
        const words = wordsOf(segment);
        for (const n of N_GRAM_SIZES) {
          for (let i = 0; i + n <= words.length; i++) {
            const gram = words.slice(i, i + n);
            if (!isKeepableGram(gram)) continue;
            const phrase = gram.join(" ");
            const cur = freq.get(phrase);
            if (cur) cur.add(itemKey);
            else freq.set(phrase, new Set([itemKey]));
          }
        }
      }
    }
  }

  return [...freq.entries()]
    .filter(([, items]) => items.size >= MIN_ITEM_RECURRENCE)
    .sort(
      ([a, itemsA], [b, itemsB]) =>
        itemsB.size - itemsA.size || b.length - a.length || a.localeCompare(b),
    )
    .slice(0, MAX_NICHE_TERMS)
    .map(([phrase]) => phrase);
}
