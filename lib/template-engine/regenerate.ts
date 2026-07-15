// Template Engine v2 — whole-file regeneration (the core fix).
//
// v1 sent {find,replace} edit-ops that silently no-op'd on truncation and never
// touched script.js, so the demo business shipped verbatim. v2 rewrites each
// content file WHOLE, conditioned on one shared content model, and refuses to
// treat "the model handed the source back" as success — that refusal is the
// single most important line in this file.

import { callProvider } from "@/lib/ai-tools/run";
import { GEMINI_PRO_MODEL } from "@/lib/ai-tools/config";

export const REGEN_SYSTEM = `You rewrite one file of a website template so it belongs to a specific real business, while preserving the template's design and code exactly.

ABSOLUTE RULES
- Output ONLY the complete file content. No prose, no markdown fences.
- Preserve EVERY css class, id, data-* attribute, inline handler, and tag structure. Never drop or rename any of them.
- In JavaScript: preserve every class/function/method/variable name and all control flow. The file must still parse and behave identically. Change ONLY string/data VALUES (e.g. testimonial text, service names, labels).
- Replace 100% of the template's demo business identity — name, city, areas, phone, email, people names, and any identifier-like branding in text. NOTHING of the demo business may remain.
- Use ONLY the supplied content model for facts. Never invent licenses, awards or certifications.
- Rewrite image src/srcset and alt text using the supplied image URLs. Never keep a template image path.`;

export interface RegenerateArgs {
  file: string;
  source: string;
  contentModel: unknown;
  /** Resolved image URLs for this file, in order (hero/service/etc.). */
  imagesForFile: unknown;
  /** The template's demo identity — must not survive into the output. */
  demoTokens: string[];
  model?: string;
  /** On a verification-repair pass, the exact leak/structure problems to fix. */
  repairNote?: string;
}

/**
 * Build the per-file rewrite prompt: the content model (all facts), the images
 * to wire in, the demo-token blacklist, then the full source to rewrite. The
 * source goes LAST so a truncated response loses the tail of the source, not the
 * instructions.
 */
export function regenPrompt(args: {
  file: string;
  source: string;
  contentModel: unknown;
  imagesForFile: unknown;
  demoTokens: string[];
  repairNote?: string;
}): string {
  const { file, source, contentModel, imagesForFile, demoTokens, repairNote } = args;
  const blacklist = demoTokens.length
    ? demoTokens.map((t) => `- ${t}`).join("\n")
    : "- (none recorded for this template)";
  const repair = repairNote
    ? `\n\nYOUR PREVIOUS ATTEMPT FAILED VERIFICATION. Fix exactly these problems and change nothing else:\n${repairNote}`
    : "";
  return `Rewrite the file "${file}" so it belongs to the business described by this content model, keeping the template's structure and code identical.

CONTENT MODEL (the only source of business facts):
${JSON.stringify(contentModel, null, 2)}

IMAGES for this file — replace the template's image src/srcset and alt text with these, in order; never keep a template image path:
${JSON.stringify(imagesForFile, null, 2)}

FORBIDDEN TOKENS — the template's demo identity. None of these may appear anywhere in your output, in any casing:
${blacklist}${repair}

SOURCE FILE (return the COMPLETE rewritten file — same tags, classes, ids, data-* and JS identifiers; only human-visible text, data values, contact details and image URLs change):
${source}`;
}

/**
 * Some models wrap file output in a ```lang fence despite being told not to.
 * Strip it only when the whole payload is fenced, so a legitimate backtick run
 * inside the file is never touched.
 */
function stripFence(raw: string): string {
  let t = raw.trim();
  if (t.startsWith("```")) {
    t = t.replace(/^```[a-zA-Z0-9]*[^\S\n]*\n?/, "").replace(/\n?```$/, "");
  }
  return t.trim();
}

/**
 * Regenerate one content file with Gemini Pro. Throws on empty output or output
 * byte-identical to the source: v1's defining bug was accepting "no change" as a
 * finished step, and this function exists so that can never happen silently. The
 * leak/structure gates (runGates) validate the content itself afterwards.
 */
export async function regenerateFile(args: RegenerateArgs): Promise<string> {
  const { text } = await callProvider(
    "gemini",
    args.model ?? GEMINI_PRO_MODEL,
    REGEN_SYSTEM,
    regenPrompt(args),
    { maxTokens: 32000, temperature: 0.4 },
  );
  const out = stripFence(text);
  if (!out) throw new Error(`Regeneration of ${args.file} returned empty output`);
  if (out === args.source.trim()) {
    throw new Error(`Regeneration of ${args.file} returned the source unchanged (the v1 no-op bug)`);
  }
  return out;
}
