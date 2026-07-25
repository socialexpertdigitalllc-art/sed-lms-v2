import type { SupabaseClient } from "@supabase/supabase-js";
import { callForTask } from "@/lib/ai-tools/providers/run";
import type { CompiledTemplate, Diagnostic } from "../schema";
import { manifestSchema } from "../schema";
import { verifyTemplate } from "../compiler/verify";
import type { AiCall } from "../compiler/ai/identityAi";
import { loadPackage, loadSourceMap, savePackage } from "./templates";
import type { StudioTemplateRow } from "./types";

/** Production AiCall: routes template_compile through the task router. */
export const aiCall: AiCall = async (system, user) => {
  const { text } = await callForTask("template_compile", system, user, { maxTokens: 8000, temperature: 0.2 });
  return { text };
};

export interface EnrichOutcome {
  ok: boolean;
  reverted: boolean;
  template: CompiledTemplate;
  diagnostics: Diagnostic[];
}

/**
 * Shared enrichment engine: load → transform → verify round-trip → save or
 * revert. `transform` returns the candidate template plus its own diagnostics
 * (proposal parse warnings, rejected entries, ...).
 */
export async function runEnrichment(
  admin: SupabaseClient,
  row: Pick<StudioTemplateRow, "id" | "manifest">,
  transform: (tpl: CompiledTemplate) => Promise<{ template: CompiledTemplate; diagnostics: Diagnostic[] }>,
): Promise<EnrichOutcome> {
  if (!row.manifest) throw new Error("Template has no compiled package");
  const manifest = manifestSchema.parse(row.manifest);
  const tpl = await loadPackage(admin, row.id, manifest);
  const { template: candidate, diagnostics } = await transform(tpl);

  const source = await loadSourceMap(admin, row.id);
  const verify = verifyTemplate(candidate, source);
  const blockers = verify.filter((d) => d.level === "blocker");
  if (blockers.length > 0) {
    // The AI's change broke reproduce-the-original. Discard it entirely.
    return {
      ok: false,
      reverted: true,
      template: tpl,
      diagnostics: [
        ...diagnostics,
        {
          level: "warn",
          code: "ai_enrichment_reverted",
          message: `AI enrichment was reverted: it broke the round-trip verification (${blockers[0].message}).`,
        },
      ],
    };
  }

  await savePackage(admin, row.id, candidate);
  return { ok: true, reverted: false, template: candidate, diagnostics: [...diagnostics, ...verify] };
}

/** Merge new diagnostics into a row's list, replacing prior entries of the same codes. */
export function mergeDiagnostics(existing: Diagnostic[], fresh: Diagnostic[], codes: string[]): Diagnostic[] {
  const drop = new Set(codes);
  return [...existing.filter((d) => !drop.has(d.code)), ...fresh];
}
