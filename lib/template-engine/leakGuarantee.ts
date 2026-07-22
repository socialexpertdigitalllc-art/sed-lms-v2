// Template Engine v2 — the terminal leak guarantee.
//
// THE BUG CLASS THIS CLOSES. Three leak bugs in a row had the same shape: the
// leak GATE (findLeaks) and the leak SCRUB (personalize.ts) each defined
// "content" as their own hand-maintained list of surfaces, and every mismatch
// shipped a leak. JS string literals leaked until the scrub learned about
// them; HTML comments and inline scripts leaked until it learned about those;
// then generation 5de9fe33 failed on demo geography inside map-iframe `src`
// URLs — a surface the text extractor (correctly) never sends to the model,
// which findLeaks (correctly) scans anyway. The repair loop re-ran the same
// text pass and made no progress, because the leak was never in the text.
//
// THE FIX. Stop maintaining a second definition of "content". This module uses
// the gate ITSELF as the scrubber's oracle: it runs the real `findLeaks`, and
// for every leak the gate reports it locates the occurrences with the gate's
// own matcher (`findTokenMatches` — the same compiled pattern, the same
// structural-attribute mask) and replaces them deterministically. A surface
// findLeaks can see is a surface this module can fix, BY CONSTRUCTION — a
// future fourth surface cannot leak, because there is no list to forget to
// update.
//
// Replacement policy mirrors the scrub machine's classes (personalize.ts):
//   contact (email/phone/domain) -> the client's own contact detail
//   brand                        -> the client's name / first word
//   service heading              -> one of the client's services (cycled)
//   place                        -> a client area (cycled), or removed/neutral
//   person / anything else       -> neutral in prose, removed in URLs
// Context-aware for URLs: inside a `src`/`href`/`srcset`/`data-src` value or a
// CSS `url(...)`, the replacement is URL-encoded (spaces -> %20) and a deletion
// tidies the query separators so `q=Hilltop,%20Denver` never degrades to
// `q=,%20Denver` or a dangling `,%20`.
//
// POSTCONDITION, not aspiration: `findLeaks(result.files, demoTokens) === []`.
// The replacement pass loops (a replacement can in principle expose a new
// adjacency) with a hard cap; if anything still matches at the cap — which
// requires the replacement machinery itself to be broken — the exact matched
// ranges are deleted outright, and deletion of a non-empty match strictly
// shrinks the file, so that stage provably terminates with zero matches.
//
// Pure: no I/O, no model calls, deterministic for a given input. Idempotent:
// on clean files the first findLeaks returns [] and the input is returned
// untouched.

import { findLeaks, findTokenMatches, type TokenMatch } from "./demoTokens";
import {
  buildScrubMachine,
  classifyDemoTokens,
  clientIdentityOf,
} from "./personalize";

/** All occurrences of one token in one file that were rewritten, and to what. */
export interface LeakFix {
  file: string;
  token: string;
  /** What each occurrence became — "" means the occurrence was removed. */
  replacement: string;
  /** Where the occurrences sat: "map URL", "URL" or "text". */
  context: string;
  occurrences: number;
}

export interface LeakGuaranteeReport {
  /** Replacement passes that ran. 0 = the files were already leak-free. */
  passes: number;
  fixes: LeakFix[];
  /**
   * Matched ranges the terminal stage deleted outright because replacement
   * alone could not clear them. Should always be 0 — a non-zero value means a
   * replacement kept re-introducing its own token (e.g. the client's real name
   * legitimately contains a demo word) and the guarantee cut it out instead.
   */
  forcedDeletions: number;
}

export interface LeakGuaranteeResult {
  files: Record<string, string>;
  report: LeakGuaranteeReport;
}

/** Hard cap on replacement passes before the terminal-deletion stage takes over. */
export const MAX_GUARANTEE_PASSES = 5;

/* ------------------------------------------------------------ URL context */

/** The value region (quotes excluded) of every URL-carrying attribute. */
const URL_ATTR_RE = /\b(?:src|href|srcset|data-src)\s*=\s*("[^"]*"|'[^']*'|[^\s"'`=<>]+)/gi;
/** A CSS url(...) — inline styles and stylesheets alike. */
const CSS_URL_FN_RE = /\burl\(([^)]*)\)/gi;

interface UrlRange {
  start: number;
  end: number;
}

/**
 * Every content region that IS a URL, as offsets into `content`. A leak
 * occurrence falling entirely inside one gets URL replacement rules.
 */
function urlValueRanges(content: string): UrlRange[] {
  const out: UrlRange[] = [];
  URL_ATTR_RE.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = URL_ATTR_RE.exec(content)) !== null) {
    const value = m[1];
    const quoted = value[0] === '"' || value[0] === "'";
    const end = m.index + m[0].length - (quoted ? 1 : 0);
    out.push({ start: end - (quoted ? value.length - 2 : value.length), end });
  }
  CSS_URL_FN_RE.lastIndex = 0;
  while ((m = CSS_URL_FN_RE.exec(content)) !== null) {
    const inner = m[1];
    const innerStart = m.index + m[0].indexOf("(") + 1;
    const lead = /^[\s'"]*/.exec(inner)![0].length;
    const trail = /[\s'"]*$/.exec(inner)![0].length;
    out.push({ start: innerStart + lead, end: innerStart + inner.length - trail });
  }
  return out;
}

const urlContextLabel = (url: string): string => (/maps/i.test(url) ? "map URL" : "URL");

/* --------------------------------------------------------- replacements */

type Ctx = "url" | "text";

/**
 * The per-token replacement chooser, built once per guarantee run so the
 * service/area cycling cursors are shared across every file (Hilltop -> Aurora,
 * Centennial -> Littleton, not Aurora twice).
 *
 * This is the SAME classification the scrub machine applies (personalize.ts):
 * contact and brand tokens resolve through `classifyDemoTokens` +
 * `clientIdentityOf` exactly as `buildIdentityRules` does, and everything else
 * takes its fate (service/area/delete + neutral) from `buildScrubMachine`'s
 * rules. Only the MATCHING is different — that belongs to the oracle.
 */
function buildReplacementChooser(
  demoTokens: string[],
  contentModel: unknown,
): (token: string, ctx: Ctx) => string {
  const demo = classifyDemoTokens(demoTokens);
  const client = clientIdentityOf(contentModel);
  const machine = buildScrubMachine(demoTokens, contentModel);
  const lower = (s: string) => s.trim().toLowerCase();
  const emails = new Set(demo.emails.map(lower));
  const domains = new Set(demo.domains.map(lower));
  const phones = new Set(demo.phones.map(lower));
  const brands = new Set(demo.brands.map(lower));
  const ruleByToken = new Map(machine.rules.map((r) => [lower(r.token), r] as const));

  return (token: string, ctx: Ctx): string => {
    const key = lower(token);
    let rep = "";
    if (emails.has(key)) rep = client.email;
    else if (phones.has(key)) rep = /^\+?\d+$/.test(token.trim()) ? client.phoneDigits : client.phone;
    else if (domains.has(key)) rep = client.domain;
    else if (brands.has(key)) rep = /\s/.test(token.trim()) ? client.name : client.firstWord;
    else {
      const rule = ruleByToken.get(key);
      if (rule?.kind === "service") {
        rep = machine.services.length
          ? machine.services[machine.svc.i++ % machine.services.length]
          : rule.neutral;
      } else if (rule?.kind === "area") {
        rep = machine.areas[machine.area.i++ % machine.areas.length];
      } else if (rule?.kind === "delete") {
        // A person or an area-less place: neutral phrasing in prose, plain
        // removal in a URL, where "a valued client" would be nonsense.
        rep = ctx === "url" ? "" : rule.neutral;
      }
      // No rule at all is unreachable for a real leak (buildScrubMachine covers
      // every token the identity classes do not), but "" — delete — is the
      // safe fate if it ever happens.
    }
    if (!rep) return "";
    // A replacement the gate's own matcher still finds the token in can never
    // clear the leak — e.g. the client legitimately shares a word with the
    // demo business. Deletion is the only move that guarantees progress.
    if (findTokenMatches(rep, token).length > 0) return "";
    return rep;
  };
}

/* ------------------------------------------------------------ the edits */

/**
 * URL query separators adjacent to a deleted term. A deletion consumes the
 * separator run on its RIGHT when there is one (`q=Hilltop,%20Denver` ->
 * `q=Denver`), otherwise the run on its LEFT (`q=Denver,%20Hilltop&t=` ->
 * `q=Denver&t=`), so no `,%20` ever dangles and no `%20%20` is ever minted.
 */
const SEP_RIGHT_RE = /^(?:%20|%2C|,|\+)+/i;
const SEP_LEFT_RE = /(?:%20|%2C|,|\+)+$/i;

function widenUrlDeletion(content: string, m: TokenMatch, url: UrlRange): [number, number] {
  const right = SEP_RIGHT_RE.exec(content.slice(m.end, url.end));
  if (right) return [m.start, m.end + right[0].length];
  const left = SEP_LEFT_RE.exec(content.slice(url.start, m.start));
  if (left) return [m.start - left[0].length, m.end];
  return [m.start, m.end];
}

/** A prose deletion swallows the following whitespace run when it would double. */
function widenTextDeletion(content: string, m: TokenMatch): [number, number] {
  let end = m.end;
  if (m.start > 0 && /\s/.test(content[m.start - 1])) {
    while (end < content.length && /\s/.test(content[end])) end++;
  }
  return [m.start, end];
}

/**
 * Rewrite ONE matched range. The matcher may legitimately bridge inline markup
 * (`<span>NORTHPOINT</span><span>REMODELING</span>` is one leak), so when the
 * match contains tags only its TEXT chunks are rewritten: the first becomes the
 * replacement, the rest are emptied, every tag survives byte-for-byte — the
 * structure gate's skeleton is never touched.
 */
function rewriteMatchedText(matched: string, rep: string): string {
  if (!matched.includes("<")) return rep;
  const parts = matched.split(/(<[^>]*>)/);
  let first = true;
  return parts
    .map((p) => {
      if (!p || p.startsWith("<")) return p;
      if (first) {
        first = false;
        return rep;
      }
      return "";
    })
    .join("");
}

interface Edit {
  start: number;
  end: number;
  text: string;
}

/**
 * One replacement sweep over one file: every occurrence of every leaked token,
 * located by the gate's matcher, rewritten in a single offset-spliced pass.
 * Overlapping matches keep the first (longest token wins the ordering); a
 * skipped overlap is simply found again on the next pass.
 */
function fixFile(
  content: string,
  tokens: string[],
  replacementFor: (token: string, ctx: Ctx) => string,
  record: (token: string, replacement: string, context: string, occurrences: number) => void,
): string {
  const urls = urlValueRanges(content);
  const edits: Edit[] = [];
  const counts = new Map<string, { token: string; replacement: string; context: string; n: number }>();
  const ordered = [...tokens].sort((a, b) => b.length - a.length);

  for (const token of ordered) {
    for (const m of findTokenMatches(content, token)) {
      if (edits.some((e) => m.start < e.end && e.start < m.end)) continue;
      const url = urls.find((r) => m.start >= r.start && m.end <= r.end);
      const ctx: Ctx = url ? "url" : "text";
      let rep = replacementFor(token, ctx);
      if (ctx === "url") rep = rep.replace(/ /g, "%20");
      const matched = content.slice(m.start, m.end);

      let start = m.start;
      let end = m.end;
      let text: string;
      if (matched.includes("<")) {
        text = rewriteMatchedText(matched, rep);
      } else if (rep === "" && url) {
        [start, end] = widenUrlDeletion(content, m, url);
        text = "";
      } else if (rep === "") {
        [start, end] = widenTextDeletion(content, m);
        text = "";
      } else {
        text = rep;
      }
      edits.push({ start, end, text });
      const context = url ? urlContextLabel(content.slice(url.start, url.end)) : "text";
      const k = `${token}\u0000${rep}\u0000${context}`;
      const cur = counts.get(k);
      if (cur) cur.n++;
      else counts.set(k, { token, replacement: rep, context, n: 1 });
    }
  }
  if (edits.length === 0) return content;
  for (const c of counts.values()) record(c.token, c.replacement, c.context, c.n);

  edits.sort((a, b) => a.start - b.start);
  let out = "";
  let cursor = 0;
  for (const e of edits) {
    if (e.start < cursor) continue;
    out += content.slice(cursor, e.start) + e.text;
    cursor = e.end;
  }
  return out + content.slice(cursor);
}

/* ------------------------------------------------------------- the loop */

function byFile(leaks: { file: string; token: string }[]): Map<string, string[]> {
  const out = new Map<string, string[]>();
  for (const l of leaks) {
    const cur = out.get(l.file);
    if (cur) {
      if (!cur.includes(l.token)) cur.push(l.token);
    } else out.set(l.file, [l.token]);
  }
  return out;
}

/**
 * The terminal guarantee: returns files for which `findLeaks(files, demoTokens)`
 * is `[]`, having deterministically rewritten every occurrence the gate would
 * have reported. Cheap on the happy path (one findLeaks scan, no allocation of
 * new file text) and idempotent, so it can run unconditionally before every
 * gate invocation.
 */
export function guaranteeNoLeaks(args: {
  files: Record<string, string>;
  demoTokens: string[];
  contentModel: unknown;
}): LeakGuaranteeResult {
  const { demoTokens, contentModel } = args;
  const files = { ...args.files };
  const fixes: LeakFix[] = [];
  const recordFor =
    (file: string) => (token: string, replacement: string, context: string, occurrences: number) => {
      const cur = fixes.find(
        (f) => f.file === file && f.token === token && f.replacement === replacement && f.context === context,
      );
      if (cur) cur.occurrences += occurrences;
      else fixes.push({ file, token, replacement, context, occurrences });
    };

  const replacementFor = buildReplacementChooser(demoTokens, contentModel);
  let passes = 0;
  let leaks = findLeaks(files, demoTokens);
  while (leaks.length > 0 && passes < MAX_GUARANTEE_PASSES) {
    passes++;
    let changed = false;
    for (const [file, tokens] of byFile(leaks)) {
      const next = fixFile(files[file], tokens, replacementFor, recordFor(file));
      if (next !== files[file]) {
        files[file] = next;
        changed = true;
      }
    }
    leaks = findLeaks(files, demoTokens);
    if (!changed) break; // replacements are exhausted — fall through to deletion
  }

  // Terminal stage. Replacement removes the match, so this "should" be dead
  // code — but the postcondition is a guarantee, not a hope. Every remaining
  // matched range is deleted outright; a match always contains non-tag text,
  // so each sweep strictly shrinks the file and the loop provably terminates.
  let forcedDeletions = 0;
  while (leaks.length > 0) {
    let changed = false;
    for (const [file, tokens] of byFile(leaks)) {
      const next = fixFile(files[file], tokens, () => "", (token, _rep, context, n) => {
        forcedDeletions += n;
        recordFor(file)(token, "", context, 0); // visible in the report, counted above
      });
      if (next !== files[file]) {
        files[file] = next;
        changed = true;
      }
    }
    if (!changed) break; // unreachable — kept so a logic error can never loop forever
    leaks = findLeaks(files, demoTokens);
  }

  return { files, report: { passes, fixes, forcedDeletions } };
}

/**
 * One operator-readable line for the verify step detail:
 * "leak guarantee fixed 2 occurrence(s): Hilltop→Aurora (map URL), Centennial→Littleton (map URL)"
 */
export function describeLeakGuarantee(report: LeakGuaranteeReport): string {
  const total = report.fixes.reduce((n, f) => n + f.occurrences, 0) + report.forcedDeletions;
  if (total === 0) return "";
  const parts = report.fixes.map((f) => {
    const arrow = `${f.token}→${f.replacement === "" ? "removed" : f.replacement}`;
    return f.context === "text" ? arrow : `${arrow} (${f.context})`;
  });
  const tail = report.forcedDeletions
    ? `; ${report.forcedDeletions} unresolvable occurrence(s) deleted outright`
    : "";
  return `leak guarantee fixed ${total} occurrence(s): ${parts.join(", ")}${tail}`;
}
