import { callProvider } from "@/lib/ai-tools/run";
import { GEMINI_PRO_MODEL } from "@/lib/ai-tools/config";
import { parseJsonLoose } from "@/lib/ai/json";
import { contentModelSchema, type ContentModel } from "./contentModel";
import type { GenerationBrief } from "./brief";

export const PLAN_SYSTEM = `You are a senior web copywriter for home-service businesses. You produce ONLY strict JSON matching the requested schema. Never invent licenses, awards, certifications, or specific claims that were not provided. Testimonials must be plausible and set in the business's real service areas. Every service must come from the business's real service list.`;

/**
 * The planning prompt: hand Gemini the full brief and the exact JSON contract,
 * and forbid everything that made v1's copy generic or fabricated. Deterministic
 * (no randomness in the string) so a rerun of the same brief is reproducible.
 */
export function planPrompt(brief: GenerationBrief, pages: string[]): string {
  const pageList = pages.length ? pages.join(", ") : "index.html";
  const emailRule = brief.no_email
    ? `- This business has NO email address: set identity.email to "" and never fabricate one. Contact CTAs must use the phone.`
    : `- Use the brief's real email in identity.email when it is present; do not invent one.`;
  const designRule = brief.design_references.length
    ? `\n- The client admires these reference sites — use them ONLY to inform the look/feel you describe in image_briefs, never layout or copy claims: ${brief.design_references.join(", ")}`
    : "";

  return `Produce the CONTENT MODEL for this home-service business's website as ONE strict JSON object.

BUSINESS BRIEF — the only source of facts. Never contradict it, never pad it with invented claims:
${JSON.stringify(brief, null, 2)}

PAGES to generate (emit one "pages" entry per file below, each with its own title + meta_description):
${pageList}

RETURN EXACTLY this JSON shape and nothing else (no prose, no markdown fences):
{
  "identity": { "name": string, "tagline": string, "positioning": string, "phone": string, "email": string, "areas": string[], "years": number, "license_line": string },
  "hero": { "eyebrow": string, "headline_parts": string[], "subcopy": string, "cta_primary": string, "cta_secondary": string },
  "services": [ { "key": "kebab-slug", "name": string, "short": string, "long": string, "bullets": string[], "image_query": string } ],
  "stats": [ { "value": string, "label": string } ],
  "testimonials": [ { "quote": string, "name": string, "meta": string, "initials": string } ],
  "faq": [ { "q": string, "a": string } ],
  "about": { "story": string, "why_us": string[] },
  "pages": { "<file.html>": { "title": string, "meta_description": string } },
  "image_briefs": [ { "slot_id": string, "kind": "hero"|"service", "query": string, "must_show": string, "avoid": string } ]
}

RULES
- Every service comes from the brief's "services" list — one services[] entry per real service, in that order. Never invent, merge, or drop services.
- Use the brief's real phone and service_areas verbatim in identity; headline, subcopy and CTAs must name the real business and its actual work.
${emailRule}
- Testimonials must be plausible and LOCALIZED to the brief's real service_areas (name those cities/areas in "meta"); attribute each to a realistic first name + last initial with a matching "initials". Do not reference any area that is not in the brief.
- NEVER invent licenses, awards, certifications, insurance claims, or numbers not present in the brief. Leave identity.license_line "" when none was provided. Set identity.years only from the brief's years_experience; omit it otherwise.
- Copy must be specific to THIS business and trade — concrete and non-generic. No lorem, no placeholder text, no "[insert ...]" tokens.
- image_briefs: these are the ONLY images the finished website displays, so keep this set SMALL — NEVER one per service. Emit exactly: one hero brief (slot_id "hero-1", kind "hero"), PLUS one brief for each of the SIX most representative services (kind "service", slot_id equal to that service's "key" from services[]). At most 7 image_briefs total, even when the business has dozens of services. "query" describes the stock photo to search for; every "avoid" MUST be exactly "people, text overlays, watermarks".${designRule}
- Output MUST be a single valid JSON object, parseable as-is. No commentary before or after.`;
}

/**
 * Plan the content model with Gemini Pro. Fails loud on unparseable or
 * schema-invalid output — it NEVER falls back to a default model, because
 * "treated an empty/no-op result as success" is the exact v1 bug v2 exists to
 * kill. `model` is the model id (default the verified Pro tier); the returned
 * `model` is the validated ContentModel, `raw` the original completion (kept for
 * auditing / a later repair pass).
 */
export async function planContent(
  brief: GenerationBrief,
  pages: string[],
  model = GEMINI_PRO_MODEL,
): Promise<{ model: ContentModel; raw: string }> {
  const { text: raw } = await callProvider("gemini", model, PLAN_SYSTEM, planPrompt(brief, pages), {
    maxTokens: 32000,
    temperature: 0.6,
  });
  const json = parseJsonLoose(raw);
  if (!json) throw new Error("Planner returned no parseable JSON");
  const parsed = contentModelSchema.safeParse(json);
  if (!parsed.success) {
    throw new Error("Planner JSON failed schema: " + JSON.stringify(parsed.error.issues.slice(0, 5)));
  }
  return { model: parsed.data, raw };
}
