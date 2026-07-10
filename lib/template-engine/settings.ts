import { createAdminClient } from "@/lib/supabase/admin";

export type TemplateEngineSettings = {
  system_prompt: string;
  edit_prompt: string;
  image_query_prompt: string;
  max_tokens: number;
  temperature: number;
};

const DEFAULT_SYSTEM_PROMPT = `You are an expert website content editor. You customize existing HTML website templates for real businesses by rewriting text and swapping image references.

Strict rules:
- NEVER change the HTML structure: do not add, remove, or reorder tags, and never touch class names, ids, data attributes, inline event handlers, <script> code, or stylesheet links.
- Only rewrite human-visible text (headlines, paragraphs, list items, buttons, alt text, <title>, meta descriptions) and the VALUES of image-source attributes (src, srcset, CSS url(...)) and contact references (phone numbers, emails, addresses, tel:/mailto: links).
- Write professional, specific copy for the business you are given. Never leave template placeholder text (lorem ipsum, "Your Company", sample phone numbers) behind on the parts you edit.
- Output ONLY a single JSON object containing edit operations. No prose, no markdown fences, no explanations.`;

const DEFAULT_EDIT_PROMPT = `Customize one page of a website template for a real business.

PAGE: {{PAGE_NAME}}
PAGE KIND: {{PAGE_KIND}}

BUSINESS:
{{BUSINESS_JSON}}

AVAILABLE LOCAL IMAGES (the only image paths that exist — use these exact paths):
{{IMAGES_LIST}}

{{EXTRA}}

Instructions:
1. Rewrite the headlines, paragraphs, calls-to-action, and contact details (phone, email, address) so the page reads as if it was written for this business. Mention its real services and service areas where natural.
2. Replace EVERY image reference on the page — every <img> src, every srcset entry, every <source> src, and every CSS url(...) that points at an image file — with one of the AVAILABLE LOCAL IMAGES paths. Choose the most contextually relevant image for each spot (hero image for the main banner, the matching service image beside service copy). Do not leave any original template image path behind and do not invent paths that are not in the list.
3. Rewrite every image alt attribute to describe the business context of the chosen image.
4. Every "find" value must be an EXACT substring copied verbatim from the PAGE HTML below — including whitespace and punctuation — and long enough to match exactly once on the page.
5. Keep each replacement structurally identical to what it replaces: text for text, attribute value for attribute value. Never emit new tags except where explicitly instructed.

Return ONLY this JSON shape (no other keys, no commentary):
{"ops":[{"find":"...","replace":"..."}]}

PAGE HTML:
{{PAGE_HTML}}`;

const DEFAULT_IMAGE_QUERY_PROMPT = `You plan stock-photo searches for a small-business website.

Given the business profile JSON below, return Pexels search queries: exactly 2 for the site hero and exactly 2 for each service. Queries must describe concrete visual scenes a photographer could shoot (e.g. "plumber fixing kitchen sink", "roofer installing shingles on house") — never abstract concepts, brand names, or single vague words.

Return ONLY this JSON shape, with a key per service exactly as named in the input:
{"hero":["query 1","query 2"],"services":{"Service Name":["query 1","query 2"]}}

BUSINESS:
{{BUSINESS_JSON}}`;

const DEFAULT_SETTINGS: TemplateEngineSettings = {
  system_prompt: DEFAULT_SYSTEM_PROMPT,
  edit_prompt: DEFAULT_EDIT_PROMPT,
  image_query_prompt: DEFAULT_IMAGE_QUERY_PROMPT,
  max_tokens: 6000,
  temperature: 0.4,
};

/**
 * Read the singleton template-engine settings row; lazily materialise the
 * defaults if missing (mirrors getAppSettings). Empty prompt columns (the
 * migration default is '') fall back to the built-in defaults per field so a
 * blank row never produces empty LLM prompts.
 */
export async function getTemplateEngineSettings(): Promise<TemplateEngineSettings> {
  const admin = createAdminClient();
  const { data } = await admin
    .from("template_engine_settings")
    .select("system_prompt, edit_prompt, image_query_prompt, max_tokens, temperature")
    .eq("singleton", true)
    .maybeSingle();

  if (data) {
    return {
      system_prompt: data.system_prompt?.trim() ? data.system_prompt : DEFAULT_SETTINGS.system_prompt,
      edit_prompt: data.edit_prompt?.trim() ? data.edit_prompt : DEFAULT_SETTINGS.edit_prompt,
      image_query_prompt: data.image_query_prompt?.trim()
        ? data.image_query_prompt
        : DEFAULT_SETTINGS.image_query_prompt,
      max_tokens: Number(data.max_tokens) || DEFAULT_SETTINGS.max_tokens,
      temperature: Number.isFinite(Number(data.temperature))
        ? Number(data.temperature)
        : DEFAULT_SETTINGS.temperature,
    };
  }

  // seed default row (service role; RLS blocks client writes)
  await admin
    .from("template_engine_settings")
    .upsert({ singleton: true, ...DEFAULT_SETTINGS }, { onConflict: "singleton" });
  return { ...DEFAULT_SETTINGS };
}
