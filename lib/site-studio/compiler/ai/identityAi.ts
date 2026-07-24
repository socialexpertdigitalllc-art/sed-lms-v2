import { parseJsonLoose } from "@/lib/ai/json";
import type { CompiledTemplate, Diagnostic } from "../../schema";
import type { IdentityAddition } from "./applyIdentity";

/** The model-call seam. Production passes callForTask("template_compile", ...);
 *  tests pass a stub. Kept minimal so no route/network types leak in here. */
export type AiCall = (system: string, user: string) => Promise<{ text: string }>;

const MAX_CORPUS = 8000;
const MAX_ADDITIONS = 20;

/** Unique human-visible strings of the package, for the model to hunt in. */
export function identityCorpus(tpl: CompiledTemplate): string {
  const seen = new Set<string>();
  const parts: string[] = [];
  const add = (s: string) => {
    const t = s.trim();
    if (t.length >= 3 && !seen.has(t)) { seen.add(t); parts.push(t); }
  };
  add(`EXISTING IDENTITY: ${JSON.stringify(tpl.manifest.identity)}`);
  for (const page of tpl.manifest.pages) {
    add(page.title_sample);
    for (const s of page.slots) add(s.sample);
    for (const rep of page.repeats) {
      for (const row of rep.samples) for (const v of Object.values(row)) add(v);
    }
  }
  for (const region of tpl.manifest.nav) {
    if (region.items) for (const it of region.items) add(it.label);
  }
  return parts.join("\n").slice(0, MAX_CORPUS);
}

const SYSTEM = `You audit website template text for RESIDUAL demo-business identity that a deterministic pass already missed. The deterministic pass has already tokenized: phone numbers, email addresses, map embeds, the business name, and copyright years — those appear as {{id:*}} tokens and are NOT your job.

You hunt ONLY for: person names, street addresses, city/region/neighborhood names, and social-media handles that identify the DEMO business. Every value you return MUST appear VERBATIM (exact casing) in the provided text. Never propose trade vocabulary ("roofing", "kitchen remodel"), never propose generic words, never invent anything.

Reply with STRICT JSON only, no prose, no fences:
{"additions":[{"key":"<snake_case_key>","value":"<verbatim text>"}]}
Keys: short snake_case like owner_name, street_address, city_2, instagram_handle. Empty findings: {"additions":[]}`;

export async function proposeIdentityAdditions(
  tpl: CompiledTemplate,
  call: AiCall,
): Promise<{ additions: IdentityAddition[]; diagnostics: Diagnostic[] }> {
  const diagnostics: Diagnostic[] = [];
  const { text } = await call(SYSTEM, `TEMPLATE TEXT:\n${identityCorpus(tpl)}`);
  const json = parseJsonLoose<{ additions?: unknown }>(text);
  const rawList = Array.isArray((json as { additions?: unknown } | null)?.additions)
    ? ((json as { additions: unknown[] }).additions)
    : null;
  if (!rawList) {
    diagnostics.push({
      level: "warn", code: "ai_identity_unparseable",
      message: "The identity-enrichment model did not return usable JSON; the template stays un-enriched (re-run to retry).",
    });
    return { additions: [], diagnostics };
  }
  const additions: IdentityAddition[] = [];
  for (const entry of rawList) {
    if (additions.length >= MAX_ADDITIONS) break;
    if (typeof entry !== "object" || entry === null) continue;
    const { key, value } = entry as { key?: unknown; value?: unknown };
    if (typeof key !== "string" || typeof value !== "string") continue;
    additions.push({ key, value });
  }
  return { additions, diagnostics };
}
