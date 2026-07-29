/**
 * MiniMax-vision candidate ranking for the Site Builder image screen.
 *
 * "the same system we had previously where we use minimax m3 vision system
 * to rank the images without people" (operator's words) — but RANK, not
 * reject. The previous engine (lib/template-engine/vision.ts +
 * lib/template-engine/imageSlots.ts's `excludePeople` gate) hard-dropped any
 * candidate showing a person, and that left more than half of home-service
 * image slots empty in practice — plumbers, roofers, and the like almost
 * always have a person somewhere in a usable shot. Ranking gets the same
 * "prefer no people" benefit with none of that risk: every candidate this
 * module is given comes back out, just reordered with people-free ones
 * first.
 *
 * Model-agnostic like every other AI call in this codebase: this file talks
 * to `callForTask("image_rank", ...)` and never names a provider — the
 * operator points the `image_rank` task at MiniMax M3 in AI Tools settings
 * (see lib/ai-tools/providers/registry.ts), and the router falls back to the
 * registry default if that assignment is ever unusable.
 *
 * Sourcing must never block or fail because of this: a failed, timed-out, or
 * unconfigured vision call is swallowed here and returns the candidates in
 * their ORIGINAL order, logging why. There is deliberately no retry — this is
 * a nice-to-have ordering pass, not a correctness-critical step, and the
 * caller (the images/source route) has nothing worth waiting twice for. That
 * is now enforced with `maxAttempts: 1` rather than merely stated: the shared
 * seam gained its own retry loop with the rate limiter, so this call silently
 * became four attempts — up to ~87s of timeout plus backoff inside a route
 * that declares `maxDuration = 60`, killing the whole sourcing request to
 * improve an ordering it is happy to do without.
 */

import { callForTask } from "@/lib/ai-tools/providers/run";
import { parseJsonArrayPrefix, parseJsonLoose } from "@/lib/ai/json";

export const IMAGE_RANK_SYSTEM = `You inspect candidate photos for a home-service business website and report, for each one, whether it shows any visible person or part of a person. You return ONLY strict, well-formed JSON — no prose, no commentary, no markdown fences. You are deliberately conservative: any human being or any part of a human body — face, hand, arm, leg, or otherwise — visible anywhere in the frame (even partially, blurred, or in the background) counts as a person present.`;

/** Build the user-turn prompt for one ranking call. The images themselves
 *  travel as separate `image_url` content parts (see rankByPeople) — this
 *  text only carries the instructions and the exact JSON contract. */
export function imageRankPrompt(n: number): string {
  return `Look at the ${n} supplied photos, in the EXACT ORDER they were attached.

Return ONLY a JSON array with exactly ${n} booleans, one per photo, in that same order:
- true if the photo shows ANY human being or ANY part of a human body (face, hand, arm, leg, etc.) anywhere in the frame, however small, partial, blurred, or in the background.
- false only when no person or body part appears anywhere in the photo.

Return the JSON array alone. No prose before or after, no markdown code fences.`;
}

function toPeopleFlag(entry: unknown): boolean | null {
  if (typeof entry === "boolean") return entry;
  if (entry && typeof entry === "object" && typeof (entry as Record<string, unknown>).people === "boolean") {
    return (entry as Record<string, unknown>).people as boolean;
  }
  return null;
}

/**
 * Parse the model's verdict array into exactly `n` booleans (pure — no
 * network). Any entry that is missing, malformed, or unparseable becomes the
 * conservative default `true` (assume a person IS present) — conservative
 * here just means "sorts no better than neutral", never a reason to drop it;
 * nothing this module touches is ever discarded.
 */
export function parsePeopleVerdicts(raw: string, n: number): boolean[] {
  const parsed = parseJsonLoose<unknown>(raw);
  const arr = Array.isArray(parsed) ? parsed : parseJsonArrayPrefix<unknown>(raw);
  const out: boolean[] = [];
  for (let i = 0; i < n; i++) {
    const flag = toPeopleFlag(arr[i]);
    out.push(flag ?? true);
  }
  return out;
}

export interface RankableImage {
  key: string;
  url: string;
}

// One vision call is plenty for a single row's worth of candidates (Hero
// tops out at 5, a service row at a raw pool of CANDIDATE_CAP=9) — no
// chunking needed, unlike the old whole-template vision pass.
const RANK_MAX_TOKENS = 4000;
const RANK_TIMEOUT_MS = 20000;

/**
 * Order `images` with people-free candidates first — a stable reorder
 * (candidates on the same side of that line keep their original relative
 * order) — using one `image_rank` vision call. Returns the reordered KEYS,
 * same set as given, nothing added or dropped.
 *
 * Never throws and never blocks sourcing: any failure — the call itself
 * throwing (network error, aborted, provider error), the assigned model
 * being unconfigured (`callForTask`/`resolveTaskModel` throws in that case),
 * or a response that doesn't parse into anything usable — is caught, logged,
 * and answered with the ORIGINAL order untouched.
 */
export async function rankByPeople(images: RankableImage[]): Promise<string[]> {
  if (images.length < 2) return images.map((i) => i.key);

  try {
    const { text } = await callForTask("image_rank", IMAGE_RANK_SYSTEM, imageRankPrompt(images.length), {
      maxTokens: RANK_MAX_TOKENS,
      temperature: 0,
      images: images.map((i) => i.url),
      timeoutMs: RANK_TIMEOUT_MS,
      // One shot. See the module docblock: retrying blows this route's
      // maxDuration to reorder a list we will happily leave as-is.
      maxAttempts: 1,
    });
    const people = parsePeopleVerdicts(text, images.length);
    return images
      .map((img, i) => ({ key: img.key, people: people[i] }))
      .sort((a, b) => Number(a.people) - Number(b.people)) // stable: false (0) before true (1)
      .map((x) => x.key);
  } catch (e) {
    console.warn(
      `[image-rank] vision ranking unavailable (${e instanceof Error ? e.message : String(e)}) — keeping original order`,
    );
    return images.map((i) => i.key);
  }
}
