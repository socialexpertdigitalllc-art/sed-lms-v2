// Template Engine v2 — the SAFE "Ask AI to fix" for a genuinely-fixable template
// health failure.
//
// WHY THIS IS DANGEROUS, AND WHAT MAKES IT SAFE. A template is not a client's
// site — it is the SEED every future generation grows from. An AI edit that
// corrupts a template poisons every site built from it afterwards, silently, and
// long after the operator who clicked "fix" has moved on. So the model is never
// trusted: it PROPOSES edits, and the proposal is judged, deterministically,
// against the same health checks that flagged the problem in the first place.
//
// The whole flow is copy -> patch -> re-check -> decide, and the decision is
// conservative by construction:
//   1. the template's files are loaded into memory (the route does the I/O);
//   2. the model returns minimal, targeted edits (rename a poison demo business
//      away from an ordinary word; add a bindable :root palette);
//   3. the edits are applied to an in-memory COPY — storage is never touched here;
//   4. demo_tokens are re-derived and runTemplateHealthChecks is re-run on the
//      patched copy;
//   5. `improved` is true only when NO new failure was introduced AND at least
//      one prior failure was resolved AND no file was blanked. The apply step
//      refuses to write unless `improved` is true.
//
// Only two checks are both build-blocking-or-degrading AND AI-fixable:
//   - demo_tokens_poison — the build-blocker. A demo token that collides with an
//     ordinary English word fails the leak gate on legitimate client copy; the
//     fix renames the demo business to a distinctive wordmark. This is the one
//     that makes `improved` reachable, because it is the one that is a `fail`.
//   - theme_applicable — secondary, and now a `warn`, not a `fail`. Fixed
//     opportunistically when it is degraded: add :root custom properties and
//     point the template's dominant colours at them, so a client's palette binds
//     precisely instead of being hex-remapped (or lost).
//
// Anything else that fails (structure_parsable, an empty file set) is NOT
// AI-fixable — it is malformed markup a human must repair — so the feature
// declines it rather than pretending.
//
// PURE: no I/O, no network, no direct AI call. The model is injected as a plain
// async function, so every decision here is unit-testable with a mock.

import {
  runTemplateHealthChecks,
  SEVERITY_RANK,
  type HealthReport,
  type HealthSeverity,
} from "./health";
import { extractDemoTokens } from "./demoTokens";
import type { TemplateManifest } from "./types";
import { parseJsonLoose } from "@/lib/ai/json";

/** The health checks this feature knows how to repair. */
export const AI_FIXABLE_CHECK_IDS = ["demo_tokens_poison", "theme_applicable"] as const;

const HTML_JS_RE = /\.(html?|m?js)$/i;

/** The html/js subset demo-token extraction reads (a stylesheet has no identity). */
export function tokenFilesOf(files: Record<string, string>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [f, c] of Object.entries(files)) if (HTML_JS_RE.test(f)) out[f] = c;
  return out;
}

// ---------------------------------------------------------------------------
// the model's proposal
// ---------------------------------------------------------------------------

/**
 * One minimal edit. Exactly one of two shapes:
 *   - a literal find/replace, applied to `file` (or every text file when `file`
 *     is omitted) — used to rename the demo business and to repoint hex colours
 *     at a var();
 *   - an `append`, added to the end of `file` — used to add a :root palette block.
 * Deliberately not "return the whole file": a targeted edit cannot silently drop
 * the 90% of the file it never mentions.
 */
export interface FixEdit {
  file?: string;
  find?: string;
  replace?: string;
  append?: string;
}

export interface FixProposal {
  summary: string;
  edits: FixEdit[];
}

/** Parse the model's strict-JSON reply into a proposal, or null when unusable. */
export function parseFixProposal(raw: string): FixProposal | null {
  const parsed = parseJsonLoose<{ summary?: unknown; edits?: unknown }>(raw);
  if (!parsed || typeof parsed !== "object") return null;
  const rawEdits = Array.isArray(parsed.edits) ? parsed.edits : [];
  const edits: FixEdit[] = [];
  for (const e of rawEdits) {
    if (!e || typeof e !== "object") continue;
    const o = e as Record<string, unknown>;
    const edit: FixEdit = {};
    if (typeof o.file === "string" && o.file.trim()) edit.file = o.file.trim();
    if (typeof o.find === "string") edit.find = o.find;
    if (typeof o.replace === "string") edit.replace = o.replace;
    if (typeof o.append === "string") edit.append = o.append;
    const isReplace = typeof edit.find === "string" && edit.find.length > 0 && typeof edit.replace === "string";
    const isAppend = typeof edit.append === "string" && edit.append.length > 0 && !!edit.file;
    if (isReplace || isAppend) edits.push(edit);
  }
  if (edits.length === 0) return null;
  const summary = typeof parsed.summary === "string" && parsed.summary.trim() ? parsed.summary.trim() : "AI-proposed edits";
  return { summary, edits };
}

// ---------------------------------------------------------------------------
// applying edits to an in-memory copy
// ---------------------------------------------------------------------------

export interface FileChange {
  file: string;
  before: string;
  after: string;
}

/**
 * Apply a proposal to a COPY of `files`. Never mutates the input, never creates
 * a new file (an edit that names a path the template does not have is ignored —
 * the model may not invent files), never touches a binary. Returns the patched
 * map plus the per-file changes for the preview.
 */
export function applyFixEdits(
  files: Record<string, string>,
  edits: FixEdit[]
): { files: Record<string, string>; changes: FileChange[] } {
  const patched: Record<string, string> = { ...files };
  for (const edit of edits) {
    if (typeof edit.append === "string" && edit.append.length > 0 && edit.file) {
      if (patched[edit.file] === undefined) continue; // no inventing files
      patched[edit.file] = patched[edit.file] + edit.append;
      continue;
    }
    if (typeof edit.find === "string" && edit.find.length > 0 && typeof edit.replace === "string") {
      const targets = edit.file ? [edit.file] : Object.keys(patched);
      for (const t of targets) {
        if (patched[t] === undefined) continue;
        // Literal, case-sensitive replace-all (split/join, not RegExp) so a `$`
        // or `\` in the replacement is inert and nothing a lead typed can inject.
        patched[t] = patched[t].split(edit.find).join(edit.replace);
      }
    }
  }
  const changes: FileChange[] = [];
  for (const f of Object.keys(files)) {
    if (patched[f] !== files[f]) changes.push({ file: f, before: files[f], after: patched[f] });
  }
  return { files: patched, changes };
}

// ---------------------------------------------------------------------------
// the improvement decision — the gate that makes apply safe
// ---------------------------------------------------------------------------

export interface Improvement {
  /** Fail-based only (see planTemplateFix for the blanked-file guard on top). */
  improved: boolean;
  resolvedFails: string[];
  newFails: string[];
  /** Any check whose severity got strictly worse — for honest reporting. */
  regressions: string[];
}

/**
 * Compare two reports. `improved` is true only when the edit resolved at least
 * one prior FAIL and introduced no new FAIL. Resolving a warn/info alone is not
 * enough to earn an apply — the point of the feature is to clear build-blockers.
 */
export function assessImprovement(before: HealthReport, after: HealthReport): Improvement {
  const b = new Map(before.checks.map((c) => [c.id, c.severity] as const));
  const a = new Map(after.checks.map((c) => [c.id, c.severity] as const));
  const ids = new Set([...b.keys(), ...a.keys()]);
  const resolvedFails: string[] = [];
  const newFails: string[] = [];
  const regressions: string[] = [];
  for (const id of ids) {
    const bs: HealthSeverity = b.get(id) ?? "pass";
    const as: HealthSeverity = a.get(id) ?? "pass";
    if (bs === "fail" && as !== "fail") resolvedFails.push(id);
    if (as === "fail" && bs !== "fail") newFails.push(id);
    if (SEVERITY_RANK[as] > SEVERITY_RANK[bs]) regressions.push(id);
  }
  return { improved: newFails.length === 0 && resolvedFails.length > 0, resolvedFails, newFails, regressions };
}

/**
 * Files that went empty (or whitespace-only) when they were not before — the
 * "blank a template" outcome the safety model exists to prevent. Health alone
 * would miss a blanked .js or .css (an empty JS file still "parses"), so this is
 * an explicit belt-and-braces guard ANDed into the final decision.
 */
export function blankedFiles(before: Record<string, string>, after: Record<string, string>): string[] {
  const out: string[] = [];
  for (const [f, content] of Object.entries(before)) {
    const wasNonEmpty = content.trim().length > 0;
    const nowEmpty = (after[f] ?? "").trim().length === 0;
    if (wasNonEmpty && nowEmpty) out.push(f);
  }
  return out;
}

// ---------------------------------------------------------------------------
// deciding whether a template is fixable at all
// ---------------------------------------------------------------------------

export interface Fixability {
  /** The feature can run: there is a build-blocking, AI-fixable failure. */
  fixable: boolean;
  /** Human explanation when it cannot (named non-fixable fails, or nothing to do). */
  reason: string | null;
  /** Check ids the fix will target (demo_tokens_poison, and theme when degraded). */
  targets: string[];
}

function severityOf(report: HealthReport, id: string): HealthSeverity | undefined {
  return report.checks.find((c) => c.id === id)?.severity;
}

/**
 * Decide whether this report is one the AI-fix can help with. The trigger is a
 * FIXABLE FAIL (only demo_tokens_poison qualifies — it is the sole AI-fixable
 * build-blocker). theme_applicable is bundled in when it is degraded, but never
 * on its own: resolving a warn cannot make `improved` true, so offering it alone
 * would be a button that can never apply.
 */
export function assessFixability(report: HealthReport): Fixability {
  const demoFail = severityOf(report, "demo_tokens_poison") === "fail";
  const themeSev = severityOf(report, "theme_applicable");
  const themeDegraded = themeSev === "warn" || themeSev === "fail";

  if (!demoFail) {
    const nonFixableFails = report.checks
      .filter((c) => c.severity === "fail" && !AI_FIXABLE_CHECK_IDS.includes(c.id as (typeof AI_FIXABLE_CHECK_IDS)[number]))
      .map((c) => c.id);
    const reason =
      nonFixableFails.length > 0
        ? `The remaining failure${nonFixableFails.length === 1 ? "" : "s"} (${nonFixableFails.join(", ")}) ${
            nonFixableFails.length === 1 ? "is" : "are"
          } malformed-markup problems the AI cannot safely auto-fix — they need a human to repair the template's HTML/JS.`
        : "There is no AI-fixable, build-blocking failure to fix here.";
    return { fixable: false, reason, targets: [] };
  }

  const targets = ["demo_tokens_poison", ...(themeDegraded ? ["theme_applicable"] : [])];
  return { fixable: true, reason: null, targets };
}

// ---------------------------------------------------------------------------
// the prompt
// ---------------------------------------------------------------------------

const FIX_SYSTEM_PROMPT = `You repair a WEBSITE TEMPLATE's demo identity and colour setup with the smallest possible edits. This template is a reusable seed for many generated client sites, so you must be surgical and never rewrite whole files.

Return ONLY a strict JSON object, no prose, no markdown fences:
{
  "summary": "one short sentence describing the change",
  "edits": [
    { "file": "<path or omit for all text files>", "find": "<exact literal substring>", "replace": "<replacement>" },
    { "file": "<stylesheet path>", "append": "<CSS text to add at the end of that file>" }
  ]
}

Rules:
- Each edit is EITHER a literal find/replace (case-sensitive, replaces every occurrence) OR an append to one file. Never both in one edit.
- Only edit files that already exist. Never invent a file. Never blank a file.
- Keep edits minimal and targeted; do not touch markup structure, class names, ids, or layout.`;

function poisonFixInstructions(report: HealthReport): string {
  const detail = report.checks.find((c) => c.id === "demo_tokens_poison")?.detail ?? "";
  return `PROBLEM (demo_tokens_poison): ${detail}
The demo business is named with an ordinary English word, so the leak gate will flag that word inside legitimate client copy. Rename the demo business to a DISTINCTIVE, invented wordmark (e.g. "Northpoint", "Vantara", "Brightforge") that no ordinary sentence would contain. Provide find/replace edits for every place the ordinary-word name appears (page titles, header/footer wordmark, JS strings), replacing only the distinctive part — keep the trade word (e.g. "Heating & Air") intact.`;
}

function themeFixInstructions(report: HealthReport): string {
  const detail = report.checks.find((c) => c.id === "theme_applicable")?.detail ?? "";
  return `PROBLEM (theme_applicable): ${detail}
Give the stylesheet a bindable palette so a client's colours can be applied precisely. Append a :root block declaring 1-3 NON-GREY brand custom properties (e.g. :root{ --brand:#2b6cb0; --brand-deep:#1a4e80; --accent:#e08a1e; }) to the stylesheet, and add find/replace edits that repoint the template's dominant hard-coded brand colours at those variables (e.g. find "#2b6cb0" replace "var(--brand)"). The declared variables must be referenced via var() at least once, or they do not count.`;
}

/** Build the (system, user) prompt for the fixable targets in this report. */
export function buildFixPrompt(
  report: HealthReport,
  targets: string[],
  files: Record<string, string>,
  demoTokens: string[]
): { system: string; user: string } {
  const sections: string[] = [];
  if (targets.includes("demo_tokens_poison")) sections.push(poisonFixInstructions(report));
  if (targets.includes("theme_applicable")) sections.push(themeFixInstructions(report));

  // Give the model the raw material it needs: the extracted demo tokens, and the
  // text files (html/js for the rename, css for the palette). Bounded so a huge
  // template cannot blow the prompt budget.
  const relevant = Object.entries(files).filter(([f]) => HTML_JS_RE.test(f) || /\.css$/i.test(f));
  const fileBlocks = relevant
    .map(([f, c]) => `----- ${f} -----\n${c.length > 6000 ? c.slice(0, 6000) + "\n…(truncated)" : c}`)
    .join("\n\n");

  const user = `${sections.join("\n\n")}

Demo tokens currently extracted from this template: ${demoTokens.length ? demoTokens.join(", ") : "(none)"}

Template files:
${fileBlocks}`;
  return { system: FIX_SYSTEM_PROMPT, user };
}

// ---------------------------------------------------------------------------
// the orchestrator — pure but for the injected model call
// ---------------------------------------------------------------------------

/** A minimal model call: given system+user prompts, return the raw completion text. */
export type ModelCall = (system: string, user: string) => Promise<string>;

export interface FixPreview {
  fixable: boolean;
  reason: string | null;
  targetedChecks: string[];
  /** Health of the template as it stands now. */
  before: HealthReport;
  /** Health of the in-memory patched copy (equals `before` when nothing changed). */
  after: HealthReport;
  /** The final apply gate: fail-based improvement AND no blanked file. */
  improved: boolean;
  improvement: Improvement;
  blanked: string[];
  /** The model's one-line summary of what it changed. */
  summary: string;
  /** Only the files that actually changed — path -> new content. Empty when none. */
  proposedFiles: Record<string, string>;
  /** Per-file change descriptors for the preview UI. */
  changes: { file: string; sizeBefore: number; sizeAfter: number }[];
}

/**
 * Produce a non-destructive fix PREVIEW: ask the model for edits, apply them to
 * a copy, re-derive tokens, re-run the health checks, and report whether the
 * result is genuinely better. Writes nothing. The caller decides whether to
 * apply, and may only apply when `improved` is true.
 */
export async function planTemplateFix(input: {
  files: Record<string, string>;
  demoTokens: string[];
  manifest?: TemplateManifest | null;
  callModel: ModelCall;
  now?: string;
}): Promise<FixPreview> {
  const { files, demoTokens, manifest, callModel, now } = input;
  const before = runTemplateHealthChecks({ files, demoTokens, manifest, now });

  const fixability = assessFixability(before);
  const emptyPreview = (extra: Partial<FixPreview>): FixPreview => ({
    fixable: fixability.fixable,
    reason: fixability.reason,
    targetedChecks: fixability.targets,
    before,
    after: before,
    improved: false,
    improvement: { improved: false, resolvedFails: [], newFails: [], regressions: [] },
    blanked: [],
    summary: "",
    proposedFiles: {},
    changes: [],
    ...extra,
  });

  if (!fixability.fixable) return emptyPreview({});

  const { system, user } = buildFixPrompt(before, fixability.targets, files, demoTokens);
  let raw = "";
  try {
    raw = await callModel(system, user);
  } catch (e) {
    return emptyPreview({ reason: `The model call failed: ${e instanceof Error ? e.message : "unknown error"}.` });
  }
  const proposal = parseFixProposal(raw);
  if (!proposal) return emptyPreview({ reason: "The model did not return a usable set of edits." });

  const { files: patched, changes } = applyFixEdits(files, proposal.edits);
  if (changes.length === 0) {
    return emptyPreview({ summary: proposal.summary, reason: "The proposed edits did not change any file." });
  }

  const afterTokens = extractDemoTokens(tokenFilesOf(patched));
  const after = runTemplateHealthChecks({ files: patched, demoTokens: afterTokens, manifest, now });
  const improvement = assessImprovement(before, after);
  const blanked = blankedFiles(files, patched);
  const improved = improvement.improved && blanked.length === 0;

  const proposedFiles: Record<string, string> = {};
  for (const ch of changes) proposedFiles[ch.file] = ch.after;

  return {
    fixable: true,
    reason: null,
    targetedChecks: fixability.targets,
    before,
    after,
    improved,
    improvement,
    blanked,
    summary: proposal.summary,
    proposedFiles,
    changes: changes.map((c) => ({ file: c.file, sizeBefore: c.before.length, sizeAfter: c.after.length })),
  };
}
