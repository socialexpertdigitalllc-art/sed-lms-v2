// Template Engine v2 — the generation runner.
//
// Replaces v1's edit-ops core with: brief (full lead) -> content plan (Gemini) ->
// whole-file regeneration of every content file -> blocking verification gates.
// Reuses v1's proven scaffolding (storage list/download, the step tracker, zip +
// upload to `template-sites`) and only swaps the customization core, so the
// realtime UI, preview and deploy legs keep working unchanged.
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
import { classifyFiles } from "./classify";
import { selectContentFiles, type ManifestPage } from "./pageSelect";
import { neutralizeAppIdentifier } from "./neutralize";
import { regenerateFile } from "./regenerate";
import { runGates, type GateResult } from "./gates";
import { zipFromMap } from "./zip";
import { searchPexels, pickBest, type ImageSlot } from "./pexels";
import { businessSlug, websiteId } from "./slug";
import { contentTypeFor, listStorageFiles } from "./runner";
import type { ImageBrief } from "./contentModel";
import type { GenStep } from "./types";

const TEMPLATES_BUCKET = "website-templates";
const SITES_BUCKET = "template-sites";
const TEXT_FILE_RE = /\.(html?|css|js|mjs)$/i;
const UPLOAD_BATCH = 8;
const REGEN_CONCURRENCY = 3; // keep wall-clock sane without hammering the provider
const IMAGE_EXCLUDE_KINDS = new Set(["hero", "about"]); // slots that prefer a real client photo

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

/** A resolved image for a slot — a direct CDN url (client photo or Pexels), no rehost. */
interface ResolvedImage {
  slot_id: string;
  kind: string;
  query: string;
  url: string;
  source: "client" | "pexels";
}

/**
 * Phase 1 interim image resolution: client photos first for hero/about slots,
 * else a single best Pexels pick per brief. No vision curation yet (Phase 2 adds
 * the slot grid, the vision "no people" pass, and operator picks); this exists so
 * the runner is end-to-end today.
 */
async function resolveImages(
  briefs: ImageBrief[],
  brief: GenerationBrief,
  admin: SupabaseClient,
): Promise<ResolvedImage[]> {
  const clientPhotos = [...brief.client_photos];
  const usedIds = new Set<number>();
  let lastPhotographer: string | null = null;
  const resolved: ResolvedImage[] = [];

  for (const b of briefs) {
    if (IMAGE_EXCLUDE_KINDS.has(b.kind) && clientPhotos.length) {
      resolved.push({ slot_id: b.slot_id, kind: b.kind, query: b.query, url: clientPhotos.shift()!, source: "client" });
      continue;
    }
    const slot: ImageSlot = {
      key: b.slot_id,
      query: b.query,
      altQueries: [],
      orientation: "landscape",
      minWidth: b.kind === "hero" ? 1600 : 1200,
      wantsAction: b.kind === "service",
    };
    const photos = await searchPexels(b.query, "landscape", admin);
    const best = pickBest(photos, slot, usedIds, lastPhotographer);
    if (best) {
      usedIds.add(best.id);
      lastPhotographer = best.photographer ?? lastPhotographer;
      const url = best.src.large2x || best.src.original || best.src.large || best.src.medium;
      if (url) resolved.push({ slot_id: b.slot_id, kind: b.kind, query: b.query, url, source: "pexels" });
    }
  }
  return resolved;
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
}

/**
 * Run one v2 template generation end-to-end. Terminal status is `review` on
 * success or `failed` on any error (a failing gate included) — it never reaches
 * `review` with a leak. Step progress is written through to
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

  let imagesUsed = 0;
  let pagesBuilt = 0;

  try {
    // 1. load generation + lead + template; freeze the brief --------------------
    const { data: genRow, error: genErr } = await admin
      .from("template_generations")
      .select("id, lead_id, template_id, requested_pages")
      .eq("id", generationId)
      .single();
    if (genErr || !genRow) throw new Error(`Generation ${generationId} not found`);
    const gen = genRow as GenRow;

    const { data: lead } = await admin.from("leads").select("*").eq("id", gen.lead_id).single();
    if (!lead) throw new Error("Lead not found");
    const { data: template } = await admin
      .from("website_templates")
      .select("id, name, storage_prefix, demo_tokens, manifest")
      .eq("id", gen.template_id)
      .single();
    if (!template) throw new Error("Template not found");

    const demoTokens = stringArray(template.demo_tokens);
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

    // 3. resolve images (Phase 1 interim: client photos + Pexels, no curation) --
    await beginStep("images", "Resolving images");
    const images = await resolveImages(contentModel.image_briefs, brief, admin);
    imagesUsed = images.length;
    await endStep(images.length ? "done" : "partial", `${images.length} image(s) resolved`);

    // 4. prepare: download the template + classify content vs passthrough -------
    await beginStep("prepare", "Preparing template", { status: "building" });
    const { textFiles: downloadedTextFiles, binaryFiles } = await downloadTemplate(
      admin,
      String(template.storage_prefix),
    );
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

    // 5. regenerate every content file whole (concurrency-capped) ---------------
    // Pre-register one step per file so concurrent workers each update only their
    // own step by key — the shared "last step" endStep pattern is not safe here.
    for (const file of contentFiles) {
      steps.push({ key: `build:${file}`, label: `Building ${file}`, status: "running", started_at: new Date().toISOString() });
    }
    currentKey = "build";
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
          imagesForFile: images,
          demoTokens,
        });
        rebuilt[file] = out;
        pagesBuilt++;
        step.status = "done";
        step.ms = Date.now() - t0;
        currentKey = file;
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
            imagesForFile: images,
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

    currentKey = null;
    await endStep("done", `${siteEntries.length} files packaged`, {
      status: "review",
      zip_path: zipPath,
      pages_built: pagesBuilt,
      images_used: imagesUsed,
      // Phase 1 does not meter tokens (planContent/regenerateFile don't surface
      // counts); wire real accounting when their return shapes carry usage.
      tokens_used: 0,
      cost_usd: 0,
      total_ms: Date.now() - runStart,
      error: null,
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
          pages_built: pagesBuilt,
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
