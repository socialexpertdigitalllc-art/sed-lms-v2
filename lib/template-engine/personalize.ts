// Template Engine v2 — text-only personalisation (the small-model fix).
//
// THE FAILURE THIS REPLACES. `regenerateFile` sends a whole template file to the
// model and demands the whole file back with every tag, id, data-* and JS
// identifier reproduced exactly. That only survives on a top-tier long-output
// model. Routed at MiniMax the output collapsed — `circle: 8 -> 0`,
// `svg: 19 -> 11`, nearly every identifier missing from `script.js` — and the
// demo business's name, phone and email came back unreplaced. The pipeline was
// depending on heroic long-output fidelity for what is, at heart, a copy edit.
//
// THE FIX. Send the TEXT, not the markup:
//   1. Extract only the translatable strings (textExtract.ts / jsStrings.ts).
//   2. Substitute the demo identity DETERMINISTICALLY — phone, email, domain and
//      the demo business name are exact substitutions, and code does them better
//      than any model. This is what removes most leak-gate failures.
//   3. Send what is left to the model in BOUNDED BATCHES (~60 items / ~4000
//      chars), asking for a strict `{"id": "new text"}` map. A small model is
//      never asked for more than a few hundred tokens at a time.
//   4. Reassemble deterministically by splicing back at the original offsets.
//      An id the model omits or mangles keeps its ORIGINAL text — never blank.
//
// The markup never reaches the model, so tag counts, ids, data-* attributes and
// JS identifiers cannot change: the structure gate becomes a safety net rather
// than the thing that fails. Output shrinks ~10-20x, which is also the answer to
// "the build is too slow".
//
// The old whole-file path is NOT deleted — see regenerate.ts and the
// `regen_mode` switch in runnerV2. It is the escape hatch if this regresses.

import { parse, type HTMLElement, type Node } from "node-html-parser";
import { callForTask } from "@/lib/ai-tools/providers/run";
import { isAbortedError } from "@/lib/ai-tools/abort";
import { parseJsonLoose } from "@/lib/ai/json";
import { attrValueRange, escapeFor, extractTranslatable, type Escape } from "./textExtract";
import { extractJsStrings } from "./jsStrings";

const HTML_RE = /\.html?$/i;
const JS_RE = /\.m?js$/i;

/** Bounds on ONE request, so a small-output model is never overloaded. */
export const MAX_ITEMS_PER_BATCH = 60;
export const MAX_CHARS_PER_BATCH = 4000;

/** Per-batch attempts. A batch that never succeeds keeps its originals. */
const BATCH_ATTEMPTS = 2;

/** How many batches of one file are in flight at once. */
const BATCH_CONCURRENCY = 3;

export const PERSONALIZE_SYSTEM = `You are a precise COPY-EDITOR for small-business websites.

You are given a JSON list of short strings taken out of ONE page of a website template, plus the content model of the real business the page is being rewritten for. You rewrite the strings so they belong to that business, and you return a JSON object mapping each string's id to its new text.

ABSOLUTE RULES
- Output ONLY a single JSON object: {"<id>": "<new text>"}. No prose, no markdown fences, no extra keys, no nested objects.
- Answer EVERY id you were given, exactly once, using the id verbatim.
- Rewrite the TEXT ONLY. Never add HTML tags, markdown, quotes or emoji that were not in the original. Keep roughly the original length — these strings sit in a fixed design, and a headline three times longer breaks the layout.
- Use ONLY the supplied content model for facts. Never invent licences, awards, certifications, years in business, prices or guarantees.
- Replace 100% of the template's demo identity: no other business name, city, service area, person name, phone or email may survive in your text. The client's own details come from the content model.
- Keep the FUNCTION of each string: a nav label stays a short nav label, a button stays a call to action, a heading stays a heading, a testimonial stays a testimonial with a plausible local customer name.
- Match the tone of the content model's positioning. Write specific, professional copy — never lorem ipsum, never "Your Company", never a placeholder.
- If a string is already correct for this business, or you are unsure what it means, return it UNCHANGED. Never return an empty string.`;

export interface PersonalizeStats {
  file: string;
  /** Strings extracted from the file. */
  items: number;
  /** Strings changed by the deterministic identity pass. */
  deterministic: number;
  /** Strings the model rewrote. */
  rewritten: number;
  /** Strings that kept their (possibly identity-substituted) original text. */
  keptOriginal: number;
  batches: number;
  batchesFailed: number;
  /** `<img>`/`srcset`/inline-background URLs swapped for curated images. */
  imagesApplied: number;
}

export interface PersonalizeResult {
  text: string;
  stats: PersonalizeStats;
}

export interface PersonalizeArgs {
  file: string;
  source: string;
  contentModel: unknown;
  /** Resolved image URLs for this file, in order (hero/service/etc.). */
  imagesForFile: unknown;
  /** The template's demo identity — must not survive into the output. */
  demoTokens: string[];
  /** On a verification-repair pass, the exact leak/structure problems to fix. */
  repairNote?: string;
  signal?: AbortSignal;
}

/* --------------------------------------------------------- demo identity */

const EMAIL_TOKEN_RE = /^[^\s@]+@[^\s@]+\.[a-zA-Z]{2,}$/;
const DOMAIN_TOKEN_RE = /^[a-zA-Z0-9][a-zA-Z0-9-]*(?:\.[a-zA-Z0-9-]+)+$/;
const PHONE_TOKEN_RE = /^[+(]?\d[\d\s().+-]{5,}$/;

export interface DemoIdentity {
  emails: string[];
  domains: string[];
  phones: string[];
  /** The demo business name, longest first, then its individual distinctive words. */
  brands: string[];
}

/**
 * Split the stored `demo_tokens` into the classes the deterministic pass can act
 * on. The token list is emitted in descending order of specificity (the brand
 * phrase first — see demoTokens.ts), so the first non-contact token is the demo
 * business name and the single words that belong to it follow it.
 *
 * Geography tokens ("Cherry Creek") deliberately do NOT get a deterministic
 * substitution: there is no 1:1 client equivalent, so they are left for the
 * model, which rewrites the sentence around them.
 */
export function classifyDemoTokens(tokens: string[]): DemoIdentity {
  const emails: string[] = [];
  const domains: string[] = [];
  const phones: string[] = [];
  const rest: string[] = [];
  for (const raw of tokens) {
    const t = raw.trim();
    if (!t) continue;
    if (EMAIL_TOKEN_RE.test(t)) emails.push(t);
    else if (PHONE_TOKEN_RE.test(t) && t.replace(/\D/g, "").length >= 7) phones.push(t);
    else if (DOMAIN_TOKEN_RE.test(t) && !/\s/.test(t)) domains.push(t);
    else rest.push(t);
  }
  const brands: string[] = [];
  const phrase = rest.find((t) => /\s/.test(t)) ?? rest[0];
  if (phrase) {
    brands.push(phrase);
    const words = new Set(phrase.toLowerCase().split(/\s+/));
    for (const t of rest) {
      if (t === phrase) continue;
      if (!/\s/.test(t) && words.has(t.toLowerCase())) brands.push(t);
    }
  }
  // Longest first so "Northpoint Remodeling" is consumed before "Northpoint".
  brands.sort((a, b) => b.length - a.length);
  return { emails, domains, phones, brands };
}

export interface ClientIdentity {
  name: string;
  firstWord: string;
  phone: string;
  /** Digits (and a leading +) only — what a `tel:` href needs. */
  phoneDigits: string;
  email: string;
  domain: string;
}

export function clientIdentityOf(contentModel: unknown): ClientIdentity {
  const identity =
    contentModel && typeof contentModel === "object"
      ? ((contentModel as { identity?: Record<string, unknown> }).identity ?? {})
      : {};
  const name = typeof identity.name === "string" ? identity.name.trim() : "";
  const phone = typeof identity.phone === "string" ? identity.phone.trim() : "";
  const email = typeof identity.email === "string" ? identity.email.trim() : "";
  return {
    name,
    firstWord: name.split(/\s+/)[0] ?? "",
    phone,
    phoneDigits: phone.replace(/[^\d+]/g, ""),
    email,
    domain: email.includes("@") ? email.split("@")[1] : "",
  };
}

const RE_META = /[.*+?^${}()|[\]\\]/g;
const WORD_CHAR_RE = /[A-Za-z0-9_]/;

/**
 * A token as a whole word/phrase, case-insensitive, matching LITERAL text only.
 * Unlike the leak gate's pattern this never bridges markup — items are already
 * plain strings, and a gap-bridging pattern here could eat real copy.
 */
function literalPattern(token: string): RegExp | null {
  const t = token.trim();
  if (!t) return null;
  const body = t.replace(/\s+/g, " ").replace(RE_META, "\\$&").replace(/ /g, "\\s+");
  const lead = WORD_CHAR_RE.test(t[0]) ? "(?<![A-Za-z0-9_])" : "";
  const tail = WORD_CHAR_RE.test(t[t.length - 1]) ? "(?![A-Za-z0-9_])" : "";
  return new RegExp(lead + body + tail, "gi");
}

interface Rule {
  re: RegExp;
  to: string;
}

/**
 * The deterministic pre-pass: the substitutions that are exact, that a model
 * gets wrong often enough to matter, and that the leak gate fails a build over.
 *
 * Phone, email and domain are literal swaps. The business name is swapped whole
 * ("Northpoint Remodeling" -> the client's name) and its individual brand words
 * are swapped for the client's FIRST word, which is what makes a split logo
 * (`<span>NORTHPOINT</span><span>REMODELING</span>`) come out sane.
 *
 * A demo class with no client equivalent (no phone on the lead, say) produces no
 * rule at all: leaving the template's text for the model to handle is better
 * than blanking a contact detail.
 */
export function buildIdentityRules(demo: DemoIdentity, client: ClientIdentity): Rule[] {
  const rules: Rule[] = [];
  const push = (token: string, to: string) => {
    if (!to) return;
    const re = literalPattern(token);
    if (re) rules.push({ re, to });
  };
  for (const email of demo.emails) push(email, client.email);
  for (const domain of demo.domains) push(domain, client.domain);
  for (const phone of demo.phones) {
    // A digits-only demo token came from a `tel:` href; keep that shape.
    push(phone, /^\+?\d+$/.test(phone) ? client.phoneDigits : client.phone);
  }
  for (const brand of demo.brands) {
    push(brand, /\s/.test(brand) ? client.name : client.firstWord);
  }
  return rules;
}

export function substituteIdentity(text: string, rules: Rule[]): string {
  let out = text;
  for (const rule of rules) {
    rule.re.lastIndex = 0;
    out = out.replace(rule.re, rule.to);
  }
  return out;
}

/* ------------------------------------------------------------- batching */

export interface Batch {
  items: { id: string; context?: string; text: string }[];
  chars: number;
}

/**
 * Cut the item list into requests no bigger than the caps. A single item longer
 * than the char cap gets a batch to itself rather than being split — the model
 * must always see a whole string.
 */
export function planBatches(
  items: { id: string; context?: string; text: string }[],
  maxItems = MAX_ITEMS_PER_BATCH,
  maxChars = MAX_CHARS_PER_BATCH,
): Batch[] {
  const batches: Batch[] = [];
  let current: Batch = { items: [], chars: 0 };
  for (const item of items) {
    const cost = item.text.length + (item.context?.length ?? 0) + item.id.length + 24;
    if (current.items.length > 0 && (current.items.length >= maxItems || current.chars + cost > maxChars)) {
      batches.push(current);
      current = { items: [], chars: 0 };
    }
    current.items.push(item);
    current.chars += cost;
  }
  if (current.items.length > 0) batches.push(current);
  return batches;
}

export function batchPrompt(args: {
  file: string;
  contentModel: unknown;
  batch: Batch;
  repairNote?: string;
}): string {
  const repair = args.repairNote
    ? `\n\nA PREVIOUS ATTEMPT FAILED VERIFICATION. Fix exactly these problems in the strings below and change nothing else:\n${args.repairNote}`
    : "";
  return `Rewrite these strings from "${args.file}" so they belong to the business below.

BUSINESS CONTENT MODEL (the only source of facts):
${JSON.stringify(args.contentModel)}${repair}

STRINGS (${args.batch.items.length}) — "context" tells you where the string sits:
${JSON.stringify(args.batch.items)}

Return ONLY a JSON object mapping every id above to its rewritten text, e.g. {"t1":"...","t2":"..."}.`;
}

/**
 * Accept the model's answer as a flat id -> string map. Tolerates the two shapes
 * small models actually emit: the object it was asked for, and an array of
 * `{id, text}` records. Everything else yields an empty map, and every id then
 * keeps its original text.
 */
export function parseBatchResponse(raw: string): Record<string, string> {
  const parsed = parseJsonLoose<unknown>(raw);
  const out: Record<string, string> = {};
  if (!parsed) return out;
  if (Array.isArray(parsed)) {
    for (const entry of parsed) {
      if (!entry || typeof entry !== "object") continue;
      const rec = entry as Record<string, unknown>;
      const id = typeof rec.id === "string" ? rec.id : "";
      const text = typeof rec.text === "string" ? rec.text : typeof rec.value === "string" ? rec.value : "";
      if (id && text) out[id] = text;
    }
    return out;
  }
  if (typeof parsed === "object") {
    for (const [id, value] of Object.entries(parsed as Record<string, unknown>)) {
      if (typeof value === "string") out[id] = value;
    }
  }
  return out;
}

/**
 * Is the model's answer usable for this item? A runaway expansion is the one
 * failure mode that damages a fixed design, and an empty answer would blank
 * copy — both fall back to the original.
 */
function acceptable(original: string, next: string): boolean {
  const t = next.trim();
  if (!t) return false;
  return t.length <= Math.max(200, original.length * 4);
}

/* ------------------------------------------------------------- the pass */

/** Items are only worth a model call when they are prose the model can improve. */
function modelWorthy(kind: string, text: string, client: ClientIdentity): boolean {
  if (kind === "contact") return false; // mailto:/tel: — deterministic only
  const t = text.trim();
  if (!/\p{L}/u.test(t)) return false;
  // Already exactly the client's own identity: nothing left to personalise, and
  // a rewrite could only corrupt it.
  if (client.name && t === client.name) return false;
  if (client.phone && t === client.phone) return false;
  if (client.email && t === client.email) return false;
  return true;
}

async function runPool<T>(jobs: (() => Promise<T>)[], limit: number): Promise<T[]> {
  const out: T[] = new Array(jobs.length);
  let next = 0;
  const workers = Array.from({ length: Math.min(limit, jobs.length) }, async () => {
    for (;;) {
      const i = next++;
      if (i >= jobs.length) return;
      out[i] = await jobs[i]();
    }
  });
  await Promise.all(workers);
  return out;
}

/**
 * Personalise ONE template file. Never throws for a model that answers badly —
 * a batch that fails leaves its strings as they were, and the gates decide. It
 * DOES throw when every batch failed, because that is a provider outage and
 * shipping a page nobody rewrote is the v1 bug.
 */
export async function personalizeFile(args: PersonalizeArgs): Promise<PersonalizeResult> {
  const { file, source, contentModel, demoTokens, signal } = args;
  const isHtml = HTML_RE.test(file);
  const isJs = JS_RE.test(file);
  if (!isHtml && !isJs) {
    return {
      text: source,
      stats: emptyStats(file),
    };
  }

  const client = clientIdentityOf(contentModel);
  const rules = buildIdentityRules(classifyDemoTokens(demoTokens), client);

  // 1. extract -------------------------------------------------------------
  const extracted = isHtml ? extractTranslatable(source) : extractJsStrings(source);
  const items: WorkItem[] = isHtml
    ? extractTranslatableItems(extracted as ReturnType<typeof extractTranslatable>)
    : extractJsItems(extracted as ReturnType<typeof extractJsStrings>);

  // 2. deterministic identity pass (over EVERY string, including the ones the
  //    model will never see — a demo email inside a code-shaped literal is
  //    still a leak) ------------------------------------------------------
  const map: Record<string, string> = {};
  let deterministic = 0;
  for (const item of items) {
    const next = substituteIdentity(item.text, rules);
    map[item.id] = next;
    if (next !== item.text) deterministic++;
  }

  // 3. batch the rest to the model ----------------------------------------
  const forModel = items
    .filter((i) => i.translatable && modelWorthy(i.kind, map[i.id], client))
    .map((i) => ({ id: i.id, context: i.context, text: map[i.id] }));
  const batches = planBatches(forModel);

  const results = await runPool(
    batches.map((batch) => () => callBatch({ ...args, batch })),
    BATCH_CONCURRENCY,
  );

  let rewritten = 0;
  let batchesFailed = 0;
  const byId = new Map(items.map((i) => [i.id, i] as const));
  for (const result of results) {
    if (result.failed) batchesFailed++;
    for (const [id, value] of Object.entries(result.map)) {
      const item = byId.get(id);
      if (!item) continue; // an id the model invented
      const current = map[id];
      if (!acceptable(current, value)) continue;
      const next = value.trim();
      if (next === current) continue;
      map[id] = next;
      rewritten++;
    }
  }
  // Every batch threw (network, provider outage, a model that never answered).
  // Shipping a page nobody edited is the v1 bug, so this is loud.
  if (batches.length > 0 && batchesFailed === batches.length) {
    throw new Error(`Personalisation of ${file}: all ${batches.length} model batch(es) failed`);
  }

  // 4. reassemble deterministically ---------------------------------------
  let text = extracted.apply(map);
  let imagesApplied = 0;
  if (isHtml) {
    const applied = applyImagesToHtml(text, imageUrlsOf(args.imagesForFile));
    text = applied.html;
    imagesApplied = applied.count;
  }

  const stats: PersonalizeStats = {
    file,
    items: items.length,
    deterministic,
    rewritten,
    keptOriginal: items.length - rewritten,
    batches: batches.length,
    batchesFailed,
    imagesApplied,
  };
  console.info(
    `[template-engine] personalize ${file}: ${stats.items} strings, ${stats.deterministic} deterministic, ` +
      `${stats.rewritten} model-rewritten, ${stats.keptOriginal} kept, ${stats.batches} batch(es)` +
      `${stats.batchesFailed ? ` (${stats.batchesFailed} failed)` : ""}, ${stats.imagesApplied} image ref(s)`,
  );
  return { text, stats };
}

function emptyStats(file: string): PersonalizeStats {
  return {
    file,
    items: 0,
    deterministic: 0,
    rewritten: 0,
    keptOriginal: 0,
    batches: 0,
    batchesFailed: 0,
    imagesApplied: 0,
  };
}

/** One extracted string, normalised across the HTML and JS extractors. */
interface WorkItem {
  id: string;
  kind: string;
  text: string;
  context?: string;
  /** False for JS literals that are code in disguise — deterministic pass only. */
  translatable: boolean;
}

function extractTranslatableItems(extracted: ReturnType<typeof extractTranslatable>): WorkItem[] {
  return extracted.items.map((i) => ({ id: i.id, kind: i.kind, text: i.text, context: i.context, translatable: true }));
}

function extractJsItems(extracted: ReturnType<typeof extractJsStrings>): WorkItem[] {
  return extracted.items.map((i) => ({
    id: i.id,
    kind: "js",
    text: i.text,
    context: "js string",
    translatable: i.translatable,
  }));
}

/**
 * One batch, with its own small retry.
 *
 * `failed` means the CALL never came back (network, provider, abort-free
 * error) — that is the only condition that can fail a whole file. A model that
 * answers with nothing usable is not a failure: those strings simply keep the
 * text they already have, which is the whole point of the design.
 */
async function callBatch(
  args: PersonalizeArgs & { batch: Batch },
): Promise<{ map: Record<string, string>; failed: boolean }> {
  const prompt = batchPrompt({
    file: args.file,
    contentModel: args.contentModel,
    batch: args.batch,
    repairNote: args.repairNote,
  });
  // Output is bounded by what went in: rewritten copy is about the same length
  // as the original, so a small model is never asked for a heroic completion.
  const maxTokens = Math.min(8000, Math.max(1200, Math.ceil(args.batch.chars * 1.2)));
  for (let attempt = 1; attempt <= BATCH_ATTEMPTS; attempt++) {
    try {
      const { text } = await callForTask("file_regen", PERSONALIZE_SYSTEM, prompt, {
        maxTokens,
        temperature: 0.3,
        signal: args.signal,
      });
      const parsed = parseBatchResponse(text);
      // An empty answer is worth ONE more sample, but not an error: on the last
      // attempt it resolves as "the model had nothing to say".
      if (Object.keys(parsed).length === 0 && attempt < BATCH_ATTEMPTS) {
        throw new Error("no usable ids in response");
      }
      return { map: parsed, failed: false };
    } catch (e) {
      if (isAbortedError(e) || args.signal?.aborted) throw e;
      if (attempt >= BATCH_ATTEMPTS) {
        console.warn(
          `[template-engine] personalize ${args.file}: batch of ${args.batch.items.length} failed — ` +
            `${e instanceof Error ? e.message : String(e)}; keeping original text`,
        );
        return { map: {}, failed: true };
      }
      await new Promise((r) => setTimeout(r, 1000 * attempt));
    }
  }
  return { map: {}, failed: true };
}

/* -------------------------------------------------------------- images */

/**
 * The curated image URLs for this file, in slot order. Shape-tolerant: the
 * runner passes `{slot_id, kind, url, source}[]`, but a bare string list works
 * too.
 */
export function imageUrlsOf(imagesForFile: unknown): string[] {
  if (!Array.isArray(imagesForFile)) return [];
  const out: string[] = [];
  for (const entry of imagesForFile) {
    if (typeof entry === "string" && entry.trim()) out.push(entry.trim());
    else if (entry && typeof entry === "object") {
      const url = (entry as { url?: unknown }).url;
      if (typeof url === "string" && url.trim()) out.push(url.trim());
    }
  }
  return out;
}

const IMAGE_PATH_RE = /\.(?:png|jpe?g|gif|webp|avif|bmp)(?:[?#]|$)/i;
/** A brand mark is not a photo slot — the logo pass owns it (logo.ts). */
const LOGO_HINT_RE = /logo|brand|favicon/i;
const CSS_URL_RE = /url\(\s*(['"]?)([^'")]+)\1\s*\)/gi;

const ELEMENT_NODE = 1;
function isElement(node: Node): node is HTMLElement {
  return node.nodeType === ELEMENT_NODE;
}

/**
 * Swap the template's photo references for the curated images, in document
 * order, cycling the list when the page has more slots than images. Purely
 * deterministic and offset-spliced, so it cannot disturb structure.
 *
 * This is the same wiring the whole-file prompt asked the model to do ("replace
 * the template's image src/srcset … in order"); moving it into code is forced by
 * the model no longer seeing the markup, and it is strictly more reliable — a
 * surviving template image path is itself a leak-gate failure.
 */
export function applyImagesToHtml(html: string, urls: string[]): { html: string; count: number } {
  if (urls.length === 0) return { html, count: 0 };
  const root = parse(html);
  const edits: { start: number; end: number; value: string; escape: Escape }[] = [];
  let n = 0;
  const nextUrl = () => urls[n++ % urls.length];

  const walk = (el: HTMLElement) => {
    const tag = (el.rawTagName ?? "").toLowerCase();
    if (tag === "script" || tag === "style") return;

    const isImg = tag === "img";
    const isSource = tag === "source";
    if (isImg || isSource) {
      const src = el.getAttribute("src") ?? "";
      const srcset = el.getAttribute("srcset") ?? "";
      const cls = `${el.getAttribute("class") ?? ""} ${el.getAttribute("id") ?? ""} ${el.getAttribute("alt") ?? ""} ${src}`;
      const isLogo = LOGO_HINT_RE.test(cls);
      const pointsAtImage = IMAGE_PATH_RE.test(src) || IMAGE_PATH_RE.test(srcset) || (isImg && src !== "");
      if (!isLogo && pointsAtImage) {
        const url = nextUrl();
        for (const attr of ["src", "srcset", "data-src"] as const) {
          if (!el.getAttribute(attr)) continue;
          const range = attrValueRange(html, el, attr);
          if (range) edits.push({ ...range, value: url });
        }
      }
    }

    const style = el.getAttribute("style") ?? "";
    if (style && CSS_URL_RE.test(style)) {
      CSS_URL_RE.lastIndex = 0;
      let touched = false;
      const rewritten = style.replace(CSS_URL_RE, (whole, quote: string, path: string) => {
        if (!IMAGE_PATH_RE.test(path)) return whole;
        touched = true;
        return `url(${quote}${nextUrl()}${quote})`;
      });
      if (touched) {
        const range = attrValueRange(html, el, "style");
        if (range) edits.push({ ...range, value: rewritten });
      }
    }

    for (const child of el.childNodes ?? []) {
      if (isElement(child)) walk(child);
    }
  };
  walk(root);

  edits.sort((a, b) => a.start - b.start);
  let out = "";
  let cursor = 0;
  let count = 0;
  for (const edit of edits) {
    if (edit.start < cursor) continue;
    out += html.slice(cursor, edit.start) + escapeFor(edit.escape, edit.value);
    cursor = edit.end;
    count++;
  }
  return { html: out + html.slice(cursor), count };
}
