import { callForTask } from "@/lib/ai-tools/providers/run";
import {
  SITE_BUILD_SYSTEM,
  buildPagePrompt,
  buildNewPagePrompt,
  type BusinessBrief,
  type SuppliedImage,
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

/**
 * Tolerant HTML extraction from a raw model reply. Real models wrap replies
 * in a ```html fence, add a sentence before the doctype, or trail commentary
 * after `</html>` — none of that is a failure, it just needs stripping.
 * Only two things actually fail:
 *   - no HTML anywhere in the reply (no doctype, no <html> tag)
 *   - an opening tag with no closing </html> — the reply looks truncated
 * `label` identifies which page this was, so a failure is actionable without
 * the caller re-deriving it.
 */
export function extractHtml(raw: string, label: string): GenerateOutcome {
  const text = raw.trim();
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

function withInstruction(user: string, instruction?: string): string {
  const trimmed = instruction?.trim();
  return trimmed ? `${user}\n\nOPERATOR INSTRUCTION FOR THIS REGENERATION: ${trimmed}` : user;
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
    }),
    args.instruction,
  );
  const { text } = await deps.aiCall(SITE_BUILD_SYSTEM, user);
  return extractHtml(text, args.newFile);
}
