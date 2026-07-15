import type { SupabaseClient } from "@supabase/supabase-js";
import { createAdminClient } from "@/lib/supabase/admin";
import { callProvider } from "@/lib/ai-tools/run";
import { TOOLS, isToolId, type ToolId } from "@/lib/ai-tools/config";
import { getTemplateEngineSettings } from "./settings";
import { businessSlug, websiteId } from "./slug";
import { searchPexels, pickBest, downloadImage, type ImageSlot, type PexelsPhoto } from "./pexels";
import { parseOps, applyOps, residualImageRefs } from "./editOps";
import { zipFromMap } from "./zip";
import type { EditOp, GenStep, ManifestPage, TemplateManifest } from "./types";

const TEMPLATES_BUCKET = "website-templates";
const SITES_BUCKET = "template-sites";
const TEXT_FILE_RE = /\.(html?|css|js|mjs)$/i;
const MAX_SERVICE_SLOTS = 8;
const UPLOAD_BATCH = 8;

const CONTENT_TYPES: Record<string, string> = {
  html: "text/html; charset=utf-8",
  htm: "text/html; charset=utf-8",
  css: "text/css; charset=utf-8",
  js: "text/javascript; charset=utf-8",
  mjs: "text/javascript; charset=utf-8",
  json: "application/json",
  map: "application/json",
  webmanifest: "application/manifest+json",
  txt: "text/plain; charset=utf-8",
  xml: "application/xml",
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  webp: "image/webp",
  gif: "image/gif",
  svg: "image/svg+xml",
  avif: "image/avif",
  ico: "image/x-icon",
  woff: "font/woff",
  woff2: "font/woff2",
  ttf: "font/ttf",
  otf: "font/otf",
  eot: "application/vnd.ms-fontobject",
  mp4: "video/mp4",
  webm: "video/webm",
  pdf: "application/pdf",
};

/** Content type for a file path by extension (shared by runner, upload and preview routes). */
export function contentTypeFor(path: string, fallback = "application/octet-stream"): string {
  const ext = path.toLowerCase().split(".").pop() ?? "";
  return CONTENT_TYPES[ext] ?? fallback;
}

const CT_TO_EXT: Record<string, string> = {
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/webp": "webp",
  "image/gif": "gif",
  "image/svg+xml": "svg",
  "image/avif": "avif",
};

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** Placeholder substitution that is safe for values containing `$` (split/join, not replace). */
function fillTemplate(tpl: string, vars: Record<string, string>): string {
  let out = tpl;
  for (const [k, v] of Object.entries(vars)) out = out.split(`{{${k}}}`).join(v);
  return out;
}

/** Best-effort JSON object extraction from LLM output (fences/prose tolerated). */
function parseJsonLoose(text: string): unknown {
  if (!text) return null;
  let t = String(text).trim();
  const fenced = t.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fenced) t = fenced[1].trim();
  const start = t.indexOf("{");
  if (start === -1) return null;
  t = t.slice(start);
  try {
    return JSON.parse(t);
  } catch {
    const end = t.lastIndexOf("}");
    if (end <= 0) return null;
    try {
      return JSON.parse(t.slice(0, end + 1));
    } catch {
      return null;
    }
  }
}

function extFromUrl(url: string): string {
  try {
    const path = new URL(url).pathname.toLowerCase();
    const m = path.match(/\.(jpe?g|png|webp|gif|avif)$/);
    if (!m) return "jpg";
    return m[1] === "jpeg" ? "jpg" : m[1];
  } catch {
    return "jpg";
  }
}

function stringArray(v: unknown): string[] {
  return Array.isArray(v) ? v.filter((s): s is string => typeof s === "string" && s.trim().length > 0) : [];
}

/** Recursively list every file under a prefix in a storage bucket. */
export async function listStorageFiles(admin: SupabaseClient, bucket: string, prefix: string): Promise<string[]> {
  const out: string[] = [];
  async function walk(dir: string): Promise<void> {
    const { data, error } = await admin.storage.from(bucket).list(dir, { limit: 1000 });
    if (error || !data) return;
    for (const entry of data) {
      if (!entry.name || entry.name === ".emptyFolderPlaceholder") continue;
      const path = `${dir}/${entry.name}`;
      // folder placeholders come back without an id; files always have one
      if (!entry.id) await walk(path);
      else out.push(path);
    }
  }
  await walk(prefix.replace(/\/+$/, ""));
  return out;
}

interface GenerationRow {
  id: string;
  lead_id: string;
  template_id: string;
  tool: string;
  model: string;
  requested_pages: unknown;
  status: string;
}

interface PageJob {
  stepKey: string;
  targetFile: string;
  sourceFile: string;
  page: ManifestPage;
  extra: string;
  skipReason?: string;
}

/**
 * Execute one template generation end-to-end.
 * Steps (each write-through to template_generations.steps/current_step):
 *   prepare -> plan -> images -> page:{file}... -> components? -> finalize
 * On success the generation ends `ready_for_review` with totals set.
 * On failure the current step is marked failed, the generation `failed`,
 * its processing queue rows `failed`, and the error is rethrown.
 */
export async function runTemplateGeneration(generationId: string): Promise<void> {
  const admin = createAdminClient();
  const runStart = Date.now();

  const { data: genRow, error: genErr } = await admin
    .from("template_generations")
    .select("id, lead_id, template_id, tool, model, requested_pages, status")
    .eq("id", generationId)
    .single();
  if (genErr || !genRow) throw new Error(`Generation ${generationId} not found`);
  const gen = genRow as GenerationRow;
  if (!isToolId(gen.tool)) throw new Error(`Unknown engine tool: ${gen.tool}`);
  const tool = gen.tool as ToolId;

  const { data: lead } = await admin.from("leads").select("*").eq("id", gen.lead_id).single();
  const { data: template } = await admin
    .from("website_templates")
    .select("id, name, storage_prefix, manifest")
    .eq("id", gen.template_id)
    .single();

  // step machinery ----------------------------------------------------------
  const state = { steps: [] as GenStep[], currentKey: null as string | null, stepStart: 0 };
  let tokensUsed = 0;
  let aiMs = 0;
  let opsApplied = 0;
  let opsMissed = 0;
  let pagesBuilt = 0;
  let imagesUsed = 0;

  async function writeThrough(extra?: Record<string, unknown>): Promise<void> {
    await admin
      .from("template_generations")
      .update({
        steps: state.steps,
        current_step: state.currentKey,
        updated_at: new Date().toISOString(),
        ...(extra ?? {}),
      })
      .eq("id", generationId);
  }

  async function beginStep(key: string, label: string): Promise<void> {
    state.steps.push({ key, label, status: "running", started_at: new Date().toISOString() });
    state.currentKey = key;
    state.stepStart = Date.now();
    await writeThrough();
  }

  async function endStep(status: "done" | "partial", detail?: string, extra?: Record<string, unknown>): Promise<void> {
    const step = state.steps[state.steps.length - 1];
    step.status = status;
    step.ms = Date.now() - state.stepStart;
    if (detail) step.detail = detail;
    await writeThrough(extra);
  }

  const settings = await getTemplateEngineSettings();

  async function callLlm(systemPrompt: string, userPrompt: string): Promise<string> {
    const t0 = Date.now();
    const { text, tokens } = await callProvider(tool, gen.model, systemPrompt, userPrompt, {
      maxTokens: settings.max_tokens,
      temperature: settings.temperature,
    });
    aiMs += Date.now() - t0;
    tokensUsed += tokens;
    return text;
  }

  const costUsd = () => Number(((tokensUsed / 1000) * (TOOLS[tool]?.costPer1kUsd ?? 0)).toFixed(4));

  try {
    if (!lead) throw new Error("Lead not found");
    if (!template) throw new Error("Template not found");
    const manifest = (template.manifest ?? {}) as TemplateManifest;
    const manifestPages: ManifestPage[] = Array.isArray(manifest.pages) ? manifest.pages : [];

    // 1. prepare -------------------------------------------------------------
    await beginStep("prepare", "Preparing template");
    const excluded = new Set(Array.isArray(manifest.imageFiles) ? manifest.imageFiles : []);
    const prefix = String(template.storage_prefix).replace(/\/+$/, "");
    const storagePaths = await listStorageFiles(admin, TEMPLATES_BUCKET, prefix);
    if (storagePaths.length === 0) throw new Error("Template files not found in storage");

    const textFiles: Record<string, string> = {};
    const binaryFiles: Record<string, Uint8Array> = {};
    const decoder = new TextDecoder();
    const keep = storagePaths
      .map((full) => ({ full, rel: full.slice(prefix.length + 1) }))
      .filter(({ rel }) => rel.length > 0 && !excluded.has(rel));
    for (let i = 0; i < keep.length; i += UPLOAD_BATCH) {
      await Promise.all(
        keep.slice(i, i + UPLOAD_BATCH).map(async ({ full, rel }) => {
          const { data, error } = await admin.storage.from(TEMPLATES_BUCKET).download(full);
          if (error || !data) throw new Error(`Failed to download template file ${rel}: ${error?.message ?? "no data"}`);
          const bytes = new Uint8Array(await data.arrayBuffer());
          if (TEXT_FILE_RE.test(rel)) textFiles[rel] = decoder.decode(bytes);
          else binaryFiles[rel] = bytes;
        })
      );
    }
    const siteSlug = `${businessSlug(String(lead.business_name ?? ""))}-${websiteId()}`;
    await endStep("done", `${keep.length} files, ${manifestPages.length} pages`, { site_slug: siteSlug });

    // 2. plan ----------------------------------------------------------------
    await beginStep("plan", "Planning images");
    const services = stringArray(lead.services);
    const serviceAreas = stringArray(lead.service_areas);
    const business = {
      business_name: (lead.business_name as string) ?? "",
      business_phone: (lead.business_phone as string | null) ?? null,
      business_email: (lead.business_email as string | null) ?? null,
      site_type: (lead.site_type as string | null) ?? null,
      services,
      service_areas: serviceAreas,
    };
    const businessJson = JSON.stringify(business);

    const plan: { hero: string[]; services: Record<string, string[]> } = { hero: [], services: {} };
    try {
      const planPrompt = settings.image_query_prompt.includes("{{BUSINESS_JSON}}")
        ? fillTemplate(settings.image_query_prompt, { BUSINESS_JSON: businessJson })
        : `${settings.image_query_prompt}\n\nBUSINESS:\n${businessJson}`;
      const planText = await callLlm("You are a planning assistant. Output ONLY valid JSON.", planPrompt);
      const parsed = parseJsonLoose(planText);
      if (parsed && typeof parsed === "object") {
        const rec = parsed as Record<string, unknown>;
        plan.hero = stringArray(rec.hero);
        if (rec.services && typeof rec.services === "object" && !Array.isArray(rec.services)) {
          for (const [name, queries] of Object.entries(rec.services as Record<string, unknown>)) {
            const qs = stringArray(queries);
            if (qs.length) plan.services[name] = qs;
          }
        }
      }
    } catch {
      // plan is advisory — fall back to raw service names as queries
    }

    const slotServices = services.slice(0, MAX_SERVICE_SLOTS);
    const fallbackHero =
      slotServices[0] ?? (typeof lead.site_type === "string" && lead.site_type ? lead.site_type : "local business");
    const heroQueries = plan.hero.length ? plan.hero : [fallbackHero];
    const dedupe = (qs: string[], primary: string) => qs.filter((q, i, a) => q !== primary && a.indexOf(q) === i);
    const slots: ImageSlot[] = [
      {
        key: "hero",
        query: heroQueries[0],
        altQueries: dedupe([...heroQueries.slice(1), fallbackHero], heroQueries[0]),
        orientation: "landscape",
        minWidth: 1600,
      },
    ];
    const planByName = new Map(Object.entries(plan.services).map(([k, v]) => [k.toLowerCase().trim(), v]));
    const usedSlotKeys = new Set<string>(["hero"]);
    for (const svc of slotServices) {
      const queries = planByName.get(svc.toLowerCase().trim()) ?? [];
      const base = `service-${businessSlug(svc)}`;
      let key = base;
      for (let n = 2; usedSlotKeys.has(key); n++) key = `${base}-${n}`;
      usedSlotKeys.add(key);
      slots.push({
        key,
        query: queries[0] ?? svc,
        altQueries: dedupe([...queries.slice(1), svc], queries[0] ?? svc),
        orientation: "landscape",
        minWidth: 1200,
        wantsAction: true,
      });
    }
    await endStep("done", `${slots.length} image slots planned`);

    // 3. images ---------------------------------------------------------------
    await beginStep("images", "Fetching images");
    const imageFiles: Record<string, Uint8Array> = {};
    const businessImagePaths: string[] = [];
    const usedIds = new Set<number>();
    let lastPhotographer: string | null = null;
    const skippedSlots: string[] = [];

    for (const slot of slots) {
      let best: PexelsPhoto | null = null;
      let photoUrl = "";
      for (const query of [slot.query, ...slot.altQueries]) {
        const photos = await searchPexels(query, slot.orientation, admin);
        best = pickBest(photos, slot, usedIds, lastPhotographer);
        if (best) break;
      }
      if (best) photoUrl = best.src.large2x || best.src.original || best.src.large || best.src.medium;
      const bytes = best && photoUrl ? await downloadImage(photoUrl) : null;
      if (!best || !bytes) {
        skippedSlots.push(slot.key);
        continue;
      }
      usedIds.add(best.id);
      lastPhotographer = best.photographer ?? lastPhotographer;
      const ext = extFromUrl(photoUrl);
      const path = slot.key === "hero" ? `images/hero-1.${ext}` : `images/${slot.key}.${ext}`;
      imageFiles[path] = bytes;
      imagesUsed++;
    }

    let businessN = 0;
    for (const link of stringArray(lead.image_links)) {
      try {
        const res = await fetch(link, { signal: AbortSignal.timeout(15000) });
        if (!res.ok) continue;
        const ct = (res.headers.get("content-type") ?? "").split(";")[0].trim().toLowerCase();
        if (ct && !ct.startsWith("image/")) continue;
        const bytes = new Uint8Array(await res.arrayBuffer());
        if (bytes.byteLength === 0) continue;
        businessN++;
        const path = `images/business-${businessN}.${CT_TO_EXT[ct] ?? "jpg"}`;
        imageFiles[path] = bytes;
        businessImagePaths.push(path);
        imagesUsed++;
      } catch {
        // unreachable link — skip; never fail the run on images
      }
    }
    await endStep(
      skippedSlots.length ? "partial" : "done",
      `${imagesUsed} images` + (skippedSlots.length ? `; ${skippedSlots.length} slot(s) skipped: ${skippedSlots.join(", ")}` : "")
    );

    // 4. page steps -------------------------------------------------------------
    const requested = new Set(stringArray(gen.requested_pages));
    const selected = manifestPages.filter((p) => requested.has(p.file));
    const jobs: PageJob[] = [];
    const serviceClones: string[] = [];
    const areaClones: string[] = [];
    let serviceDetailOrig: string | null = null;
    let areaDetailOrig: string | null = null;

    const usedTargets = new Set<string>();
    for (const p of selected) if (p.kind !== "service_detail" && p.kind !== "area_detail") usedTargets.add(p.file);
    const uniqueTarget = (base: string): string => {
      let target = `${base}.html`;
      for (let n = 2; usedTargets.has(target); n++) target = `${base}-${n}.html`;
      usedTargets.add(target);
      return target;
    };

    for (const page of selected) {
      if (page.kind === "service_detail") {
        serviceDetailOrig = page.file;
        if (services.length === 0) {
          jobs.push({
            stepKey: `page:${page.file}`,
            targetFile: page.file,
            sourceFile: page.file,
            page,
            extra: "",
            skipReason: "no services on lead — page skipped",
          });
          continue;
        }
        for (const svc of services) {
          const target = uniqueTarget(`service-${businessSlug(svc)}`);
          serviceClones.push(target);
          jobs.push({
            stepKey: `page:${target}`,
            targetFile: target,
            sourceFile: page.file,
            page,
            extra: `This page is the dedicated detail page for the service "${svc}". Write all headlines and copy specifically about this service for the business.`,
          });
        }
      } else if (page.kind === "area_detail") {
        areaDetailOrig = page.file;
        if (serviceAreas.length === 0) {
          jobs.push({
            stepKey: `page:${page.file}`,
            targetFile: page.file,
            sourceFile: page.file,
            page,
            extra: "",
            skipReason: "no service areas on lead — page skipped",
          });
          continue;
        }
        for (const area of serviceAreas) {
          const target = uniqueTarget(`area-${businessSlug(area)}`);
          areaClones.push(target);
          const extra =
            businessImagePaths.length > 0
              ? `This page is the dedicated page for the service area "${area}". Write the copy about serving customers in ${area}. Prefer the business-provided images (paths starting with "images/business-") for this page's main imagery.`
              : `This page is the dedicated page for the service area "${area}". Write the copy about serving customers in ${area}. Replace the page's main image element with exactly this embed (keep surrounding layout): <iframe src="https://www.google.com/maps?q=${encodeURIComponent(`${area} USA`)}&output=embed" width="100%" height="360" style="border:0" loading="lazy" title="${area} map"></iframe>`;
          jobs.push({ stepKey: `page:${target}`, targetFile: target, sourceFile: page.file, page, extra });
        }
      } else {
        jobs.push({ stepKey: `page:${page.file}`, targetFile: page.file, sourceFile: page.file, page, extra: "" });
      }
    }

    const imagesList = Object.keys(imageFiles).sort().join("\n") || "(none available — leave image references unchanged)";
    const outFiles: Record<string, string> = {};

    for (const job of jobs) {
      await beginStep(job.stepKey, `Building ${job.targetFile}`);
      if (job.skipReason) {
        await endStep("partial", job.skipReason);
        continue;
      }
      const source = textFiles[job.sourceFile];
      if (source === undefined) {
        await endStep("partial", `source file ${job.sourceFile} missing from template`);
        continue;
      }

      const userPrompt = fillTemplate(settings.edit_prompt, {
        PAGE_NAME: `${job.targetFile} (${job.page.title})`,
        PAGE_KIND: job.page.kind,
        BUSINESS_JSON: businessJson,
        IMAGES_LIST: imagesList,
        EXTRA: job.extra,
        PAGE_HTML: source,
      });
      const raw = await callLlm(settings.system_prompt, userPrompt);
      const ops = parseOps(raw);
      const first = applyOps(source, ops);
      let html = first.html;
      let applied = first.applied;
      let missedCount = first.missed.length;

      if (first.missed.length > 0) {
        // one retry of ONLY the missed ops, against the current html
        const retryPrompt = `You previously returned edit operations for the page "${job.targetFile}". The operations below FAILED because their "find" strings do not appear verbatim in the page HTML:

${JSON.stringify({ ops: first.missed })}

Return corrected versions of ONLY these operations. Copy each "find" value EXACTLY (verbatim, including whitespace) from the CURRENT PAGE HTML below, keeping the intended "replace" values.

Return ONLY this JSON shape: {"ops":[{"find":"...","replace":"..."}]}

CURRENT PAGE HTML:
${html}`;
        const retryRaw = await callLlm(settings.system_prompt, retryPrompt);
        const retryOps = parseOps(retryRaw);
        if (retryOps.length > 0) {
          const second = applyOps(html, retryOps);
          html = second.html;
          applied += second.applied;
          missedCount = Math.max(0, missedCount - second.applied);
        }
      }

      opsApplied += applied;
      opsMissed += missedCount;
      outFiles[job.targetFile] = html;
      pagesBuilt++;
      await endStep(missedCount ? "partial" : "done", `${applied} edits, ${missedCount} missed`);
    }

    // deterministic hub post-pass: point anchors at the first clone
    const rewriteHubLinks = (origFile: string | null, firstClone: string | undefined, hubKind: string) => {
      if (!origFile || !firstClone) return;
      for (const page of selected) {
        if (page.kind !== hubKind) continue;
        const html = outFiles[page.file];
        if (!html) continue;
        const re = new RegExp(`(href\\s*=\\s*["'])(?:\\./)?${escapeRegExp(origFile)}(["'])`, "gi");
        const replaced = html.replace(re, `$1${firstClone}$2`);
        if (replaced === html) continue;
        outFiles[page.file] = replaced;
        const step = state.steps.find((s) => s.key === `page:${page.file}`);
        if (step) step.detail = `${step.detail ? `${step.detail}; ` : ""}links → ${firstClone}`;
      }
    };
    rewriteHubLinks(serviceDetailOrig, serviceClones[0], "services_hub");
    rewriteHubLinks(areaDetailOrig, areaClones[0], "areas_hub");

    // 5. components -------------------------------------------------------------
    const componentsFile = typeof manifest.components === "string" ? manifest.components : null;
    if (componentsFile && textFiles[componentsFile] !== undefined) {
      await beginStep("components", "Updating shared components");
      const payload: [string, string][] = [[componentsFile, textFiles[componentsFile]]];
      for (const cssPath of Array.isArray(manifest.css) ? manifest.css : []) {
        const css = textFiles[cssPath];
        if (css !== undefined && css.includes("url(")) payload.push([cssPath, css]);
      }
      const blob = payload.map(([path, content]) => `=== FILE: ${path} ===\n${content}`).join("\n\n");
      const extra = `This payload contains ${payload.length} file(s), each delimited by a "=== FILE: <path> ===" marker line (the markers are NOT part of the files). Every operation MUST include a "file" property naming exactly which file it edits, e.g. {"file":"${componentsFile}","find":"...","replace":"..."}. In ${componentsFile}: update the business name, phone number, email and links to match the business. In CSS files: replace image url(...) references with the provided local image paths (from inside a subfolder, reference them as ../images/<name>).`;
      const userPrompt = fillTemplate(settings.edit_prompt, {
        PAGE_NAME: "shared components",
        PAGE_KIND: "components",
        BUSINESS_JSON: businessJson,
        IMAGES_LIST: imagesList,
        EXTRA: extra,
        PAGE_HTML: blob,
      });
      const raw = await callLlm(settings.system_prompt, userPrompt);
      const ops = parseOps(raw);
      const byFile = new Map<string, EditOp[]>();
      for (const op of ops) {
        const target = op.file ? op.file.replace(/^\.\//, "") : componentsFile;
        const file = payload.some(([p]) => p === target) ? target : componentsFile;
        const list = byFile.get(file);
        if (list) list.push(op);
        else byFile.set(file, [op]);
      }
      let applied = 0;
      let missedCount = 0;
      for (const [file, fileOps] of byFile) {
        const res = applyOps(textFiles[file], fileOps);
        textFiles[file] = res.html;
        applied += res.applied;
        missedCount += res.missed.length;
      }
      opsApplied += applied;
      opsMissed += missedCount;
      await endStep(missedCount ? "partial" : "done", `${applied} edits, ${missedCount} missed across ${payload.length} file(s)`);
    }

    // 6. finalize ----------------------------------------------------------------
    await beginStep("finalize", "Packaging site");
    const pageFileNames = new Set(manifestPages.map((p) => p.file));
    const finalText: Record<string, string> = { ...outFiles };
    for (const [path, content] of Object.entries(textFiles)) {
      if (pageFileNames.has(path)) continue; // template pages only ship as built pages
      finalText[path] = content;
    }

    const available = new Set<string>();
    for (const path of Object.keys(imageFiles)) {
      available.add(path);
      available.add(path.split("/").pop() ?? path);
    }
    const leftovers = residualImageRefs(finalText, available);

    const encoder = new TextEncoder();
    const siteMap: Record<string, Uint8Array> = {};
    for (const [path, content] of Object.entries(finalText)) siteMap[path] = encoder.encode(content);
    for (const [path, bytes] of Object.entries(imageFiles)) siteMap[path] = bytes;
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
        })
      );
    }

    state.currentKey = null;
    await endStep(
      leftovers.length ? "partial" : "done",
      leftovers.length
        ? `${leftovers.length} residual image ref(s): ${leftovers.slice(0, 10).join("; ")}`
        : `${siteEntries.length} files packaged`,
      {
        status: "ready_for_review",
        zip_path: zipPath,
        pages_built: pagesBuilt,
        images_used: imagesUsed,
        ops_applied: opsApplied,
        ops_missed: opsMissed,
        tokens_used: tokensUsed,
        cost_usd: costUsd(),
        total_ms: Date.now() - runStart,
        ai_ms: aiMs,
        error: null,
      }
    );
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    const last = state.steps[state.steps.length - 1];
    if (last && last.status === "running") {
      last.status = "failed";
      last.ms = Date.now() - state.stepStart;
      last.detail = msg.slice(0, 300);
    }
    try {
      await admin
        .from("template_generations")
        .update({
          steps: state.steps,
          current_step: state.currentKey,
          status: "failed",
          error: msg.slice(0, 800),
          pages_built: pagesBuilt,
          images_used: imagesUsed,
          ops_applied: opsApplied,
          ops_missed: opsMissed,
          tokens_used: tokensUsed,
          cost_usd: costUsd(),
          total_ms: Date.now() - runStart,
          ai_ms: aiMs,
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
