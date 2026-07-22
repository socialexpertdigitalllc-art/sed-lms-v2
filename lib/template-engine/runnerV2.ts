// Template Engine v2 — the generation runner.
//
// Replaces v1's edit-ops core with: brief (full lead) -> content plan (Gemini) ->
// whole-file regeneration of every content file -> blocking verification gates.
// Reuses v1's proven scaffolding (storage list/download, the step tracker, zip +
// upload to `template-sites`) and only swaps the customization core, so the
// realtime UI, preview and deploy legs keep working unchanged.
//
// Phase 2 splits the single run into two entry points around a human pause for
// image curation (spec §3/§7): runTemplateGenerationV2() plans the content
// model, gathers + vision-ranks image candidates into per-slot `image_slots`,
// and STOPS at status='curating' for the operator to pick images per slot.
// buildFromSelection() resumes once picks are made: it resolves the SELECTED
// urls and runs the shared runBuildPipeline() helper — Phase 1's prepare ->
// regenerate -> verify -> finalize logic, extracted verbatim so both phases
// get identical behavior.
//
// The design is preserved BY CONSTRUCTION: CSS and other passthrough assets are
// never sent to the model, so `style.css` ships byte-identical. The demo business
// is evicted BY VERIFICATION: runGates() fails the build if any demo token
// survives or any structural hook is dropped, so v1's "shipped the template
// unchanged" outcome cannot reach `review`.

import type { SupabaseClient } from "@supabase/supabase-js";
import { createAdminClient } from "@/lib/supabase/admin";
import { buildBrief, type GenerationBrief } from "./brief";
import { planContent } from "./plan";
import type { ContentModel } from "./contentModel";
import { applyThemeToCss } from "./themeCss";
import { applyLogoToHtml } from "./logo";
import { pruneNavToBuiltPages } from "./nav";
import { ensureSiteIntegrity } from "./integrity";
import { classifyFiles } from "./classify";
import { selectContentFiles, type ManifestPage } from "./pageSelect";
import { neutralizeAppIdentifier } from "./neutralize";
import { regenerateFile } from "./regenerate";
import { personalizeFile } from "./personalize";
import { runGates, type GateResult } from "./gates";
import { describeLeakGuarantee, guaranteeNoLeaks } from "./leakGuarantee";
import {
  describeNicheGuarantee,
  findNicheDrift,
  guaranteeNoNicheDrift,
  nicheDriftFingerprint,
  repairNoteForNiche,
  type NicheDriftHit,
} from "./nicheGuarantee";
import { zipFromMap } from "./zip";
import { buildInitialSlots } from "./gatherImages";
import type { ImageCandidate, ImageSlot } from "./imageSlots";
import { businessSlug, websiteId } from "./slug";
import { contentTypeFor, listStorageFiles } from "./runner";
import { readControl, startControlWatcher, type HaltMode } from "./control";
import { GenerationAbortReason, haltModeOf, registerGeneration, unregisterGeneration } from "./abortRegistry";
import { removeGenerationArtifacts } from "./cleanup";
import { clearStale, parseStaleSteps, resetStepsForRedo, sameStale, type RedoStepKey } from "./redo";
import type { GenStep } from "./types";

const TEMPLATES_BUCKET = "website-templates";
const SITES_BUCKET = "template-sites";
const TEXT_FILE_RE = /\.(html?|css|js|mjs)$/i;
const UPLOAD_BATCH = 8;
const REGEN_CONCURRENCY = 3; // keep wall-clock sane without hammering the provider

/**
 * Thrown by a checkpoint to unwind out of the pipeline when the operator asked
 * for a pause or a stop. It is NOT a failure: both phase-level catch blocks
 * recognise it, persist the halt and return cleanly, so nothing writes
 * `status: 'failed'` or an `error` string. It is an exception purely because
 * that is the only way to abandon work from inside the per-file regeneration
 * pool and the repair loop without threading a return code through every layer.
 */
export class GenerationHalted extends Error {
  constructor(
    readonly mode: HaltMode,
    /** The checkpoint name, for the "Paused at …" UI and the step detail. */
    readonly at: string,
  ) {
    super(`Generation ${mode === "pause" ? "paused" : "cancelled"} at ${at}`);
    this.name = "GenerationHalted";
  }
}

/**
 * Turn "the run's abort signal fired" into the halt the catch blocks already
 * know how to land. Any error raised while the signal is aborted IS the stop —
 * the fetch rejection, the "Regeneration failed for x" wrapper, an upload that
 * lost its connection — so the phase never reports `failed` for a run the
 * operator deliberately ended. Returns null when the signal is still live, in
 * which case the error was a genuine failure and takes the normal path.
 */
function haltFromSignal(signal: AbortSignal, at: string): GenerationHalted | null {
  const mode = haltModeOf(signal);
  return mode ? new GenerationHalted(mode, at) : null;
}

function stringArray(v: unknown): string[] {
  return Array.isArray(v) ? v.filter((s): s is string => typeof s === "string" && s.trim().length > 0) : [];
}

/** Defensive read of `website_templates.manifest.pages` — DB JSON, shape not guaranteed. */
function manifestPagesOf(manifest: unknown): ManifestPage[] {
  const pages = manifest && typeof manifest === "object" ? (manifest as { pages?: unknown }).pages : undefined;
  if (!Array.isArray(pages)) return [];
  return pages.filter(
    (p): p is ManifestPage =>
      !!p &&
      typeof p === "object" &&
      typeof (p as ManifestPage).file === "string" &&
      typeof (p as ManifestPage).kind === "string",
  );
}

/**
 * Defensive read of `template_generations.steps` — DB JSON, shape not
 * guaranteed. The build phase continues this array (rather than starting a
 * fresh one) so the realtime tracker shows one continuous timeline across
 * both phases.
 */
function genStepArray(v: unknown): GenStep[] {
  if (!Array.isArray(v)) return [];
  return v.filter(
    (s): s is GenStep => !!s && typeof s === "object" && typeof (s as GenStep).key === "string" && typeof (s as GenStep).status === "string",
  );
}

// Build/deploy-phase step keys — everything from `prepare` onward, including
// the per-file `build:<file>` steps and any prior `deploy:*` attempt. Plan-phase
// keys (`plan`, `images`, `curate`) are NOT build/deploy-phase and survive.
const BUILD_PHASE_KEYS = new Set(["prepare", "verify", "finalize"]);

/**
 * Strip prior build/deploy-phase entries from a generation's step timeline
 * before a rebuild runs. Reopening a `review` run back to `curating` (the
 * spec's edit-and-rebuild loop) and hitting Build again resumes the SAME
 * `steps` array the plan phase started — without this, `runBuildPipeline`
 * appends a second round of `prepare`/`build:<file>`/`verify`/`finalize`
 * entries, and the per-file updater's `steps.find(s => s.key === ...)` always
 * matches the FIRST (stale, already-`done`) entry, leaving the new duplicates
 * stuck at `running` forever. Mirrors the deploy route's own `deploy:*` prune
 * (app/api/template-engine/generations/[id]/deploy/route.ts). Pure — no I/O.
 */
export function pruneBuildPhaseSteps(steps: GenStep[]): GenStep[] {
  return steps.filter((s) => !BUILD_PHASE_KEYS.has(s.key) && !s.key.startsWith("build:") && !s.key.startsWith("deploy:"));
}

/**
 * How a content file is personalised.
 *
 *  - "text"       — the DEFAULT. Extract the translatable strings, rewrite them
 *                   in bounded batches, splice them back deterministically. The
 *                   markup never reaches the model, so it cannot be damaged, and
 *                   a small/cheap model (MiniMax, DeepSeek) can do the job.
 *                   See personalize.ts.
 *  - "whole_file" — the original path: send the whole file, demand the whole
 *                   file back. Kept intact as the escape hatch, and still the
 *                   only thing that has run in production. See regenerate.ts.
 *
 * Selected per generation via `template_generations.options.regen_mode` — a
 * JSON column, so switching back costs no migration and no deploy.
 */
export type RegenMode = "text" | "whole_file";

export function regenModeOf(options: unknown): RegenMode {
  const v = options && typeof options === "object" ? (options as { regen_mode?: unknown }).regen_mode : undefined;
  return v === "whole_file" ? "whole_file" : "text";
}

/** `template_generations.options` — defaults to excluding people unless explicitly set to false. */
function excludePeopleOf(options: unknown): boolean {
  const v = options && typeof options === "object" ? (options as { exclude_people?: unknown }).exclude_people : undefined;
  return v !== false;
}

/** Defensive read of `template_generations.image_slots` — DB JSON, shape not guaranteed. */
function imageSlotsOf(v: unknown): ImageSlot[] {
  if (!Array.isArray(v)) return [];
  return v.filter((s): s is ImageSlot => {
    if (!s || typeof s !== "object") return false;
    const slot = s as Partial<ImageSlot>;
    return (
      typeof slot.id === "string" &&
      typeof slot.kind === "string" &&
      Array.isArray(slot.candidates) &&
      Array.isArray(slot.selected)
    );
  });
}

/** One resolved image wired into a regenerated file — a direct CDN url, no rehost. */
interface SelectedImage {
  slot_id: string;
  kind: string;
  url: string;
  // Mirrors ImageCandidate["source"] — "curated" joined it when the curation
  // screen started offering human-approved library images as a fallback.
  source: ImageCandidate["source"];
}

/**
 * The candidate a slot's selected url came from, for its `source` tag.
 * Defaults to "pexels" if the url is somehow no longer a listed candidate —
 * should never happen, since the curation APIs (Task 5) only ever add a url
 * to `selected` after it already exists as a candidate.
 */
function candidateSourceFor(slot: ImageSlot, url: string): SelectedImage["source"] {
  return slot.candidates.find((c) => c.url === url)?.source ?? "pexels";
}

/**
 * Build the `imagesForFile` list `regenerateFile` expects from the operator's
 * curated `image_slots`: one entry per slot's selected url (in slot order),
 * tagged with the slot's id/kind so the model knows which part of the page
 * each image belongs to. A slot with nothing selected — should never happen,
 * the /build API (Task 5) requires `selected.length >= 1` on every slot
 * before it will queue a build — falls back to the slot's top (best-ranked)
 * candidate so a data gap can never crash the pipeline; a slot with neither
 * selected urls nor candidates contributes nothing, same as Phase 1's
 * resolveImages() silently skipping a brief Pexels had no hit for.
 */
function imagesForFileFrom(slots: ImageSlot[]): SelectedImage[] {
  const out: SelectedImage[] = [];
  for (const slot of slots) {
    if (slot.selected.length > 0) {
      for (const url of slot.selected) {
        out.push({ slot_id: slot.id, kind: slot.kind, url, source: candidateSourceFor(slot, url) });
      }
      continue;
    }
    const top = slot.candidates[0];
    if (top) out.push({ slot_id: slot.id, kind: slot.kind, url: top.url, source: top.source });
  }
  return out;
}

/**
 * Personalise ONE content file by whichever path this generation selected.
 *
 * The two paths are interchangeable at this seam by design: same inputs, same
 * `string` out, same gates behind them. That is what makes `regen_mode` a real
 * escape hatch rather than a flag nobody dares flip.
 */
async function buildOneFile(args: {
  regenMode: RegenMode;
  file: string;
  source: string;
  contentModel: ContentModel;
  imagesForFile: SelectedImage[];
  demoTokens: string[];
  repairNote?: string;
  signal?: AbortSignal;
}): Promise<string> {
  const { regenMode, ...rest } = args;
  if (regenMode === "whole_file") return regenerateFile(rest);
  return (await personalizeFile(rest)).text;
}

/** Download every template file, splitting text (editable/passthrough) from binary. */
async function downloadTemplate(
  admin: SupabaseClient,
  storagePrefix: string,
): Promise<{ textFiles: Record<string, string>; binaryFiles: Record<string, Uint8Array> }> {
  const prefix = storagePrefix.replace(/\/+$/, "");
  const paths = await listStorageFiles(admin, TEMPLATES_BUCKET, prefix);
  const textFiles: Record<string, string> = {};
  const binaryFiles: Record<string, Uint8Array> = {};
  const decoder = new TextDecoder();
  const keep = paths.map((full) => ({ full, rel: full.slice(prefix.length + 1) })).filter(({ rel }) => rel.length > 0);
  for (let i = 0; i < keep.length; i += UPLOAD_BATCH) {
    await Promise.all(
      keep.slice(i, i + UPLOAD_BATCH).map(async ({ full, rel }) => {
        const { data, error } = await admin.storage.from(TEMPLATES_BUCKET).download(full);
        if (error || !data) throw new Error(`Failed to download template file ${rel}: ${error?.message ?? "no data"}`);
        const bytes = new Uint8Array(await data.arrayBuffer());
        if (TEXT_FILE_RE.test(rel)) textFiles[rel] = decoder.decode(bytes);
        else binaryFiles[rel] = bytes;
      }),
    );
  }
  return { textFiles, binaryFiles };
}

/** Run `worker` over `items` at most `limit` at a time; rethrow the first failure. */
async function runWithConcurrency<T>(items: T[], limit: number, worker: (item: T) => Promise<void>): Promise<void> {
  const queue = [...items];
  let failure: unknown = null;
  async function drain(): Promise<void> {
    while (queue.length && failure === null) {
      const item = queue.shift()!;
      try {
        await worker(item);
      } catch (e) {
        failure = e; // stop handing out new work; let in-flight tasks settle
      }
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, drain));
  if (failure !== null) throw failure;
}

const offenderFiles = (gate: GateResult): string[] => {
  const set = new Set<string>();
  for (const l of gate.leaks) set.add(l.file);
  for (const s of gate.structure) if (!s.ok) set.add(s.file);
  return [...set];
};

/** The exact problems in one file, phrased for the regeneration repair pass. */
function repairNoteFor(file: string, gate: GateResult): string {
  const lines: string[] = [];
  const leaked = [...new Set(gate.leaks.filter((l) => l.file === file).map((l) => l.token))];
  if (leaked.length) lines.push(`Remove these leaked demo tokens entirely (any casing): ${leaked.join(", ")}`);
  const struct = gate.structure.find((s) => s.file === file && !s.ok);
  if (struct?.detail) lines.push(`Restore the template structure you dropped: ${struct.detail}`);
  return lines.join("\n");
}

/**
 * How many times the pipeline may re-regenerate the offending files before it
 * gives up. Every round is a full AI call per offender — real money and real
 * wall-clock on a run an operator is watching — so the cap is deliberately
 * small; three is enough for the failures that ARE model noise (a stray demo
 * word, a dropped section) and stops us burning credits on the ones that are
 * not. The no-progress break below usually stops sooner than the cap.
 */
export const MAX_REPAIR_ROUNDS = 3;

/**
 * The identity of a gate FAILURE: the sorted `file:token` leaks plus the sorted
 * files whose structure broke. Pure, so the repair loop's stop condition is
 * unit-testable without an AI call.
 */
export function gateFingerprint(gate: GateResult): string {
  const leaks = [...new Set(gate.leaks.map((l) => `${l.file}:${l.token}`))].sort();
  const structure = gate.structure.filter((s) => !s.ok).map((s) => s.file).sort();
  return JSON.stringify({ leaks, structure });
}

/**
 * Did a repair round accomplish nothing? A round that regenerated the offenders
 * and came back with the exact same leaks in the exact same files did not fail
 * by chance — the condition is one the model cannot write its way out of (a
 * token like "King" that every paragraph legitimately contains, an identifier
 * it is required to keep). Repeating it only burns tokens and the operator's
 * time, so the loop breaks immediately and says so.
 */
export function repairStalled(before: GateResult, after: GateResult): boolean {
  return !after.ok && gateFingerprint(before) === gateFingerprint(after);
}

/**
 * One-line human summary of a failing gate, for the generation's `error`.
 * `ctx` distinguishes the two very different endings — "we tried N times and it
 * never moved" (stop editing copy, look at the demo tokens) from "we tried N
 * times and ran out of rounds" (a retry may well succeed).
 */
export function describeGateFailure(gate: GateResult, ctx?: { rounds: number; stalled: boolean }): string {
  const parts: string[] = [];
  if (gate.leaks.length) parts.push("leaks — " + [...new Set(gate.leaks.map((l) => `${l.file}:${l.token}`))].join("; "));
  const badStruct = gate.structure.filter((s) => !s.ok);
  if (badStruct.length) parts.push("structure — " + badStruct.map((s) => `${s.file}: ${s.detail ?? "changed"}`).join("; "));
  const body = parts.join(" | ") || "unknown gate failure";
  if (!ctx || ctx.rounds === 0) return body;
  const lead = ctx.stalled
    ? `no progress after ${ctx.rounds} repair round(s) — the same problems came back unchanged, so this needs a human (check the template's demo tokens)`
    : `still failing after ${ctx.rounds} repair round(s)`;
  return `${lead} | ${body}`;
}

/**
 * Bring a halted run to rest. Called from either phase's catch block once it
 * recognises a GenerationHalted, and NEVER writes `failed` or an `error` —
 * asking a run to stop is not a way for it to fail.
 *
 * pause  -> status 'paused' + `paused_at`, `control` cleared. Every artefact
 *           the run produced so far (brief, content_model, image_slots,
 *           site_slug, and any zip from an earlier attempt) is left untouched
 *           because it simply is not named in the update, so /resume can pick
 *           the run back up exactly where the abort landed.
 * cancel -> status 'cancelled', `control` cleared. The caller passes
 *           `extra = { zip_path: null }` after deleting the partial storage
 *           artefacts, because an immediate stop can interrupt finalize
 *           mid-upload. Terminal, but /retry still accepts it.
 *
 * Steps still marked `running` are rolled back to `pending`: those are the
 * per-file build entries the concurrency pool never got to. Leaving them
 * `running` would show a paused run with spinners forever, and they carry no
 * output, so `pending` is the truthful state.
 */
async function persistHalt(
  admin: SupabaseClient,
  generationId: string,
  halt: GenerationHalted,
  steps: GenStep[],
  currentKey: string | null,
  extra?: Record<string, unknown>,
): Promise<void> {
  for (const s of steps) {
    if (s.status === "running") {
      s.status = "pending";
      s.started_at = undefined;
    }
  }
  const paused = halt.mode === "pause";
  await admin
    .from("template_generations")
    .update({
      steps,
      current_step: currentKey,
      status: paused ? "paused" : "cancelled",
      control: null,
      paused_at: paused ? new Date().toISOString() : null,
      error: null,
      updated_at: new Date().toISOString(),
      ...(extra ?? {}),
    })
    .eq("id", generationId);
  // Resolve the in-flight queue row so the processor cannot re-claim it. The
  // processor also does this on a clean return; doing it here too keeps direct
  // callers of the runner honest.
  await admin
    .from("template_gen_queue")
    .update({ status: "done", finished_at: new Date().toISOString() })
    .eq("generation_id", generationId)
    .eq("status", "processing");
}

/**
 * Bring a halted run to rest, including the cleanup an IMMEDIATE stop makes
 * necessary. Cancel is terminal, so anything the abort left half-written in
 * `template-sites` is deleted and `zip_path` nulled in the same write — a
 * dangling partial site must never be downloadable or deployable. Pause deletes
 * nothing: it has to stay resumable, and the build phase re-uploads with
 * `upsert`, so leftovers are overwritten rather than orphaned.
 *
 * Cleanup is best-effort by construction (removeGenerationArtifacts never
 * throws): failing to delete a blob must not stop the stop from being recorded.
 */
async function landHalt(
  admin: SupabaseClient,
  generationId: string,
  halt: GenerationHalted,
  steps: GenStep[],
  currentKey: string | null,
): Promise<void> {
  let extra: Record<string, unknown> | undefined;
  if (halt.mode === "cancel") {
    const { removed, ok } = await removeGenerationArtifacts(admin, generationId);
    if (!ok) {
      console.warn(`[template-engine] partial artefact cleanup incomplete for generation ${generationId}`);
    } else if (removed > 0) {
      console.info(`[template-engine] removed ${removed} partial artefact path(s) for cancelled generation ${generationId}`);
    }
    extra = { zip_path: null };
  }
  await persistHalt(admin, generationId, halt, steps, currentKey, extra);
}

/**
 * The `stale_steps` update to fold into a phase's final write once that phase
 * has re-run successfully — its own output is fresh again, so its mark goes.
 *
 * Deliberately BEST-EFFORT and self-suppressing: it reads the column in its own
 * tiny query and returns `{}` both when nothing would change and when the read
 * fails at all. Two consequences that matter:
 *  - a normal full run (nothing was ever stale) writes no `stale_steps` key, so
 *    the untouched happy path stays byte-for-byte the update it always was;
 *  - on a database where migration 0045 has not been applied yet, the read
 *    errors, `{}` comes back, and the runner never writes a column that does
 *    not exist. Redo is unavailable until the migration lands; generation is
 *    completely unaffected, which is the right way round.
 */
async function staleClearPatch(
  admin: SupabaseClient,
  generationId: string,
  completed: RedoStepKey,
): Promise<Record<string, unknown>> {
  const { data, error } = await admin
    .from("template_generations")
    .select("stale_steps")
    .eq("id", generationId)
    .maybeSingle();
  if (error || !data) return {};
  const current = parseStaleSteps((data as { stale_steps?: unknown }).stale_steps);
  const next = clearStale(current, completed);
  return sameStale(current, next) ? {} : { stale_steps: next };
}

interface GenRow {
  id: string;
  lead_id: string;
  template_id: string;
  requested_pages: unknown;
  options: unknown;
  brief: unknown;
  content_model: unknown;
  steps: unknown;
}

/** What the build phase reloads — the plan phase's frozen outputs. */
interface BuildGenRow {
  id: string;
  template_id: string;
  requested_pages: unknown;
  options: unknown;
  brief: unknown;
  content_model: unknown;
  image_slots: unknown;
  steps: unknown;
  current_step: string | null;
}

interface TemplateRow {
  storage_prefix: unknown;
  demo_tokens: unknown;
  manifest: unknown;
  /** Recurring service/category vocabulary of the template's ORIGINAL demo business — see nicheTerms.ts. */
  niche_terms?: unknown;
}

/** Everything runBuildPipeline needs; each phase builds this differently but the pipeline consumes it identically. */
interface BuildCtx {
  generationId: string;
  brief: GenerationBrief;
  requestedPages: string[];
  template: TemplateRow;
  contentModel: ContentModel;
  imagesForFile: SelectedImage[];
  /** Which personalisation path this generation runs. See RegenMode. */
  regenMode: RegenMode;
  runStart: number;
  progress: { pagesBuilt: number };
  steps: GenStep[];
  beginStep: (key: string, label: string, extra?: Record<string, unknown>) => Promise<void>;
  endStep: (status: "done" | "partial" | "failed", detail?: string, extra?: Record<string, unknown>) => Promise<void>;
  writeThrough: (extra?: Record<string, unknown>) => Promise<void>;
  setCurrentKey: (key: string | null) => void;
  /** Throws GenerationHalted if the operator asked to pause/stop. See checkpoint(). */
  checkpoint: (at: string) => Promise<void>;
  /**
   * The run's stop signal. Handed to every AI call so a Stop aborts the
   * in-flight request instead of being noticed 30-90s later, and re-read
   * synchronously around the storage writes in finalize, which are not
   * abortable but are cheap to stop BETWEEN batches.
   */
  signal: AbortSignal;
  /**
   * Extra fields for the finalize write — currently the `stale_steps` clear for
   * the build step, resolved at the LAST moment so a long build cannot write a
   * stale set it read half an hour ago. Returns `{}` when there is nothing to
   * change, which is the normal case (see staleClearPatch).
   */
  finalizeExtra?: () => Promise<Record<string, unknown>>;
}

/**
 * The shared build half of the pipeline — Phase 1's prepare -> regenerate ->
 * verify -> finalize steps, extracted here so the Phase 2 build phase reuses
 * them verbatim. Downloads the template, neutralizes the demo app identifier,
 * classifies content vs passthrough files, selects which content files this
 * request actually needs, personalises each at bounded concurrency (text-only by
 * default, whole-file rewrite when `options.regen_mode` says so),
 * runs the leak/structure gates with a bounded repair loop, then zips +
 * uploads to `template-sites`. Writes the generation's terminal `review`
 * status itself on success; a failing gate writes `failed` itself too (as
 * Phase 1 did) and then throws so the caller's catch also runs its own
 * failure bookkeeping (queue row, partial pages_built) — every other error
 * just throws and relies entirely on that same caller catch.
 */
async function runBuildPipeline(admin: SupabaseClient, ctx: BuildCtx): Promise<void> {
  const {
    generationId,
    brief,
    requestedPages,
    template,
    contentModel,
    imagesForFile,
    regenMode,
    runStart,
    progress,
    steps,
    beginStep,
    endStep,
    writeThrough,
    setCurrentKey,
    checkpoint,
    signal,
    finalizeExtra,
  } = ctx;

  /** Unwind NOW if the run has been aborted. Sync — no DB round-trip. */
  function haltIfAborted(at: string): void {
    const halt = haltFromSignal(signal, at);
    if (halt) throw halt;
  }

  // CHECKPOINT — before the build phase touches anything at all.
  // SAFE: the row still holds exactly what the plan phase left (brief, content
  // model, image slots); no template has been downloaded, nothing is uploaded.
  // Resuming from here re-enters this function from the top.
  await checkpoint("build start");

  // 4. prepare: download the template + classify content vs passthrough -------
  await beginStep("prepare", "Preparing template", { status: "building" });
  const { textFiles: downloadedTextFiles, binaryFiles } = await downloadTemplate(admin, String(template.storage_prefix));
  if (Object.keys(downloadedTextFiles).length === 0) throw new Error("Template files not found in storage");
  // Deterministically rename the demo app identifier (NorthpointApp/northpointApp
  // -> SiteApp/siteApp) BEFORE anything downstream reads these files. This keeps
  // the structure gate's baseline and the AI's input free of the demo brand from
  // the start, so the "preserve every identifier" and "leak nothing" rules never
  // conflict — see neutralize.ts.
  const { files: textFiles, renames: appRenames } = neutralizeAppIdentifier(downloadedTextFiles);
  const { content, passthrough } = classifyFiles([...Object.keys(textFiles), ...Object.keys(binaryFiles)]);
  const classifiedContentFiles = content.filter((f) => textFiles[f] !== undefined);
  // Build only what the client actually requested (plus shared content JS,
  // which is never itself a requestable "page"). A requested page is ALWAYS
  // built — including area pages for no-areas clients, whose demo geography
  // the deterministic scrub removes — see pageSelect.ts.
  const manifestPages = manifestPagesOf(template.manifest);
  const sel = selectContentFiles({
    contentFiles: classifiedContentFiles,
    manifestPages,
    requestedPages,
  });
  const contentFiles = sel.build;
  const contentSources: Record<string, string> = {};
  for (const f of contentFiles) contentSources[f] = textFiles[f];
  // Never a silent drop: what was skipped and why lands in this step's
  // persisted detail, so the BuildTracker timeline shows it to the operator.
  const droppedDetail = sel.dropped.length
    ? `; skipped: ${sel.dropped.map((d) => `${d.file} (${d.reason})`).join(", ")}`
    : "";
  const renameDetail = appRenames.length
    ? `, neutralized ${appRenames.map((r) => `${r.from}->${r.to}`).join(", ")}`
    : "";
  await endStep(
    "done",
    `${contentFiles.length} content file(s), ${passthrough.length} passthrough${droppedDetail}${renameDetail}`,
  );

  const demoTokens = stringArray(template.demo_tokens);
  const nicheTerms = stringArray(template.niche_terms);

  // CHECKPOINT — between `prepare` and the (long, expensive) regeneration loop.
  // SAFE: `prepare` only downloaded and classified files into memory. It wrote
  // no storage object and changed no generation field beyond its own step entry,
  // which is already marked `done`.
  await checkpoint("prepare");

  // 5. personalise every content file (concurrency-capped) --------------------
  // By default that is the TEXT-ONLY path (personalize.ts): the model sees the
  // page's strings, never its markup. `options.regen_mode: "whole_file"` puts
  // the original whole-file rewrite back in its place — see buildOneFile.
  // Pre-register one step per file so concurrent workers each update only their
  // own step by key — the shared "last step" endStep pattern is not safe here.
  for (const file of contentFiles) {
    steps.push({ key: `build:${file}`, label: `Building ${file}`, status: "running", started_at: new Date().toISOString() });
  }
  setCurrentKey("build");
  await writeThrough();

  const rebuilt: Record<string, string> = {};
  await runWithConcurrency(contentFiles, REGEN_CONCURRENCY, async (file) => {
    // CHECKPOINT — before each individual file's regeneration. This is the one
    // that makes Pause feel responsive: the build loop is minutes of AI calls,
    // so a pause that only landed between pipeline steps would look broken.
    // SAFE: it sits OUTSIDE the try/catch below, so a halt is never mistaken
    // for a regeneration failure and never marks this file's step `failed`.
    // Nothing is written to storage during regeneration — the outputs live in
    // `rebuilt` (memory) until finalize — so abandoning here loses only work,
    // never consistency. The in-flight calls are ABORTED by the shared signal
    // (they no longer run to completion), so no file is left half-regenerated
    // and nothing keeps running after the operator's click.
    await checkpoint(`build ${file}`);
    const step = steps.find((s) => s.key === `build:${file}`)!;
    const t0 = Date.now();
    try {
      rebuilt[file] = await buildOneFile({
        regenMode,
        file,
        source: contentSources[file],
        contentModel,
        imagesForFile,
        demoTokens,
        signal,
      });
      progress.pagesBuilt++;
      step.status = "done";
      step.ms = Date.now() - t0;
      setCurrentKey(file);
      await writeThrough();
    } catch (e) {
      // An aborted call is a stop, not a failed file. Marking the step `failed`
      // here would put a red cross on the timeline of a run the operator paused
      // — persistHalt rolls this still-`running` step back to `pending` instead.
      haltIfAborted(`build ${file}`);
      const msg = e instanceof Error ? e.message : String(e);
      step.status = "failed";
      step.ms = Date.now() - t0;
      step.detail = msg.slice(0, 300);
      await writeThrough();
      throw new Error(`Regeneration failed for ${file}: ${msg}`); // never ship the source
    }
  });

  // 6. verify: leak + structure gates, with a bounded repair loop -------------
  // Up to MAX_REPAIR_ROUNDS rounds; each regenerates ONLY the offending files
  // (concurrently — verification is already the slow leg and rounds multiply
  // it) and re-runs the gates. A round that changes nothing the gates care
  // about breaks out immediately: the condition is not AI-fixable and further
  // rounds only cost money. The step's label carries the round so the operator
  // sees work happening instead of a stalled "Verifying".
  await beginStep("verify", "Verifying");
  const verifyStep = steps[steps.length - 1];
  // The terminal leak guarantee runs immediately before EVERY gate invocation.
  // It uses findLeaks itself as its oracle (see leakGuarantee.ts), so after it
  // the leak gate can only fail if the guarantee itself is broken — the repair
  // loop below is, for leaks, effectively dead code; it remains for structure.
  // Idempotent and cheap (one findLeaks scan when the files are clean), so it
  // runs unconditionally. Anything it fixed is surfaced on the verify step.
  const guaranteeNotes: string[] = [];

  // The category-drift guarantee runs FIRST, before the leak guarantee and
  // before the gate: a niche term is not identity (the leak gate/findLeaks
  // correctly never sees it — see nicheGuarantee.ts), so nothing else in this
  // pipeline would ever catch a page that reads like the TEMPLATE's trade
  // instead of the CLIENT's. Two bounded stages, same discipline as the
  // leak/structure repair loop below:
  //   1. up to MAX_REPAIR_ROUNDS AI repair rounds, each re-personalizing ONLY
  //      the offending files with a targeted note (repairNoteForNiche) naming
  //      the wrong-category terms and the client's real services;
  //   2. a deterministic terminal scrub (guaranteeNoNicheDrift) that
  //      neutralizes whatever survives, so packaging never ships a term the
  //      client cannot claim as their own — a guarantee, not a hope.
  if (nicheTerms.length > 0) {
    let nicheHits = findNicheDrift({ files: rebuilt, nicheTerms, contentModel, brief });
    let nicheRounds = 0;
    while (nicheHits.length > 0 && nicheRounds < MAX_REPAIR_ROUNDS) {
      const targets = [...new Set(nicheHits.map((h) => h.file))].filter((f) => contentSources[f] !== undefined);
      if (targets.length === 0) break;
      // CHECKPOINT — between category-drift repair rounds, same rationale as
      // the leak/structure repair loop's checkpoint below: each round is
      // another full AI call per offending file.
      await checkpoint(`niche repair round ${nicheRounds + 1}`);
      nicheRounds++;
      verifyStep.label = `Fixing category drift (round ${nicheRounds} of ${MAX_REPAIR_ROUNDS})`;
      await writeThrough();

      const hitsByFile = new Map<string, NicheDriftHit[]>();
      for (const h of nicheHits) {
        const cur = hitsByFile.get(h.file);
        if (cur) cur.push(h);
        else hitsByFile.set(h.file, [h]);
      }
      const settled = await Promise.allSettled(
        targets.map((file) =>
          buildOneFile({
            regenMode,
            file,
            source: contentSources[file],
            contentModel,
            imagesForFile,
            demoTokens,
            repairNote: repairNoteForNiche(hitsByFile.get(file) ?? [], contentModel),
            signal,
          }),
        ),
      );
      settled.forEach((r, i) => {
        if (r.status === "fulfilled") rebuilt[targets[i]] = r.value;
      });
      // allSettled swallows rejections, including aborts — unwind here rather
      // than looping again on a stopped run.
      haltIfAborted(`niche repair round ${nicheRounds}`);

      const next = findNicheDrift({ files: rebuilt, nicheTerms, contentModel, brief });
      const stalled = next.length > 0 && nicheDriftFingerprint(nicheHits) === nicheDriftFingerprint(next);
      nicheHits = next;
      if (stalled) break; // the model cannot resolve this — stop burning AI calls, let the terminal scrub finish it
    }
    verifyStep.label = "Verifying";

    const { files: scrubbedFiles, report: nicheReport } = guaranteeNoNicheDrift({
      files: rebuilt,
      nicheTerms,
      contentModel,
      brief,
    });
    for (const [file, text] of Object.entries(scrubbedFiles)) rebuilt[file] = text;
    const nicheNote = describeNicheGuarantee(nicheReport);
    if (nicheNote) {
      guaranteeNotes.push(nicheNote);
      console.info(`[template-engine] ${nicheNote}`);
    }
  }

  const applyLeakGuarantee = () => {
    const g = guaranteeNoLeaks({ files: rebuilt, demoTokens, contentModel });
    for (const [file, text] of Object.entries(g.files)) rebuilt[file] = text;
    const note = describeLeakGuarantee(g.report);
    if (note) {
      guaranteeNotes.push(note);
      console.info(`[template-engine] ${note}`);
    }
  };
  applyLeakGuarantee();
  let gate = runGates({ template: contentSources, output: rebuilt, demoTokens });
  let rounds = 0;
  let stalled = false;
  while (!gate.ok && rounds < MAX_REPAIR_ROUNDS) {
    const targets = offenderFiles(gate).filter((f) => contentSources[f] !== undefined);
    if (targets.length === 0) break; // nothing regenerable — repairing cannot help
    // CHECKPOINT — between repair rounds. Each round is another full AI call per
    // offending file, so this is the second-longest stretch after the build loop.
    // SAFE: the gate verdict for the round that just finished has been written
    // through, `rebuilt` is only in memory, and nothing is packaged yet.
    await checkpoint(`repair round ${rounds + 1}`);
    rounds++;
    verifyStep.label = `Repairing (round ${rounds} of ${MAX_REPAIR_ROUNDS})`;
    verifyStep.detail = describeGateFailure(gate);
    await writeThrough();

    const notes = targets.map((file) => repairNoteFor(file, gate));
    const settled = await Promise.allSettled(
      // The repair re-runs the SAME path the build used, with the gate's
      // findings attached — under "text" that means the offending strings are
      // re-extracted and re-sent, so the model is fixing exact strings rather
      // than being asked to reproduce a whole file a second time.
      targets.map((file, i) =>
        buildOneFile({
          regenMode,
          file,
          source: contentSources[file],
          contentModel,
          imagesForFile,
          demoTokens,
          repairNote: notes[i],
          signal,
        }),
      ),
    );
    // A failed repair keeps the prior output; the re-run gate still reports it.
    settled.forEach((r, i) => {
      if (r.status === "fulfilled") rebuilt[targets[i]] = r.value;
    });
    // allSettled swallows rejections, including the aborts. Unwind here rather
    // than re-running the gates and starting another round on a stopped run.
    haltIfAborted(`repair round ${rounds}`);

    applyLeakGuarantee();
    const next = runGates({ template: contentSources, output: rebuilt, demoTokens });
    stalled = repairStalled(gate, next);
    gate = next;
    if (stalled) break;
  }
  verifyStep.label = "Verifying";
  verifyStep.detail = undefined;
  await writeThrough({ gate_results: gate });
  if (!gate.ok) {
    const detail = describeGateFailure(gate, { rounds, stalled });
    await endStep("failed", detail, { status: "failed", error: `Verification gate failed: ${detail}` });
    throw new Error(`Verification gate failed: ${detail}`);
  }
  const passed = rounds ? `leak + structure gates passed after ${rounds} repair round(s)` : "leak + structure gates passed";
  await endStep("done", guaranteeNotes.length ? `${passed}; ${guaranteeNotes.join("; ")}` : passed);

  // CHECKPOINT — after the gates passed, before packaging begins. This is the
  // LAST safe point: everything past it writes to the `template-sites` bucket
  // (a zip plus one object per file), and a halt part-way through that upload
  // would leave a generation pointing at an incomplete site. So finalize runs
  // to completion once entered, and a pause requested during it takes effect
  // only if a later run reaches a checkpoint again.
  // SAFE HERE: no storage object has been written yet for this attempt.
  //
  // Finalize is no longer "runs to completion once entered": a stop is honoured
  // between the zip and the explode and between explode batches, because an
  // immediate stop is worth more than a tidy exit. What makes that safe is
  // landHalt — a cancel deletes whatever this leg wrote and nulls `zip_path`,
  // and a pause re-runs the whole build (which upserts over the leftovers).
  await checkpoint("verify");

  // 7. finalize: package the zip + explode to template-sites (as v1) ----------
  await beginStep("finalize", "Packaging site");
  const finalText: Record<string, string> = {};
  for (const f of contentFiles) finalText[f] = rebuilt[f] ?? contentSources[f];
  // Passthrough text ships byte-for-byte — this is the deterministic, non-AI
  // half of the pipeline. style.css is included here unchanged, which is what
  // keeps the design identical. (A template whose CSS carried url() image refs
  // would get a deterministic rewrite here; this one has none, so it is a no-op.)
  //
  // POST-GATE POST-PROCESSING (theme -> logo -> nav prune -> integrity).
  // Order matters, and so does the fact that all of it runs HERE rather than
  // inside regeneration. The gates have just proven the model preserved the
  // template's structure, so from this point the markup is ours to transform:
  // that is what makes it safe for the logo pass to ADD an <img> and for the
  // nav pass to REMOVE a menu item — tag-count changes that the structure gate
  // would (correctly) reject if they happened before it ran. Each step is a
  // pure (input) -> (output) function unit-tested against fixture templates
  // that look nothing like the one this engine shipped with.
  //
  // 7a. theme: apply the client's colors to each stylesheet. Binds onto the
  //     template's OWN color custom properties when it has them, remaps its
  //     dominant hex values when it does not, and always keeps emitting the
  //     legacy --brand/--brand-deep/--accent override. See themeCss.ts.
  for (const f of passthrough) {
    if (textFiles[f] === undefined) continue;
    finalText[f] = f.toLowerCase().endsWith(".css")
      ? applyThemeToCss(textFiles[f], contentModel.theme)
      : textFiles[f];
  }

  // 7b. logo + 7c. nav prune, on every HTML page in the final site.
  const builtPages = Object.keys(finalText).filter((f) => /\.html?$/i.test(f));
  const logoUrl = contentModel.identity?.logo_url ?? "";
  const navRemoved = new Set<string>();
  const navKept: string[] = [];
  let logoPages = 0;
  for (const f of builtPages) {
    // Logo: if the lead has one, the header AND footer show it — inserting an
    // <img> when the template has no logo slot at all (logo.ts).
    const withLogo = applyLogoToHtml(finalText[f], {
      logoUrl,
      businessName: contentModel.identity?.name ?? "",
    });
    if (withLogo.header || withLogo.footer) logoPages++;
    // Nav: drop menu items pointing at pages this build did not produce, so the
    // menu can never link to a 404 (nav.ts).
    const pruned = pruneNavToBuiltPages(withLogo.html, builtPages);
    for (const t of pruned.removed) navRemoved.add(t);
    navKept.push(...pruned.keptEmptyGuard);
    finalText[f] = pruned.html;
  }
  if (navKept.length > 0) {
    console.warn(
      `[template-engine] generation ${generationId}: kept stale menu link(s) rather than empty a menu: ${navKept.join(" | ")}`,
    );
  }
  if (navRemoved.size > 0 || logoPages > 0) {
    console.info(
      `[template-engine] generation ${generationId}: post-process — logo on ${logoPages} page(s), pruned menu link(s): ${[...navRemoved].join(", ") || "none"}`,
    );
  }

  // 7d. integrity: the unconditional guarantee that no internal link can 404.
  // The nav prune above only sees statically-rendered menus; this template
  // renders its header from components.js, so a JS-held "service-areas.html"
  // entry sails straight past it. Scan every HTML href/src and JS string
  // literal in the FINAL file set and emit a redirect stub (to index.html) for
  // any referenced page that was not built — however a template renders its
  // nav, a click lands on a real page, never a 404. Idempotent (integrity.ts).
  const integrity = ensureSiteIntegrity({
    textFiles: finalText,
    allPaths: [...Object.keys(finalText), ...Object.keys(binaryFiles)],
    businessName: contentModel.identity?.name ?? "",
  });
  for (const [path, stubHtml] of Object.entries(integrity.added)) finalText[path] = stubHtml;
  const stubDetail = integrity.report.stubs.length
    ? `; ${integrity.report.stubs.length} redirect stub(s) for dangling link(s): ${integrity.report.stubs
        .map((s) => `${s} (referenced by ${integrity.report.referencedBy[s].join(", ")})`)
        .join("; ")}`
    : "";
  if (stubDetail) {
    console.info(`[template-engine] generation ${generationId}: integrity — ${stubDetail.slice(2)}`);
  }

  const encoder = new TextEncoder();
  const siteMap: Record<string, Uint8Array> = {};
  for (const [path, content_] of Object.entries(finalText)) siteMap[path] = encoder.encode(content_);
  for (const [path, bytes] of Object.entries(binaryFiles)) siteMap[path] = bytes;

  haltIfAborted("finalize");
  const zipBytes = zipFromMap(siteMap);
  const zipPath = `${generationId}/site.zip`;
  const zipUp = await admin.storage
    .from(SITES_BUCKET)
    .upload(zipPath, zipBytes, { contentType: "application/zip", upsert: true });
  if (zipUp.error) throw new Error(`Failed to upload site zip: ${zipUp.error.message}`);

  const siteEntries = Object.entries(siteMap);
  for (let i = 0; i < siteEntries.length; i += UPLOAD_BATCH) {
    haltIfAborted("finalize");
    await Promise.all(
      siteEntries.slice(i, i + UPLOAD_BATCH).map(async ([path, bytes]) => {
        const { error } = await admin.storage
          .from(SITES_BUCKET)
          .upload(`${generationId}/site/${path}`, bytes, { contentType: contentTypeFor(path), upsert: true });
        if (error) throw new Error(`Failed to upload site file ${path}: ${error.message}`);
      }),
    );
  }

  setCurrentKey(null);
  const staleCleared = finalizeExtra ? await finalizeExtra() : {};
  await endStep("done", `${siteEntries.length} files packaged${stubDetail}`, {
    status: "review",
    zip_path: zipPath,
    pages_built: progress.pagesBuilt,
    images_used: imagesForFile.length,
    // Phase 1 does not meter tokens (planContent/regenerateFile don't surface
    // counts); wire real accounting when their return shapes carry usage.
    tokens_used: 0,
    cost_usd: 0,
    total_ms: Date.now() - runStart,
    error: null,
    ...staleCleared,
  });
}

/**
 * Which half (or halves) of the plan phase to execute.
 *
 *  - "full"    — the normal run: brief -> plan -> images -> curating. The ONLY
 *                phase that freezes a fresh brief and mints a `site_slug`, and
 *                the only one that starts the step timeline from empty. Its
 *                behaviour is unchanged from before per-step redo existed.
 *  - "content" — re-plan the content model ONLY. `image_slots` are not read and
 *                not written; the built site is left alone. (Redo content.)
 *  - "images"  — re-gather image candidates ONLY, from the content model
 *                already on the row. `content_model` is not touched, so the
 *                operator's content edits survive. (Redo images.)
 *
 * Both single-step phases CONTINUE the existing step timeline with only their
 * own entries reset, and neither rewrites `site_slug` — a redo must never
 * change the address a site is going to deploy to.
 */
export type PlanPhase = "full" | "content" | "images";

/**
 * PLAN phase of a v2 template generation (Phase 2): freeze the brief, plan the
 * content model (Gemini Pro), gather + vision-rank image candidates into
 * per-slot `image_slots`, then STOP at status='curating' for the operator to
 * pick images — it never prepares/regenerates/verifies/finalizes a site
 * itself (see buildFromSelection for that half). Terminal status on any error
 * is `failed`. Step progress is written through to
 * `template_generations.steps`/`current_step` for the realtime tracker.
 *
 * `phase` narrows the run to a single step for per-step redo (see PlanPhase).
 * It defaults to "full", and every branch it adds is skipped on that default,
 * so the normal generation path executes exactly the statements it always did,
 * in the same order, with the same checkpoints.
 */
export async function runTemplateGenerationV2(generationId: string, phase: PlanPhase = "full"): Promise<void> {
  const admin = createAdminClient();
  const runStart = Date.now();
  const full = phase === "full";

  // Stop plumbing. The controller is what every AI call in this phase hangs
  // off; the registry lets /pause and /cancel abort it in this process
  // instantly, and the watcher covers the case where they cannot (see
  // abortRegistry.ts). Both are released in the `finally` at the bottom.
  const controller = registerGeneration(generationId);
  const { signal } = controller;
  const stopWatching = startControlWatcher(
    admin,
    generationId,
    (mode) => {
      if (!signal.aborted) controller.abort(new GenerationAbortReason(mode));
    },
    undefined,
    // Stamp `heartbeat_at` on this same timer. It is the ONLY writer of that
    // column, which is what makes it a trustworthy liveness signal: if this
    // process dies, the stamps stop, and /pause, /cancel, the processor and the
    // wizard can all tell that the run they see is a ghost (see liveness.ts).
    { heartbeat: true },
  );

  let steps: GenStep[] = [];
  let currentKey: string | null = null;
  let stepStart = 0;

  async function writeThrough(extra?: Record<string, unknown>): Promise<void> {
    await admin
      .from("template_generations")
      .update({ steps, current_step: currentKey, updated_at: new Date().toISOString(), ...(extra ?? {}) })
      .eq("id", generationId);
  }
  async function beginStep(key: string, label: string, extra?: Record<string, unknown>): Promise<void> {
    steps.push({ key, label, status: "running", started_at: new Date().toISOString() });
    currentKey = key;
    stepStart = Date.now();
    await writeThrough(extra);
  }
  async function endStep(
    status: "done" | "partial" | "failed",
    detail?: string,
    extra?: Record<string, unknown>,
  ): Promise<void> {
    const step = steps[steps.length - 1];
    step.status = status;
    step.ms = Date.now() - stepStart;
    if (detail) step.detail = detail;
    await writeThrough(extra);
  }
  /**
   * Unwind out of the phase if the operator asked to stop. Checks the abort
   * signal first (free, and already true whenever the registry or the watcher
   * fired), then falls back to the DB read that has always been here — a third
   * safety net that catches a halt landing between two operations.
   */
  async function checkpoint(at: string): Promise<void> {
    const aborted = haltFromSignal(signal, at);
    if (aborted) throw aborted;
    const decision = await readControl(admin, generationId);
    if (decision !== "continue") throw new GenerationHalted(decision, at);
  }

  try {
    // 1. load generation + lead + template; freeze the brief --------------------
    const { data: genRow, error: genErr } = await admin
      .from("template_generations")
      .select("id, lead_id, template_id, requested_pages, options, brief, content_model, steps")
      .eq("id", generationId)
      .single();
    if (genErr || !genRow) throw new Error(`Generation ${generationId} not found`);
    const gen = genRow as GenRow;

    // A single-step redo continues the run's existing timeline; only the entries
    // belonging to the step being redone are cleared, so the steps it is
    // deliberately leaving alone keep their history.
    if (!full) steps = resetStepsForRedo(genStepArray(gen.steps), phase);

    const { data: lead } = await admin.from("leads").select("*").eq("id", gen.lead_id).single();
    if (!lead) throw new Error("Lead not found");
    // Fail fast if the template is gone, before spending a Gemini planning call
    // and the operator's curation time on a generation that can never build.
    const { data: template } = await admin
      .from("website_templates")
      .select("id, name, storage_prefix, demo_tokens, manifest")
      .eq("id", gen.template_id)
      .single();
    if (!template) throw new Error("Template not found");

    // A full run freezes a fresh brief and mints the site slug. A redo reuses
    // the brief the run was already frozen against (falling back to a fresh
    // derivation only if the row somehow has none) and never re-mints the slug:
    // `websiteId()` is random, so re-minting would silently move where the site
    // deploys to, which is not something "redo the copy" should ever do.
    let brief: GenerationBrief;
    if (full) {
      brief = buildBrief(lead as Parameters<typeof buildBrief>[0]);
      const siteSlug = `${businessSlug(brief.business_name)}-${websiteId()}`;
      await writeThrough({ brief, site_slug: siteSlug });
    } else {
      brief = (gen.brief as GenerationBrief | null) ?? buildBrief(lead as Parameters<typeof buildBrief>[0]);
    }
    const requestedPages = stringArray(gen.requested_pages);

    // CHECKPOINT — before the first paid AI call.
    // SAFE: only the frozen brief and the site slug have been written, and both
    // are deterministic re-derivations of data that already existed. A pause
    // caught here has cost nothing; a re-run recomputes them identically.
    // This is also the checkpoint that catches a run paused while still
    // `queued`, since the flag is set before the processor ever claims it.
    await checkpoint("brief");

    // 2. plan the content model (Gemini Pro) ------------------------------------
    // Skipped by the "images" redo, which reuses the content model already on
    // the row — that is the whole point of a surgical image redo.
    let contentModel: ContentModel | null = full || phase === "content" ? null : (gen.content_model as ContentModel | null);
    if (phase !== "images") {
      await beginStep("plan", "Planning content", { status: "planning" });
      const { model: planned } = await planContent(brief, requestedPages, { signal });
      // Inject the lead's verbatim assets deterministically — a map <iframe>, a
      // logo URL and a profile link must never be routed through the model, which
      // could mangle them. The regenerator wires these into the template's slots.
      contentModel = {
        ...planned,
        identity: {
          ...planned.identity,
          logo_url: brief.logo_link ?? "",
          map_embed: brief.map_embed ?? "",
          profile_link: brief.profile_link ?? "",
        },
      };
      await endStep(
        "done",
        `${contentModel.services.length} services, ${contentModel.image_briefs.length} image briefs`,
        { content_model: contentModel },
      );

      // CHECKPOINT — between `plan` and `images`.
      // SAFE: the content model is fully written and its step is `done`; image
      // gathering has not started, so no `image_slots` are half-populated.
      await checkpoint("plan");
    }

    // 3. gather + vision-rank image candidates into slots (Phase 2 curation) ----
    // Skipped by the "content" redo: re-gathering would throw away the
    // operator's picks, which a copy rewrite has no business doing. The images
    // are marked STALE by the redo route instead.
    if (phase !== "content") {
      if (!contentModel) {
        throw new Error("Generation has no content model — the content step must run before images can be gathered");
      }
      await beginStep("images", "Gathering + ranking images");
      const excludePeople = excludePeopleOf(gen.options);
      const imageSlots = await buildInitialSlots(contentModel.image_briefs, { brief, admin, excludePeople, signal });
      const candidateCount = imageSlots.reduce((n, s) => n + s.candidates.length, 0);
      await endStep(
        imageSlots.length ? "done" : "partial",
        `${imageSlots.length} slot(s), ${candidateCount} candidate(s) gathered`,
        { image_slots: imageSlots },
      );

      // CHECKPOINT — between `images` and the hand-off to the operator.
      // SAFE: `image_slots` is written in full and its step is closed; the only
      // thing left is flipping the status to `curating`. Resuming from here lands
      // on `curating` directly (see resumeTarget) — no AI work is repeated.
      await checkpoint("images");
    }

    // 4. pause here for the operator to curate images (Phase 2) -----------------
    // A redo lands here too: whichever single step re-ran, the run comes back to
    // rest at `curating`, which is where the operator reviews it and rebuilds.
    const staleCleared = full ? {} : await staleClearPatch(admin, generationId, phase);
    await beginStep("curate", "Awaiting image curation");
    currentKey = null;
    await endStep("done", "ready for operator review", { status: "curating", error: null, ...staleCleared });
  } catch (e) {
    // A pause/stop is not a failure: bring the run to rest and return cleanly so
    // the caller marks the queue row done rather than failed. An abort arrives
    // here as whatever the aborted call threw, so the signal — not the error
    // type — is the authority on whether this was a stop.
    const halt = e instanceof GenerationHalted ? e : haltFromSignal(signal, currentKey ?? "the current step");
    if (halt) {
      await landHalt(admin, generationId, halt, steps, currentKey);
      return;
    }
    const msg = e instanceof Error ? e.message : String(e);
    const last = steps[steps.length - 1];
    if (last && last.status === "running") {
      last.status = "failed";
      last.ms = Date.now() - stepStart;
      last.detail = msg.slice(0, 300);
    }
    try {
      await admin
        .from("template_generations")
        .update({
          steps,
          current_step: currentKey,
          status: "failed",
          error: msg.slice(0, 800),
          total_ms: Date.now() - runStart,
          updated_at: new Date().toISOString(),
        })
        .eq("id", generationId);
      await admin
        .from("template_gen_queue")
        .update({ status: "failed", error: msg.slice(0, 500), finished_at: new Date().toISOString() })
        .eq("generation_id", generationId)
        .eq("status", "processing");
    } catch {
      // failure bookkeeping is best-effort
    }
    throw e;
  } finally {
    // Non-negotiable: a leaked interval polls a finished generation forever and
    // a leaked registry entry lets a later Stop abort a controller nobody owns.
    stopWatching();
    unregisterGeneration(generationId, controller);
  }
}

/**
 * BUILD phase of a v2 template generation (Phase 2): runs once the operator
 * has picked images for every slot. Loads the frozen `brief`, `content_model`
 * and `image_slots` the plan phase wrote, resolves the SELECTED image urls,
 * and runs Phase 1's prepare -> regenerate -> verify -> finalize pipeline via
 * the shared runBuildPipeline() helper. Terminal status is `review` on
 * success or `failed` on any error (a failing gate included) — it never
 * reaches `review` with a leak. Continues the SAME generation row's step
 * history the plan phase started (rather than resetting it), so the realtime
 * tracker shows one continuous plan -> images -> curate -> prepare -> build ->
 * verify -> finalize timeline.
 */
export async function buildFromSelection(generationId: string): Promise<void> {
  const admin = createAdminClient();
  const runStart = Date.now();

  // Same stop plumbing as the plan phase — see the comment there. This is the
  // phase where it matters most: the build loop is minutes of whole-file AI
  // calls, which is exactly the window an operator used to wait out.
  const controller = registerGeneration(generationId);
  const { signal } = controller;
  const stopWatching = startControlWatcher(
    admin,
    generationId,
    (mode) => {
      if (!signal.aborted) controller.abort(new GenerationAbortReason(mode));
    },
    undefined,
    // Stamp `heartbeat_at` on this same timer. It is the ONLY writer of that
    // column, which is what makes it a trustworthy liveness signal: if this
    // process dies, the stamps stop, and /pause, /cancel, the processor and the
    // wizard can all tell that the run they see is a ghost (see liveness.ts).
    { heartbeat: true },
  );

  let steps: GenStep[] = [];
  let currentKey: string | null = null;
  let stepStart = 0;
  const progress = { pagesBuilt: 0 };
  let imagesUsed = 0;

  async function writeThrough(extra?: Record<string, unknown>): Promise<void> {
    await admin
      .from("template_generations")
      .update({ steps, current_step: currentKey, updated_at: new Date().toISOString(), ...(extra ?? {}) })
      .eq("id", generationId);
  }
  async function beginStep(key: string, label: string, extra?: Record<string, unknown>): Promise<void> {
    steps.push({ key, label, status: "running", started_at: new Date().toISOString() });
    currentKey = key;
    stepStart = Date.now();
    await writeThrough(extra);
  }
  async function endStep(
    status: "done" | "partial" | "failed",
    detail?: string,
    extra?: Record<string, unknown>,
  ): Promise<void> {
    const step = steps[steps.length - 1];
    step.status = status;
    step.ms = Date.now() - stepStart;
    if (detail) step.detail = detail;
    await writeThrough(extra);
  }
  /** Abort signal first, then the DB flag — see the plan phase's checkpoint(). */
  async function checkpoint(at: string): Promise<void> {
    const aborted = haltFromSignal(signal, at);
    if (aborted) throw aborted;
    const decision = await readControl(admin, generationId);
    if (decision !== "continue") throw new GenerationHalted(decision, at);
  }

  try {
    // Load the generation — has the frozen brief/content_model/image_slots the
    // plan phase wrote — plus the template. Continue the SAME step history the
    // plan phase started rather than resetting it.
    const { data: genRow, error: genErr } = await admin
      .from("template_generations")
      .select("id, template_id, requested_pages, options, brief, content_model, image_slots, steps, current_step")
      .eq("id", generationId)
      .single();
    if (genErr || !genRow) throw new Error(`Generation ${generationId} not found`);
    const gen = genRow as BuildGenRow;
    if (!gen.brief) throw new Error("Generation has no frozen brief — the plan phase must complete before building");
    if (!gen.content_model) {
      throw new Error("Generation has no content model — the plan phase must complete before building");
    }
    // Prune any prior build/deploy-phase steps before continuing the timeline —
    // this run may be a rebuild after Reopen (review -> curating -> build again).
    steps = pruneBuildPhaseSteps(genStepArray(gen.steps));
    currentKey = gen.current_step ?? null;

    const { data: template } = await admin
      .from("website_templates")
      .select("id, name, storage_prefix, demo_tokens, manifest, niche_terms")
      .eq("id", gen.template_id)
      .single();
    if (!template) throw new Error("Template not found");

    const brief = gen.brief as GenerationBrief;
    const contentModel = gen.content_model as ContentModel;
    const requestedPages = stringArray(gen.requested_pages);
    const imagesForFile = imagesForFileFrom(imageSlotsOf(gen.image_slots));
    imagesUsed = imagesForFile.length;

    await runBuildPipeline(admin, {
      generationId,
      brief,
      requestedPages,
      template: {
        storage_prefix: template.storage_prefix,
        demo_tokens: template.demo_tokens,
        manifest: template.manifest,
        niche_terms: (template as { niche_terms?: unknown }).niche_terms,
      },
      contentModel,
      imagesForFile,
      regenMode: regenModeOf(gen.options),
      runStart,
      progress,
      steps,
      beginStep,
      endStep,
      writeThrough,
      setCurrentKey: (key) => {
        currentKey = key;
      },
      checkpoint,
      signal,
      // A finished build is, by definition, no longer out of date.
      finalizeExtra: () => staleClearPatch(admin, generationId, "build"),
    });
  } catch (e) {
    // A pause/stop is not a failure — same clean landing as the plan phase.
    // Note pages_built is deliberately NOT written: a halted build ships no
    // pages, and /resume re-runs the build phase from `prepare`.
    const halt = e instanceof GenerationHalted ? e : haltFromSignal(signal, currentKey ?? "the current step");
    if (halt) {
      await landHalt(admin, generationId, halt, steps, currentKey);
      return;
    }
    const msg = e instanceof Error ? e.message : String(e);
    const last = steps[steps.length - 1];
    if (last && last.status === "running") {
      last.status = "failed";
      last.ms = Date.now() - stepStart;
      last.detail = msg.slice(0, 300);
    }
    try {
      await admin
        .from("template_generations")
        .update({
          steps,
          current_step: currentKey,
          status: "failed",
          error: msg.slice(0, 800),
          pages_built: progress.pagesBuilt,
          images_used: imagesUsed,
          total_ms: Date.now() - runStart,
          updated_at: new Date().toISOString(),
        })
        .eq("id", generationId);
      await admin
        .from("template_gen_queue")
        .update({ status: "failed", error: msg.slice(0, 500), finished_at: new Date().toISOString() })
        .eq("generation_id", generationId)
        .eq("status", "processing");
    } catch {
      // failure bookkeeping is best-effort
    }
    throw e;
  } finally {
    stopWatching();
    unregisterGeneration(generationId, controller);
  }
}
