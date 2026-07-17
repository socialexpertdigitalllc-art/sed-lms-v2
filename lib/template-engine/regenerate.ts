// Template Engine v2 — whole-file regeneration (the core fix).
//
// v1 sent {find,replace} edit-ops that silently no-op'd on truncation and never
// touched script.js, so the demo business shipped verbatim. v2 rewrites each
// content file WHOLE, conditioned on one shared content model, and refuses to
// treat "the model handed the source back" as success — that refusal is the
// single most important line in this file.

import { callProvider } from "@/lib/ai-tools/run";
import { GEMINI_PRO_MODEL } from "@/lib/ai-tools/config";

export const REGEN_SYSTEM = `You are a precise COPY-EDITOR for website templates. You are given ONE file of an existing template plus a business's content model, and you return the SAME file with only its human-visible text and image URLs swapped to that business.

THIS IS A COPY-EDIT, NOT A REDESIGN. Reproduce the file's markup EXACTLY — every element, in the same order, at the same nesting depth. Do NOT simplify, shorten, summarize, merge, deduplicate, or omit anything. If the template has 6 gallery cards, output 6. If it has 8 process steps, output 8. If it has an <app-footer>, <booking-section>, or <map-embed> custom element, keep it. The output must contain the SAME COUNT of every tag as the input — a shorter file is a FAILED file, no matter how good it reads.

ABSOLUTE RULES
- Output ONLY the complete file content, from the first character to the last. No prose, no markdown fences, no "..." elisions, never truncate.
- Reproduce every tag, and every css class, id, data-* attribute, inline handler (onclick etc.), custom element, and JS class/function/method/variable name — VERBATIM, same count, same order, same depth. Dropping even one (including a brand-looking id like id="np-faq") breaks the site. This obligation overrides brevity: never shorten the file to save effort.
- Change ONLY: human-visible text, alt attributes, <title>, meta descriptions, code comments, contact details (phone/email/address), JS string/data VALUES (testimonials, service names, labels), and image src/srcset URLs.
- Replace 100% of the demo business's identity in that changeable text — business name, city, service areas, phone, email, person names — including in code comments. No demo brand may remain in any visible text or comment.
- CLIENT ASSETS from the content model, used only where the template already has the matching slot (never add or remove elements):
  - If identity.map_embed is non-empty and this file has a map (an <iframe> with a maps URL in src, or a <map-embed> element), replace the ENTIRE existing map <iframe> with identity.map_embed verbatim. If it is empty, leave the template's map as-is.
  - If identity.logo_url is non-empty and the template's header/footer logo is an <img>, set its src to identity.logo_url. If the logo is text, leave it as the business name.
  - If identity.profile_link is non-empty, use it as the href for any existing "reviews", "Google", "Yelp", or "view our profile" link/button. Never invent such a link.
- In JavaScript, change only string/data VALUES and comments; never touch identifiers or control flow. The brand identifier was already neutralized upstream, so you will not see it.
- Use ONLY the supplied content model for facts. Never invent licenses, awards or certifications. Never keep a template image path.`;

/** One card the hub page must emit — a service or area, linked to its own page. */
export interface HubCard {
  name: string;
  file: string;
}
export interface HubExpand {
  noun: string; // "service" | "service area"
  items: HubCard[];
}

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
  /** When set, this file is an individual detail page centered on ONE service/area. */
  pageFocus?: { noun: string; name: string };
  /** When set, this file is a hub that must emit one card per item, each linked to its page. */
  hubExpand?: HubExpand;
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
  pageFocus?: { noun: string; name: string };
  hubExpand?: HubExpand;
}): string {
  const { file, source, contentModel, imagesForFile, demoTokens, repairNote, pageFocus, hubExpand } = args;
  const blacklist = demoTokens.length
    ? demoTokens.map((t) => `- ${t}`).join("\n")
    : "- (none recorded for this template)";
  const repair = repairNote
    ? `\n\nYOUR PREVIOUS ATTEMPT FAILED VERIFICATION. Fix exactly these problems and change nothing else:\n${repairNote}`
    : "";
  // Individual detail page: the sample is a detail page for one thing; re-point
  // it at THIS service/area. Still a strict copy-edit — same structure.
  const focus = pageFocus
    ? `\n\nTHIS IS THE DETAIL PAGE FOR ONE ${pageFocus.noun.toUpperCase()}: "${pageFocus.name}". The source is the template's sample ${pageFocus.noun} page. Rewrite ALL of its ${pageFocus.noun}-specific copy (title, headings, body, meta, breadcrumb, image alts) to be about "${pageFocus.name}" for THIS business. Keep the page structure identical to the sample; only the subject changes.`
    : "";
  // Hub page: emit one card per item, using the sample's card markup as the
  // exact pattern. This is the ONE place the output tag count may differ from
  // the source (the structure gate exempts hub pages).
  const hub = hubExpand
    ? `\n\nHUB EXPANSION — IMPORTANT: this page shows a grid/list of ${hubExpand.noun} cards. The template has a few SAMPLE cards; you must output EXACTLY ONE card per ${hubExpand.noun} listed below, cloning the sample card's markup VERBATIM as the pattern (same tags, classes, data-* attributes, inner layers and styles) and changing only: the card's title/heading to the ${hubExpand.noun} name, its short blurb, its image (use an appropriate image), and its link — set the card's click target (the onclick "window.location.href='…'" and/or the <a href>) to the given file. Remove any leftover sample cards. Do NOT change any other part of the page.\n${hubExpand.items.map((c) => `- ${c.name} -> ${c.file}`).join("\n")}`
    : "";
  return `Rewrite the file "${file}" so it belongs to the business described by this content model, keeping the template's structure and code identical.${focus}${hub}

CONTENT MODEL (the only source of business facts):
${JSON.stringify(contentModel, null, 2)}

IMAGES for this file — replace the template's image src/srcset and alt text with these, in order; never keep a template image path:
${JSON.stringify(imagesForFile, null, 2)}

FORBIDDEN TOKENS — the template's demo identity. None of these may appear anywhere in your output, in any casing:
${blacklist}${repair}

SOURCE FILE (return the COMPLETE rewritten file — tags, classes, ids, data-* attributes and JS identifiers unchanged; only human-visible text, code comments, data values, contact details and image URLs change):
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
/** Max attempts per file. Gemini occasionally returns a transient "fetch failed"
 *  (network/timeout) on a long generation; a 7-10 call run will hit one, and one
 *  blip must not waste the whole pipeline. Retried on ANY failure (network,
 *  empty, or source-unchanged) since a fresh sample can clear all three. */
const REGEN_ATTEMPTS = 3;

export async function regenerateFile(args: RegenerateArgs): Promise<string> {
  let lastErr: unknown;
  for (let attempt = 1; attempt <= REGEN_ATTEMPTS; attempt++) {
    try {
      const { text } = await callProvider(
        "gemini",
        args.model ?? GEMINI_PRO_MODEL,
        REGEN_SYSTEM,
        regenPrompt(args),
        // Low temperature for maximum fidelity (this is a copy-edit, not creative
        // writing), and a high token budget so a large page is never shortened to fit.
        { maxTokens: 64000, temperature: 0.15 },
      );
      const out = stripFence(text);
      if (!out) throw new Error(`Regeneration of ${args.file} returned empty output`);
      if (out === args.source.trim()) {
        throw new Error(`Regeneration of ${args.file} returned the source unchanged (the v1 no-op bug)`);
      }
      return out;
    } catch (e) {
      lastErr = e;
      if (attempt < REGEN_ATTEMPTS) {
        await new Promise((r) => setTimeout(r, 2000 * attempt)); // linear backoff
      }
    }
  }
  throw lastErr instanceof Error ? lastErr : new Error(`Regeneration of ${args.file} failed`);
}
