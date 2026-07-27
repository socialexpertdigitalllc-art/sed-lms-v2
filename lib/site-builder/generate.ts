import { callForTask } from "@/lib/ai-tools/providers/run";
import {
  SITE_BUILD_SYSTEM,
  SITE_COMPONENTS_SYSTEM,
  buildPagePrompt,
  buildNewPagePrompt,
  buildComponentsPrompt,
  type BusinessBrief,
  type SuppliedImage,
  type SharedComponents,
} from "./prompt";

/**
 * The model-call seam. Production passes `productionSiteBuildCall`; tests
 * pass a stub so nothing here ever touches the network. Same shape as every
 * other AiCall seam in this codebase (see lib/site-studio/run/writer.ts).
 */
export type AiCall = (system: string, user: string) => Promise<{ text: string }>;

export const productionSiteBuildCall: AiCall = async (system, user) => {
  const { text } = await callForTask("site_build", system, user, { maxTokens: "model-max", temperature: 0.4 });
  return { text };
};

export type GenerateOutcome = { ok: true; html: string } | { ok: false; error: string };

const DOCTYPE_NEEDLE = "<!doctype";
const HTML_TAG_NEEDLE = "<html";
const CLOSE_TAG_NEEDLE = "</html>";

/**
 * Marker-based extraction — the PRIMARY path for every extractor here.
 *
 * The prompts instruct the model to wrap the one finished file between
 * `===FILE START===` / `===FILE END===` lines (see prompt.ts's OUTPUT
 * sections). This exists because reasoning-style models narrate: a real
 * reply seen in production interleaved hundreds of lines of "Let me…/
 * Actually…" planning with ```fenced``` HTML snippets, and every
 * needle-based slicer (first fence, first `<html`) swallowed the narration
 * into the shipped file. Markers make the file's boundaries explicit; the
 * LAST start marker wins because narration sometimes quotes the marker
 * itself while planning.
 */
type MarkedResult = { found: string } | { truncated: true } | null;

const START_MARKER_RE = /^[^\S\r\n]*=+[^\S\r\n]*FILE START[^\S\r\n]*=+[^\S\r\n]*$/gim;
const END_MARKER_RE = /^[^\S\r\n]*=+[^\S\r\n]*FILE END[^\S\r\n]*=+[^\S\r\n]*$/gim;

function extractMarked(raw: string): MarkedResult {
  START_MARKER_RE.lastIndex = 0;
  let lastStart: RegExpExecArray | null = null;
  for (let m = START_MARKER_RE.exec(raw); m; m = START_MARKER_RE.exec(raw)) lastStart = m;
  if (!lastStart) return null;

  const from = lastStart.index + lastStart[0].length;
  END_MARKER_RE.lastIndex = from;
  const end = END_MARKER_RE.exec(raw);
  if (!end) return { truncated: true };
  return { found: raw.slice(from, end.index).trim() };
}

/**
 * Reject a candidate file that still carries model narration. Two signals:
 *  - a markdown fence at the start of a line — a finished HTML/JS/CSS file
 *    never contains one, an interleaved reply always does;
 *  - three or more lines OPENING with thinking-out-loud phrases. Three, not
 *    one, so a single legitimate marketing sentence ("Let me tell you why
 *    neighbours choose us") can never fail a good file, while real
 *    contamination (dozens of hits in the observed failure) always does.
 */
const NARRATION_RE =
  /^[^\S\r\n]*(Okay,|OK,|OK\.|Hmm|Wait,|Wait -|Actually,|Let me|Let's see|I'll |I will |I should|I need to|I think|I realize|Looking at|Now let me|Now I |One more thing|So I |But wait)/gim;

function contaminationError(candidate: string, label: string): string | null {
  if (/^```/m.test(candidate)) {
    return `${label}: the reply mixed commentary and code snippets into the file (markdown fences found inside it). Regenerate this page.`;
  }
  NARRATION_RE.lastIndex = 0;
  let hits = 0;
  while (NARRATION_RE.exec(candidate)) {
    hits += 1;
    if (hits >= 3) {
      return `${label}: the model wrote its reasoning into the file instead of only the file's code (multiple commentary lines found). Regenerate this page.`;
    }
  }
  return null;
}

/**
 * Where the reply's HTML actually starts — the first of a doctype
 * declaration or an opening <html> tag, whichever comes first. Deliberately
 * NOT a fence-detector: a ```html fence, a leading sentence of prose, and
 * this needle are all satisfied by the same index search, because a fence
 * or a preamble always sits BEFORE the doctype/opening tag, never inside it.
 */
function findHtmlStart(lower: string): number {
  const doctypeIdx = lower.indexOf(DOCTYPE_NEEDLE);
  const htmlIdx = lower.indexOf(HTML_TAG_NEEDLE);
  const candidates = [doctypeIdx, htmlIdx].filter((i) => i >= 0);
  return candidates.length ? Math.min(...candidates) : -1;
}

/** The end of the reply's HTML: just past the LAST `</html>` — trailing
 *  commentary ("Let me know if you'd like changes!", a closing fence) always
 *  sits after it, so taking the last occurrence strips that uniformly with
 *  no separate fence-stripping step. */
function findHtmlEnd(lower: string): number {
  const idx = lower.lastIndexOf(CLOSE_TAG_NEEDLE);
  return idx === -1 ? -1 : idx + CLOSE_TAG_NEEDLE.length;
}

/** Slice `text` from its first doctype/`<html` to its last `</html>`, or
 *  explain why that can't be done. Shared by both extractHtml paths. */
function sliceHtmlDocument(text: string, label: string): GenerateOutcome {
  const lower = text.toLowerCase();
  const replyLength = text.length;

  const start = findHtmlStart(lower);
  if (start === -1) {
    return {
      ok: false,
      error: `${label}: reply contained no HTML (${replyLength} chars received, no doctype or <html> tag found).`,
    };
  }

  const end = findHtmlEnd(lower);
  if (end === -1 || end <= start) {
    return {
      ok: false,
      error:
        `${label}: reply looks truncated — found an opening HTML tag but no closing </html> ` +
        `(${replyLength} chars received). The model likely hit its output limit before finishing this page.`,
    };
  }

  return { ok: true, html: text.slice(start, end) };
}

/**
 * HTML extraction from a raw model reply.
 *
 * Primary path: the prompt's `===FILE START/END===` markers — exact, immune
 * to narration. Fallback (marker-less reply, e.g. a terser model that just
 * returned the page): the historical doctype→last-`</html>` slice. BOTH
 * paths then reject a candidate that still carries model narration or
 * fenced snippets (see `contaminationError`) — shipping a page with the
 * model's thought process embedded in it is strictly worse than failing the
 * page and letting the operator regenerate.
 *
 * A start marker with no end marker fails as truncation — the model spent
 * its output budget narrating and never finished the file.
 */
export function extractHtml(raw: string, label: string): GenerateOutcome {
  const marked = extractMarked(raw);
  if (marked && "truncated" in marked) {
    return {
      ok: false,
      error:
        `${label}: the reply opened its FILE START marker but never reached FILE END — it was cut off ` +
        `before the page finished (likely the model's output limit). Regenerate this page.`,
    };
  }

  const sliced = sliceHtmlDocument(marked ? marked.found : raw.trim(), label);
  if (!sliced.ok) return sliced;

  const contamination = contaminationError(sliced.html, label);
  if (contamination) return { ok: false, error: contamination };
  return sliced;
}

/** Every complete ```fenced``` block in a reply, largest first. A narrating
 *  model quotes many small snippets while planning and (sometimes) writes
 *  the one real file in a final fence — the real file dwarfs the snippets,
 *  so size, not position, identifies it. */
function largestFencedBlock(text: string): string | null {
  const blocks: string[] = [];
  const re = /^```[^\n]*\n([\s\S]*?)^```[ \t]*$/gim;
  for (let m = re.exec(text); m; m = re.exec(text)) blocks.push(m[1]);
  if (blocks.length === 0) return null;
  blocks.sort((a, b) => b.length - a.length);
  const best = blocks[0].trim();
  return best || null;
}

/**
 * SOURCE extraction from a raw model reply — the components-file counterpart
 * of `extractHtml`. A components file is usually JavaScript, so there is no
 * doctype/closing-tag pair to anchor on, which is exactly how a narrating
 * model's reply once shipped VERBATIM as the deployed components.js (its
 * whole plan, fenced snippets and all — the file even ended mid-sentence).
 *
 * Order of preference:
 *   1. the prompt's `===FILE START/END===` markers (start-without-end fails
 *      as truncation);
 *   2. the LARGEST complete fenced block — never "first fence to last",
 *      which is what swallowed the narration;
 *   3. the whole trimmed reply (terse model, no wrapping at all).
 * Whatever is chosen must then pass the same narration/fence contamination
 * check pages get.
 */
export function extractFileSource(raw: string, label: string): GenerateOutcome {
  const text = raw.trim();
  if (!text) return { ok: false, error: `${label}: the reply was empty.` };

  const marked = extractMarked(text);
  if (marked && "truncated" in marked) {
    return {
      ok: false,
      error:
        `${label}: the reply opened its FILE START marker but never reached FILE END — it was cut off ` +
        `before the file finished (likely the model's output limit). Regenerate it.`,
    };
  }

  let candidate: string | null;
  if (marked) {
    // A single fence WRAPPING the whole marked content is a well-behaved
    // reply, not contamination — unwrap it before judging.
    const inner = /^```[^\n]*\n([\s\S]*?)\n?```$/.exec(marked.found);
    candidate = (inner ? inner[1].trim() : marked.found) || null;
  } else {
    candidate = largestFencedBlock(text) ?? text;
    // In a LONG marker-less reply, the file must dominate: a narrating model
    // that got cut off mid-plan leaves only its small quoted snippets as
    // complete fences, and shipping one of those as the components file is
    // the worst outcome there is. Short replies skip this (a terse model's
    // one-line preamble around a small file is fine — the ratio only means
    // something when there was room to narrate).
    if (candidate !== text && text.length >= 1500 && candidate.length < text.length * 0.5) {
      return {
        ok: false,
        error:
          `${label}: the reply is mostly commentary — its largest code block is only ${candidate.length} of ` +
          `${text.length} chars, so the complete file never arrived. Regenerate it.`,
      };
    }
  }
  if (!candidate) return { ok: false, error: `${label}: the reply's file markers were empty.` };

  const contamination = contaminationError(candidate, label);
  if (contamination) return { ok: false, error: contamination };
  return { ok: true, html: candidate };
}

function withInstruction(user: string, instruction?: string): string {
  const trimmed = instruction?.trim();
  return trimmed ? `${user}\n\nOPERATOR INSTRUCTION FOR THIS REGENERATION: ${trimmed}` : user;
}

/** Rewrite the template's shared components file (see SITE_COMPONENTS_SYSTEM).
 *  Always the run's FIRST generation — its result feeds every page prompt. */
export async function generateComponents(
  deps: { aiCall: AiCall },
  args: {
    brief: BusinessBrief;
    images: SuppliedImage[];
    file: string;
    source: string;
    siteFiles: string[];
    instruction?: string;
  },
): Promise<GenerateOutcome> {
  const user = withInstruction(
    buildComponentsPrompt({
      brief: args.brief,
      images: args.images,
      file: args.file,
      source: args.source,
      siteFiles: args.siteFiles,
    }),
    args.instruction,
  );
  const { text } = await deps.aiCall(SITE_COMPONENTS_SYSTEM, user);
  // An HTML components include still ends in </html>-less fragment markup, so
  // the source extractor (marker/fence stripping only) is right for both kinds.
  const outcome = extractFileSource(text, args.file);
  if (!outcome.ok) return outcome;

  // Structural sanity against the ORIGINAL — the one generator that can
  // check this, because it holds the source it asked to be rewritten. A
  // components rewrite that lost the custom-element registrations (or most
  // of the file) would silently break every page's header/footer at runtime;
  // failing here turns that into a visible, regenerable error instead.
  if (/customElements\.define/.test(args.source) && !/customElements\.define/.test(outcome.html)) {
    return {
      ok: false,
      error:
        `${args.file}: the rewritten file lost its customElements.define registrations — the reply did not ` +
        `contain the complete file. Regenerate it.`,
    };
  }
  if (outcome.html.length < args.source.length * 0.25) {
    return {
      ok: false,
      error:
        `${args.file}: the rewritten file is implausibly short (${outcome.html.length} chars vs the ` +
        `original's ${args.source.length}) — the reply did not contain the complete file. Regenerate it.`,
    };
  }
  return outcome;
}

/** Rewrite one existing template page for this business. */
export async function generatePage(
  deps: { aiCall: AiCall },
  args: {
    brief: BusinessBrief;
    images: SuppliedImage[];
    pageFile: string;
    pageHtml: string;
    siteFiles: string[];
    components?: SharedComponents;
    /** Operator's free-text steer for a regeneration. Appended to the prompt
     *  functions' own output — prompt.ts itself is never rewritten. */
    instruction?: string;
  },
): Promise<GenerateOutcome> {
  const user = withInstruction(
    buildPagePrompt({
      brief: args.brief,
      images: args.images,
      pageFile: args.pageFile,
      pageHtml: args.pageHtml,
      siteFiles: args.siteFiles,
      components: args.components,
    }),
    args.instruction,
  );
  const { text } = await deps.aiCall(SITE_BUILD_SYSTEM, user);
  return extractHtml(text, args.pageFile);
}

/** Design and write a page the template does not have. */
export async function generateNewPage(
  deps: { aiCall: AiCall },
  args: {
    brief: BusinessBrief;
    images: SuppliedImage[];
    pageName: string;
    newFile: string;
    references: { file: string; html: string }[];
    siteFiles: string[];
    components?: SharedComponents;
    instruction?: string;
  },
): Promise<GenerateOutcome> {
  const user = withInstruction(
    buildNewPagePrompt({
      brief: args.brief,
      images: args.images,
      pageName: args.pageName,
      newFile: args.newFile,
      references: args.references,
      siteFiles: args.siteFiles,
      components: args.components,
    }),
    args.instruction,
  );
  const { text } = await deps.aiCall(SITE_BUILD_SYSTEM, user);
  return extractHtml(text, args.newFile);
}
