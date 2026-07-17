// Template Engine v2 — the blocking verification gates.
//
// Runs after whole-file regeneration and before a generation may reach `review`.
// Two hard checks, both biased toward failing loudly rather than shipping a
// broken or leaky site to a paying client:
//   1. Identity-leak scan across EVERY output file — any surviving demo token is
//      the exact v1 Warrior bug ("Northpoint Remodeling" on a Warrior site).
//   2. Structure preservation per file the template also had — the AI may change
//      words, never the skeleton the fixed CSS/JS is wired to.
// Pure and deterministic (accepts `now`) so it is unit-testable and its
// `GateResult` can be persisted verbatim to `template_generations.gate_results`.

import { findLeaks, type Leak } from "./demoTokens";
import {
  htmlSkeleton,
  compareSkeleton,
  jsIdentifiers,
  compareJs,
  type SkeletonDiff,
} from "./structure";

export interface GateResult {
  ok: boolean;
  leaks: Leak[];
  structure: { file: string; ok: boolean; detail?: string }[];
  checkedAt: string;
}

const HTML_RE = /\.html?$/i;
const JS_RE = /\.m?js$/i;

/** Flatten a SkeletonDiff into one readable line for the gate report / repair prompt. */
function describeSkeleton(d: SkeletonDiff): string {
  const parts: string[] = [];
  if (d.missingClasses.length) parts.push(`missing classes: ${d.missingClasses.join(", ")}`);
  if (d.missingIds.length) parts.push(`missing ids: ${d.missingIds.join(", ")}`);
  if (d.missingDataAttrs.length) parts.push(`missing data-*: ${d.missingDataAttrs.join(", ")}`);
  if (d.tagDiff.length) parts.push(`tags dropped: ${d.tagDiff.join("; ")}`);
  if (d.handlerDiff.length) parts.push(`handlers dropped: ${d.handlerDiff.join("; ")}`);
  return parts.join(" | ");
}

/**
 * Blocking verification. `ok: false` must prevent the generation reaching
 * review. Structure is compared only for files that also exist in the template
 * (a cloned/new page has no baseline to preserve); CSS and other passthrough
 * files are never regenerated, so they are not structurally checked here.
 */
export function runGates(args: {
  template: Record<string, string>;
  output: Record<string, string>;
  demoTokens: string[];
  /**
   * Files whose structure MAY legitimately differ from the template — hub pages
   * that emit one card per service/area (a variable card count). They are still
   * leak-scanned; only the tag-count/skeleton preservation is skipped.
   */
  structureExempt?: string[];
  now?: string;
}): GateResult {
  const { template, output, demoTokens } = args;
  const exempt = new Set(args.structureExempt ?? []);

  // 1. Identity-leak scan across all output files (hard fail).
  const leaks = findLeaks(output, demoTokens);

  // 2. Structure preservation for each output file with a template baseline.
  const structure: { file: string; ok: boolean; detail?: string }[] = [];
  for (const [file, out] of Object.entries(output)) {
    const src = template[file];
    if (src === undefined || exempt.has(file)) continue; // new/cloned or hub — nothing to preserve
    if (HTML_RE.test(file)) {
      const diff = compareSkeleton(htmlSkeleton(src), htmlSkeleton(out));
      structure.push(diff.ok ? { file, ok: true } : { file, ok: false, detail: describeSkeleton(diff) });
    } else if (JS_RE.test(file)) {
      const diff = compareJs(jsIdentifiers(src), jsIdentifiers(out));
      structure.push(
        diff.ok ? { file, ok: true } : { file, ok: false, detail: `missing identifiers: ${diff.missing.join(", ")}` },
      );
    }
  }

  const ok = leaks.length === 0 && structure.every((s) => s.ok);
  return { ok, leaks, structure, checkedAt: args.now ?? new Date().toISOString() };
}
