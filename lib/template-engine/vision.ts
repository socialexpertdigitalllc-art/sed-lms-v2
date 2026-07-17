/**
 * Gemini-vision image ranking (Phase 2, spec §7).
 *
 * Each Pexels/candidate image is judged by Gemini Flash for two things: does
 * it show a person or any body part (the client wants "high quality, no-men
 * images", so this is a hard default-drop gate upstream in rankAndTrim), and
 * how well it fits the trade/section it's being sourced for. Text search alone
 * cannot deliver either judgment — this is genuinely a vision task.
 */

import { callProvider } from "@/lib/ai-tools/run";
import { GEMINI_FLASH_MODEL } from "@/lib/ai-tools/config";
import { parseJsonArrayPrefix, parseJsonLoose } from "@/lib/ai/json";
import type { VisionVerdict } from "./imageSlots";

export const VISION_SYSTEM = `You are an exacting visual curator for home-service business websites. You inspect stock photos and return ONLY strict, well-formed JSON verdicts — no prose, no commentary, no markdown fences. You are deliberately conservative about detecting people: any human being or any part of a human body — face, hand, arm, leg, or otherwise — visible anywhere in the frame (even partially, blurred, or in the background) counts as a person present. When genuinely uncertain, you judge relevance and quality strictly rather than guessing generously.`;

/** One slot's context for the vision pass: what it's for and what it's searching. */
export interface VisionBrief {
  query: string;
  kind: string;
  businessType: string;
}

/**
 * Build the user-turn prompt for one batch of candidate images. The images
 * themselves travel as separate `image_url` content parts (see rankImages) —
 * this text only carries the instructions and must state the exact JSON
 * contract, in-order, one verdict per photo.
 */
export function visionPrompt(brief: VisionBrief): string {
  return `Business type: ${brief.businessType}
Website section: ${brief.kind}
Search query used to find these candidate photos: "${brief.query}"

Judge each of the supplied photos, in the EXACT ORDER they were attached, for use in this "${brief.kind}" section of a ${brief.businessType} website.

Return ONLY a JSON array with exactly one object per photo, in that same order. Each object must have this shape:
{"people": boolean, "relevance": number, "quality": number, "reason": string}

- "people": true if the photo shows ANY human being or ANY body part (face, hand, arm, leg, etc.) anywhere in the frame, however small, partial, blurred, or in the background. false only when no person or body part appears anywhere.
- "relevance": a 0-1 score for how well the photo fits the search query and the ${brief.businessType} trade for this section.
- "quality": a 0-1 score for professional stock-photo quality — lighting, composition, sharpness, no watermarks or text overlays.
- "reason": <= 8 words explaining the verdict.

Return the JSON array alone. No prose before or after, no markdown code fences.`;
}

const CONSERVATIVE_VERDICT: VisionVerdict = { people: true, relevance: 0, quality: 0, reason: "unreadable" };

function isValidVerdict(v: unknown): v is VisionVerdict {
  if (!v || typeof v !== "object") return false;
  const r = v as Record<string, unknown>;
  return (
    typeof r.people === "boolean" &&
    typeof r.relevance === "number" &&
    Number.isFinite(r.relevance) &&
    typeof r.quality === "number" &&
    Number.isFinite(r.quality) &&
    typeof r.reason === "string"
  );
}

/**
 * Parse Gemini's verdict array into exactly `n` verdicts (pure — no network).
 * Gemini fences JSON in ```json blocks, so this always goes through
 * `parseJsonLoose`, never a raw `JSON.parse`. Any entry that is missing
 * (array too short), malformed (wrong shape/types), or the whole response
 * being unparseable, becomes the conservative default `{people:true,
 * relevance:0, quality:0, reason:"unreadable"}` — conservative because a
 * `people:true` default means the entry gets dropped by rankAndTrim's
 * excludePeople gate, never wrongly shipped.
 */
export function parseVisionVerdicts(raw: string, n: number): VisionVerdict[] {
  const parsed = parseJsonLoose<unknown>(raw);
  // Not a complete array? Salvage the complete leading verdicts of a truncated
  // one (gemini-3.5-flash hitting max_tokens returns 200 + a cut-off array;
  // each verdict maps independently to one image, so a prefix is safe — losing
  // all 12 because verdict #5 was cut off is what emptied whole image slots).
  const arr = Array.isArray(parsed) ? parsed : parseJsonArrayPrefix<unknown>(raw);
  const out: VisionVerdict[] = [];
  for (let i = 0; i < n; i++) {
    const entry = arr[i];
    out.push(
      isValidVerdict(entry)
        ? { people: entry.people, relevance: entry.relevance, quality: entry.quality, reason: entry.reason }
        : { ...CONSERVATIVE_VERDICT },
    );
  }
  return out;
}

// Gemini Flash calls are capped at this many images per request — large
// batches are chunked so no single call is starved of attention or hits a
// provider-side limit.
const MAX_IMAGES_PER_CALL = 12;

// Output budget per vision call. gemini-3.5-flash spends HIDDEN thinking
// tokens (~1,600-1,800 measured live 2026-07-17) that count against
// max_tokens; at the old 2000 the verdict JSON was truncated (HTTP 200 +
// finish_reason=length) and every slot whose chunks both truncated came out
// empty. 12 verdicts need ~500 output tokens, so 8000 leaves ~4x headroom.
const VISION_MAX_TOKENS = 8000;

// Attempts per chunk. Thinking length varies run to run (the same request can
// truncate once and fit the next time) and Gemini throws transient 429/fetch
// errors; one retry clears the common blip. Kept at 2 (was 3) so a
// persistently rate-limited chunk fails fast to conservative instead of
// burning ~3x the time — the whole point of lightening this step.
const RANK_ATTEMPTS = 2;

// Per-vision-call timeout. A vision call is ~20s normally; 60s is generous
// headroom, and — crucially — bounds a stalled/rate-limited connection that
// would otherwise hang the whole image step forever.
const VISION_TIMEOUT_MS = 60000;

/** True when the verdict carries real signal (not the conservative unreadable default). */
function isReadableVerdict(v: VisionVerdict): boolean {
  return !(v.people === true && v.relevance === 0 && v.quality === 0 && v.reason === "unreadable");
}

function chunk<T>(items: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

/**
 * Rank candidate images with one (or more, chunked) Gemini Flash vision
 * call(s): a text part (visionPrompt) plus one `image_url` part per
 * candidate. Never throws — a vision-provider outage must not fail the whole
 * generation, it should just yield no vetted picks for that batch, so any
 * call failure resolves to all-conservative verdicts for the images in it.
 * Verdicts are returned in the same order as `candidates`.
 */
export async function rankImages(
  candidates: { url: string }[],
  brief: VisionBrief,
  model: string = GEMINI_FLASH_MODEL,
): Promise<VisionVerdict[]> {
  if (candidates.length === 0) return [];

  const out: VisionVerdict[] = [];
  for (const batch of chunk(candidates, MAX_IMAGES_PER_CALL)) {
    let settled: VisionVerdict[] | null = null;
    let lastNote = "";
    for (let attempt = 1; attempt <= RANK_ATTEMPTS; attempt++) {
      try {
        const { text } = await callProvider("gemini", model, VISION_SYSTEM, visionPrompt(brief), {
          maxTokens: VISION_MAX_TOKENS,
          temperature: 0,
          images: batch.map((c) => c.url),
          timeoutMs: VISION_TIMEOUT_MS,
        });
        const verdicts = parseVisionVerdicts(text, batch.length);
        // At least one readable verdict = the call fundamentally worked (a
        // truncated tail stays conservative; retrying would just burn quota).
        // ALL unreadable = the response was garbage/fully truncated — retry.
        if (verdicts.some(isReadableVerdict)) {
          settled = verdicts;
          break;
        }
        lastNote = `unreadable response (${text.length} chars)`;
      } catch (e) {
        lastNote = e instanceof Error ? e.message : String(e);
      }
      if (attempt < RANK_ATTEMPTS) {
        await new Promise((r) => setTimeout(r, 250 * attempt)); // linear backoff
      }
    }
    if (!settled) {
      // Loud by design: an unrated chunk means these images get dropped by the
      // excludePeople gate — silently, this is exactly how empty slots shipped.
      console.error(
        `[vision] chunk of ${batch.length} images unrated after ${RANK_ATTEMPTS} attempts` +
          ` (${brief.kind} "${brief.query}"): ${lastNote}`,
      );
      settled = batch.map((): VisionVerdict => ({ ...CONSERVATIVE_VERDICT }));
    }
    out.push(...settled);
  }
  return out;
}
