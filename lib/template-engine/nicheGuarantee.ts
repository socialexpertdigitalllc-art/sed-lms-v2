// Template Engine v2 — the terminal CATEGORY-DRIFT guarantee.
//
// THE BUG CLASS THIS CLOSES. "Knights Auto Window Tint" (tinting, ceramic
// coating, PPF, wraps) was generated from a Denver REMODELING template. The
// leak gate was green — no demo name, city, phone or email survived — but the
// shipped `index.html` still said, verbatim, "Full-service remodeling, start to
// finish.", alt="Kitchen remodeling", alt="Bathroom remodeling",
// "<option>Kitchen remodel</option>", and more remodeling vocabulary than tint
// vocabulary. Nothing was ever wrong with the leak gate: trade vocabulary is
// deliberately NOT identity (demoTokens.ts's GENERIC_WORDS says so on purpose —
// a real remodeling client's site is SUPPOSED to say "remodeling"), so no
// existing check was ever going to see this. This is the same discipline as
// leakGuarantee.ts, applied to a genuinely different failure surface.
//
// THE SAME PRINCIPLE AS leakGuarantee.ts: do not invent a second definition of
// "the content". A niche term is only ever looked for inside the SAME
// extraction surface personalize.ts already sends to the model
// (`extractTranslatable` / `extractJsStrings` — see findNicheDrift), never a
// fresh regex scan of raw HTML. That is also why this module's checks and the
// terminal scrub both hand their matching off to `literalPattern`
// (personalize.ts) — the one matcher, not two that can drift apart.
//
// TWO STAGES, like the leak class gets a repair round before its guarantee:
//   1. REPAIR ROUND (runnerV2.ts, AI, not in this module): the offending FILES
//      are re-personalized with a targeted repair note (repairNoteForNiche)
//      naming exactly which category words are wrong and what the client's real
//      business is. This module only supplies the pure pieces — detection and
//      the note text — because the round itself is an AI call.
//   2. TERMINAL SCRUB (this module, `guaranteeNoNicheDrift`, pure, deterministic):
//      whatever niche vocabulary survives the repair round is neutralized by
//      cycling in the client's own services — the SAME "service" replacement
//      class + cycling cursor buildScrubMachine's identity scrub already uses
//      (see personalize.ts's buildServiceScrubMachine), reused rather than
//      forked.
//
// THE CLIENT-SAFE COUNTERWEIGHT. A term is drift only if it does NOT also
// appear in the CLIENT's own content (services, about, site type, business
// name): a real remodeling client's site is allowed to say "Kitchen
// Remodeling" — flagging that would be exactly the "gate that always fails on
// correct work" mistake demoTokens.ts's GENERIC_WORDS comment warns about.
//
// Pure by construction (no I/O, no AI): the repair round lives in runnerV2.ts,
// which is the only place with an AI seam to call.

import { extractTranslatable } from "./textExtract";
import { extractJsStrings } from "./jsStrings";
import {
  buildServiceScrubMachine,
  clientIdentityOf,
  literalPattern,
  scrubText,
  servicesOf,
} from "./personalize";

const HTML_RE = /\.html?$/i;
const JS_RE = /\.m?js$/i;

/** One extracted item whose text still carries a niche term the client cannot claim. */
export interface NicheDriftHit {
  file: string;
  itemId: string;
  term: string;
  /** The item's text at the time it was flagged. */
  text: string;
}

/**
 * Every string a niche term is legitimately allowed to appear in: the client's
 * own services (name/short/long/bullets), identity (name/tagline/positioning),
 * about copy, and — when the caller has it — the brief fields the spec names
 * explicitly (`business_name`, `site_type`, `about_business`, the raw
 * `services` list the sales team captured before planning ever touched it).
 * `brief` is optional: the detection still works from the content model alone
 * (every call site in runnerV2 has one), but passing the brief widens the
 * safe-list to the client's own words, not just the planner's paraphrase of
 * them — see AGENTS-facing spec's "site_type, about_business" wording.
 */
function clientCorpus(contentModel: unknown, brief?: unknown): string {
  const parts: string[] = [];
  const push = (v: unknown) => {
    if (typeof v === "string" && v.trim()) parts.push(v);
  };
  const cm = contentModel as Record<string, unknown> | null;
  if (cm && typeof cm === "object") {
    const identity = cm.identity as Record<string, unknown> | undefined;
    if (identity && typeof identity === "object") {
      push(identity.name);
      push(identity.tagline);
      push(identity.positioning);
    }
    const services = Array.isArray(cm.services) ? cm.services : [];
    for (const s of services) {
      if (!s || typeof s !== "object") continue;
      const svc = s as Record<string, unknown>;
      push(svc.name);
      push(svc.short);
      push(svc.long);
      if (Array.isArray(svc.bullets)) for (const b of svc.bullets) push(b);
    }
    const about = cm.about as Record<string, unknown> | undefined;
    if (about && typeof about === "object") {
      push(about.story);
      if (Array.isArray(about.why_us)) for (const w of about.why_us) push(w);
    }
  }
  const b = brief as Record<string, unknown> | null;
  if (b && typeof b === "object") {
    push(b.business_name);
    push(b.site_type);
    push(b.about_business);
    if (Array.isArray(b.services)) for (const s of b.services) push(s);
  }
  return parts.join("\n");
}

/**
 * Is `term` something the CLIENT's own content already claims? Whole-word /
 * whole-phrase, case-insensitive — the same `literalPattern` matcher every
 * other identity/scrub check in this pipeline uses, so "safe" here means the
 * exact same thing it means everywhere else.
 */
export function isNicheTermClientSafe(term: string, contentModel: unknown, brief?: unknown): boolean {
  const re = literalPattern(term);
  if (!re) return false;
  re.lastIndex = 0;
  return re.test(clientCorpus(contentModel, brief));
}

/** One file's extracted, translatable items — the SAME surface personalize.ts sends to the model. */
function translatableItems(file: string, content: string): { id: string; text: string }[] {
  if (HTML_RE.test(file)) {
    return extractTranslatable(content)
      .items.filter((i) => i.kind !== "contact")
      .map((i) => ({ id: i.id, text: i.text }));
  }
  if (JS_RE.test(file)) {
    return extractJsStrings(content)
      .items.filter((i) => i.translatable)
      .map((i) => ({ id: i.id, text: i.text }));
  }
  return [];
}

/**
 * Every extracted item whose FINAL text still carries a niche term the client
 * cannot claim as their own. `nicheTerms` is the template's stored
 * `niche_terms` (see nicheTerms.ts); client-safety is resolved ONCE per term
 * (it does not depend on which item it appears in), then every translatable
 * item of every file is checked against the remaining candidates.
 */
export function findNicheDrift(args: {
  files: Record<string, string>;
  nicheTerms: string[];
  contentModel: unknown;
  brief?: unknown;
}): NicheDriftHit[] {
  const { files, nicheTerms, contentModel, brief } = args;
  const terms = [...new Set(nicheTerms.map((t) => t.trim()).filter(Boolean))];
  if (terms.length === 0) return [];

  const candidates = terms.filter((t) => !isNicheTermClientSafe(t, contentModel, brief));
  if (candidates.length === 0) return [];

  const patterns = candidates
    .map((term) => ({ term, re: literalPattern(term) }))
    .filter((p): p is { term: string; re: RegExp } => p.re !== null);
  if (patterns.length === 0) return [];

  const hits: NicheDriftHit[] = [];
  for (const [file, content] of Object.entries(files)) {
    for (const item of translatableItems(file, content)) {
      for (const { term, re } of patterns) {
        re.lastIndex = 0;
        if (re.test(item.text)) hits.push({ file, itemId: item.id, term, text: item.text });
      }
    }
  }
  return hits;
}

/**
 * One targeted repair note for the SAME repair mechanism the leak/structure
 * gate already uses (`repairNoteFor` + the offender-file repair loop in
 * runnerV2.ts): names exactly which category words are wrong and what the
 * client's real business is, so the model's second pass is fixing a named
 * problem rather than re-guessing at the whole file again.
 */
export function repairNoteForNiche(hits: NicheDriftHit[], contentModel: unknown): string {
  if (hits.length === 0) return "";
  const terms = [...new Set(hits.map((h) => h.term))];
  const client = clientIdentityOf(contentModel);
  const business = client.name || "this business";
  const services = servicesOf(contentModel);
  const servicesLine = services.length ? services.join(", ") : "its actual services (see the content model)";
  return (
    `These strings still describe "${terms.join('", "')}" — a DIFFERENT trade or category than ${business} ` +
    `is in. Rewrite them so they describe what ${business} ACTUALLY does: ${servicesLine}. ` +
    `Do not simply delete the words — write copy that fits the string's original role (heading, option, alt text, etc.) ` +
    `for ${business}'s real services.`
  );
}

/** One (file, term) neutralization, for the operator-facing summary line. */
export interface NicheFix {
  file: string;
  term: string;
  occurrences: number;
}

export interface NicheGuaranteeReport {
  fixes: NicheFix[];
}

export interface NicheGuaranteeResult {
  files: Record<string, string>;
  report: NicheGuaranteeReport;
}

/**
 * The terminal guarantee: whatever niche-term drift survives the (optional, AI)
 * repair round is neutralized deterministically, so `findNicheDrift` on the
 * returned files reports nothing the client cannot claim as their own. Cheap
 * and a no-op on clean input (one `findNicheDrift` scan, no allocation), and
 * idempotent — running it twice is running it once.
 *
 * Reassembly goes through the SAME extraction's `apply()` splice every other
 * pass in this pipeline uses, so markup, tags and attributes are untouched —
 * only the flagged items' TEXT changes.
 */
export function guaranteeNoNicheDrift(args: {
  files: Record<string, string>;
  nicheTerms: string[];
  contentModel: unknown;
  brief?: unknown;
}): NicheGuaranteeResult {
  const { nicheTerms, contentModel, brief } = args;
  const files = { ...args.files };
  const hits = findNicheDrift({ files, nicheTerms, contentModel, brief });
  if (hits.length === 0) return { files, report: { fixes: [] } };

  // Built ONLY from the terms that actually drifted (client-safe terms were
  // already excluded by findNicheDrift) — a machine built from every stored
  // niche term would also rewrite vocabulary the client legitimately shares
  // with the template, which is exactly the false-positive this guarantee must
  // not create.
  const driftTerms = [...new Set(hits.map((h) => h.term))];
  const machine = buildServiceScrubMachine(driftTerms, contentModel);

  const byFile = new Map<string, NicheDriftHit[]>();
  for (const h of hits) {
    const cur = byFile.get(h.file);
    if (cur) cur.push(h);
    else byFile.set(h.file, [h]);
  }

  const fixes: NicheFix[] = [];
  const recordFix = (file: string, term: string, n: number) => {
    const cur = fixes.find((f) => f.file === file && f.term === term);
    if (cur) cur.occurrences += n;
    else fixes.push({ file, term, occurrences: n });
  };

  for (const [file, fileHits] of byFile) {
    const content = files[file];
    const isHtml = HTML_RE.test(file);
    const extracted = isHtml ? extractTranslatable(content) : extractJsStrings(content);
    const map: Record<string, string> = {};
    let touched = false;
    const itemIds = new Set(fileHits.map((h) => h.itemId));
    for (const itemId of itemIds) {
      const item = extracted.items.find((i) => i.id === itemId);
      if (!item) continue;
      const before = item.text;
      const after = scrubText(before, machine);
      if (after === before) continue;
      map[itemId] = after;
      touched = true;
      for (const term of driftTerms) {
        const re = literalPattern(term);
        if (!re) continue;
        const n = (before.match(re) ?? []).length;
        if (n > 0) recordFix(file, term, n);
      }
    }
    if (touched) files[file] = extracted.apply(map);
  }

  return { files, report: { fixes } };
}

/**
 * One operator-readable line for the verify step detail, in the same style as
 * describeLeakGuarantee: "category-drift guarantee fixed 12 occurrence(s)
 * across 3 file(s)".
 */
export function describeNicheGuarantee(report: NicheGuaranteeReport): string {
  const total = report.fixes.reduce((n, f) => n + f.occurrences, 0);
  if (total === 0) return "";
  const files = new Set(report.fixes.map((f) => f.file));
  return `category-drift guarantee fixed ${total} occurrence(s) across ${files.size} file(s)`;
}

/**
 * The identity of a niche-drift FAILURE, for the repair loop's stalled-round
 * check — mirrors `gateFingerprint`/`repairStalled` in runnerV2.ts exactly, so
 * a round that regenerates the offending files and comes back with the same
 * drift in the same files stops immediately instead of burning further AI
 * calls on a term the model cannot resolve (see runnerV2.ts's repair loop).
 */
export function nicheDriftFingerprint(hits: NicheDriftHit[]): string {
  return JSON.stringify([...new Set(hits.map((h) => `${h.file}:${h.term}`))].sort());
}
