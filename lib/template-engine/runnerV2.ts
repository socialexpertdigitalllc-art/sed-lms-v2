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
import { classifyFiles } from "./classify";
import { selectContentFiles, type ManifestPage } from "./pageSelect";
import { neutralizeAppIdentifier } from "./neutralize";
import { regenerateFile } from "./regenerate";
import { runGates, type GateResult } from "./gates";
import { zipFromMap } from "./zip";
import { buildInitialSlots } from "./gatherImages";
import type { ImageSlot } from "./imageSlots";
import { businessSlug, websiteId } from "./slug";
import { contentTypeFor, listStorageFiles } from "./runner";
import type { GenStep } from "./types";

const TEMPLATES_BUCKET = "website-templates";
const SITES_BUCKET = "template-sites";
const TEXT_FILE_RE = /\.(html?|css|js|mjs)$/i;
const UPLOAD_BATCH = 8;
const REGEN_CONCURRENCY = 3; // keep wall-clock sane without hammering the provider

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
  source: "pexels" | "custom" | "client";
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

/** One-line human summary of a failing gate, for the generation's `error`. */
function describeGateFailure(gate: GateResult): string {
  const parts: string[] = [];
  if (gate.leaks.length) parts.push("leaks — " + [...new Set(gate.leaks.map((l) => `${l.file}:${l.token}`))].join("; "));
  const badStruct = gate.structure.filter((s) => !s.ok);
  if (badStruct.length) parts.push("structure — " + badStruct.map((s) => `${s.file}: ${s.detail ?? "changed"}`).join("; "));
  return parts.join(" | ") || "unknown gate failure";
}

interface GenRow {
  id: string;
  lead_id: string;
  template_id: string;
  requested_pages: unknown;
  options: unknown;
}

/** What the build phase reloads — the plan phase's frozen outputs. */
interface BuildGenRow {
  id: string;
  template_id: string;
  requested_pages: unknown;
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
}

/** Everything runBuildPipeline needs; each phase builds this differently but the pipeline consumes it identically. */
interface BuildCtx {
  generationId: string;
  brief: GenerationBrief;
  requestedPages: string[];
  template: TemplateRow;
  contentModel: ContentModel;
  imagesForFile: SelectedImage[];
  runStart: number;
  progress: { pagesBuilt: number };
  steps: GenStep[];
  beginStep: (key: string, label: string, extra?: Record<string, unknown>) => Promise<void>;
  endStep: (status: "done" | "partial" | "failed", detail?: string, extra?: Record<string, unknown>) => Promise<void>;
  writeThrough: (extra?: Record<string, unknown>) => Promise<void>;
  setCurrentKey: (key: string | null) => void;
}

/**
 * The shared build half of the pipeline — Phase 1's prepare -> regenerate ->
 * verify -> finalize steps, extracted here so the Phase 2 build phase reuses
 * them verbatim. Downloads the template, neutralizes the demo app identifier,
 * classifies content vs passthrough files, selects which content files this
 * request actually needs, whole-file regenerates each at bounded concurrency,
 * runs the leak/structure gates with one targeted repair pass, then zips +
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
    runStart,
    progress,
    steps,
    beginStep,
    endStep,
    writeThrough,
    setCurrentKey,
  } = ctx;

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
  // which is never itself a requestable "page"), and never an area page for a
  // client with no service areas to de-leak it with — see pageSelect.ts.
  const manifestPages = manifestPagesOf(template.manifest);
  const hasServiceAreas = brief.service_areas.length > 0;
  const sel = selectContentFiles({
    contentFiles: classifiedContentFiles,
    manifestPages,
    requestedPages,
    hasServiceAreas,
  });
  const contentFiles = sel.build;
  const contentSources: Record<string, string> = {};
  for (const f of contentFiles) contentSources[f] = textFiles[f];
  const droppedDetail = sel.dropped.length
    ? `, ${sel.dropped.length} dropped (${sel.dropped.map((d) => `${d.file}: ${d.reason}`).join("; ")})`
    : "";
  const renameDetail = appRenames.length
    ? `, neutralized ${appRenames.map((r) => `${r.from}->${r.to}`).join(", ")}`
    : "";
  await endStep(
    "done",
    `${contentFiles.length} content file(s), ${passthrough.length} passthrough${droppedDetail}${renameDetail}`,
  );

  const demoTokens = stringArray(template.demo_tokens);

  // 5. regenerate every content file whole (concurrency-capped) ---------------
  // Pre-register one step per file so concurrent workers each update only their
  // own step by key — the shared "last step" endStep pattern is not safe here.
  for (const file of contentFiles) {
    steps.push({ key: `build:${file}`, label: `Building ${file}`, status: "running", started_at: new Date().toISOString() });
  }
  setCurrentKey("build");
  await writeThrough();

  const rebuilt: Record<string, string> = {};
  await runWithConcurrency(contentFiles, REGEN_CONCURRENCY, async (file) => {
    const step = steps.find((s) => s.key === `build:${file}`)!;
    const t0 = Date.now();
    try {
      const out = await regenerateFile({
        file,
        source: contentSources[file],
        contentModel,
        imagesForFile,
        demoTokens,
      });
      rebuilt[file] = out;
      progress.pagesBuilt++;
      step.status = "done";
      step.ms = Date.now() - t0;
      setCurrentKey(file);
      await writeThrough();
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      step.status = "failed";
      step.ms = Date.now() - t0;
      step.detail = msg.slice(0, 300);
      await writeThrough();
      throw new Error(`Regeneration failed for ${file}: ${msg}`); // never ship the source
    }
  });

  // 6. verify: leak + structure gates, with one targeted repair pass ----------
  await beginStep("verify", "Verifying");
  let gate = runGates({ template: contentSources, output: rebuilt, demoTokens });
  if (!gate.ok) {
    for (const file of offenderFiles(gate)) {
      if (contentSources[file] === undefined) continue;
      try {
        rebuilt[file] = await regenerateFile({
          file,
          source: contentSources[file],
          contentModel,
          imagesForFile,
          demoTokens,
          repairNote: repairNoteFor(file, gate),
        });
      } catch {
        // keep the prior output; the re-run gate below still fails and reports it
      }
    }
    gate = runGates({ template: contentSources, output: rebuilt, demoTokens });
  }
  await writeThrough({ gate_results: gate });
  if (!gate.ok) {
    const detail = describeGateFailure(gate);
    await endStep("failed", detail, { status: "failed", error: `Verification gate failed: ${detail}` });
    throw new Error(`Verification gate failed: ${detail}`);
  }
  await endStep("done", "leak + structure gates passed");

  // 7. finalize: package the zip + explode to template-sites (as v1) ----------
  await beginStep("finalize", "Packaging site");
  const finalText: Record<string, string> = {};
  for (const f of contentFiles) finalText[f] = rebuilt[f] ?? contentSources[f];
  // Passthrough text ships byte-for-byte — this is the deterministic, non-AI
  // half of the pipeline. style.css is included here unchanged, which is what
  // keeps the design identical. (A template whose CSS carried url() image refs
  // would get a deterministic rewrite here; this one has none, so it is a no-op.)
  for (const f of passthrough) if (textFiles[f] !== undefined) finalText[f] = textFiles[f];

  const encoder = new TextEncoder();
  const siteMap: Record<string, Uint8Array> = {};
  for (const [path, content_] of Object.entries(finalText)) siteMap[path] = encoder.encode(content_);
  for (const [path, bytes] of Object.entries(binaryFiles)) siteMap[path] = bytes;

  const zipBytes = zipFromMap(siteMap);
  const zipPath = `${generationId}/site.zip`;
  const zipUp = await admin.storage
    .from(SITES_BUCKET)
    .upload(zipPath, zipBytes, { contentType: "application/zip", upsert: true });
  if (zipUp.error) throw new Error(`Failed to upload site zip: ${zipUp.error.message}`);

  const siteEntries = Object.entries(siteMap);
  for (let i = 0; i < siteEntries.length; i += UPLOAD_BATCH) {
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
  await endStep("done", `${siteEntries.length} files packaged`, {
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
  });
}

/**
 * PLAN phase of a v2 template generation (Phase 2): freeze the brief, plan the
 * content model (Gemini Pro), gather + vision-rank image candidates into
 * per-slot `image_slots`, then STOP at status='curating' for the operator to
 * pick images — it never prepares/regenerates/verifies/finalizes a site
 * itself (see buildFromSelection for that half). Terminal status on any error
 * is `failed`. Step progress is written through to
 * `template_generations.steps`/`current_step` for the realtime tracker.
 */
export async function runTemplateGenerationV2(generationId: string): Promise<void> {
  const admin = createAdminClient();
  const runStart = Date.now();

  const steps: GenStep[] = [];
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

  try {
    // 1. load generation + lead + template; freeze the brief --------------------
    const { data: genRow, error: genErr } = await admin
      .from("template_generations")
      .select("id, lead_id, template_id, requested_pages, options")
      .eq("id", generationId)
      .single();
    if (genErr || !genRow) throw new Error(`Generation ${generationId} not found`);
    const gen = genRow as GenRow;

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

    const brief = buildBrief(lead as Parameters<typeof buildBrief>[0]);
    const siteSlug = `${businessSlug(brief.business_name)}-${websiteId()}`;
    await writeThrough({ brief, site_slug: siteSlug });
    const requestedPages = stringArray(gen.requested_pages);

    // 2. plan the content model (Gemini Pro) ------------------------------------
    await beginStep("plan", "Planning content", { status: "planning" });
    const { model: contentModel } = await planContent(brief, requestedPages);
    await endStep(
      "done",
      `${contentModel.services.length} services, ${contentModel.image_briefs.length} image briefs`,
      { content_model: contentModel },
    );

    // 3. gather + vision-rank image candidates into slots (Phase 2 curation) ----
    await beginStep("images", "Gathering + ranking images");
    const excludePeople = excludePeopleOf(gen.options);
    const imageSlots = await buildInitialSlots(contentModel.image_briefs, { brief, admin, excludePeople });
    const candidateCount = imageSlots.reduce((n, s) => n + s.candidates.length, 0);
    await endStep(
      imageSlots.length ? "done" : "partial",
      `${imageSlots.length} slot(s), ${candidateCount} candidate(s) gathered`,
      { image_slots: imageSlots },
    );

    // 4. pause here for the operator to curate images (Phase 2) -----------------
    await beginStep("curate", "Awaiting image curation");
    currentKey = null;
    await endStep("done", "ready for operator review", { status: "curating", error: null });
  } catch (e) {
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

  try {
    // Load the generation — has the frozen brief/content_model/image_slots the
    // plan phase wrote — plus the template. Continue the SAME step history the
    // plan phase started rather than resetting it.
    const { data: genRow, error: genErr } = await admin
      .from("template_generations")
      .select("id, template_id, requested_pages, brief, content_model, image_slots, steps, current_step")
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
      .select("id, name, storage_prefix, demo_tokens, manifest")
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
      template: { storage_prefix: template.storage_prefix, demo_tokens: template.demo_tokens, manifest: template.manifest },
      contentModel,
      imagesForFile,
      runStart,
      progress,
      steps,
      beginStep,
      endStep,
      writeThrough,
      setCurrentKey: (key) => {
        currentKey = key;
      },
    });
  } catch (e) {
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
  }
}
