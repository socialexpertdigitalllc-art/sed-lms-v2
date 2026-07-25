import type { SupabaseClient } from "@supabase/supabase-js";
import { callForTask } from "@/lib/ai-tools/providers/run";
import type { CompiledTemplate, TemplateManifest } from "../schema";
import { manifestSchema } from "../schema";
import { findTokens } from "../tokens";
import { renderSite } from "../render/renderer";
import { loadPackage } from "../service/templates";
import { buildDossier } from "./dossier";
import { selectPages, slugify } from "./pageSelect";
import { seedContentDoc } from "./seed";
import { writePage, type AiCall, type WriteResult } from "./writer";
import { applyWritten } from "./applyWritten";
import { finalizeRun } from "./finalize";
import { nextStep, type PageWriteState, type RunStep, type StudioRunRow } from "./types";

/** Production AiCall: routes the per-page write through the task router,
 *  reusing the "template_compile" task (strict-JSON, moderate output) rather
 *  than adding a new registered task for one more site-studio call site. */
export const productionWriterCall: AiCall = async (system, user) => {
  const { text } = await callForTask("template_compile", system, user, { maxTokens: 8000, temperature: 0.4 });
  return { text };
};

export interface RunStepDeps {
  aiCall: AiCall;
  /** Injectable clock — tests pin it; production omits it. */
  now?: () => Date;
}

export type RunStepResult =
  | { done: true; row: StudioRunRow }
  | { done: false; row: StudioRunRow };

const MAX_WRITE_ATTEMPTS = 2;

/** How an identity key reads to an operator, so a fail-fast refusal is
 *  actionable instead of a bare token name. Falls back to a quoted raw key
 *  for anything not in this table (new identity keys stay nameable). */
const IDENTITY_LABELS: Record<string, string> = {
  business_name: "a business name",
  phone: "a phone number",
  phone_href: "a phone number",
  email: "an email address",
  email_href: "an email address",
  logo: "a logo",
  map_embed: "a map link",
  profile_link: "a business profile link",
  year: "the current year",
};

function humanizeMissingIdentity(keys: string[]): string {
  const labels = [...new Set(keys.map((k) => IDENTITY_LABELS[k] ?? `"${k}"`))];
  if (labels.length === 1) return labels[0];
  if (labels.length === 2) return `${labels[0]} and ${labels[1]}`;
  return `${labels.slice(0, -1).join(", ")}, and ${labels[labels.length - 1]}`;
}

/** Every `{{id:*}}` key the compiled package can actually reference — pages,
 *  fragments, and nav item labels. Same method `renderSite` uses for its own
 *  completeness check; `prepare` runs it BEFORE `write` so a lead missing
 *  something the template needs is refused before a single AI call is paid
 *  for, instead of failing at `render` after every page has been written. */
function referencedIdentityKeys(tpl: CompiledTemplate): Set<string> {
  const navLabels = tpl.manifest.nav.flatMap((r) => (r.items ?? []).map((it) => it.label));
  const haystacks = [...Object.values(tpl.pages), ...Object.values(tpl.fragments), ...navLabels];
  const keys = new Set<string>();
  for (const s of haystacks) for (const t of findTokens(s)) if (t.kind === "id") keys.add(t.key);
  return keys;
}

function randomBase36(len: number): string {
  return Math.random().toString(36).slice(2, 2 + len).padEnd(len, "0");
}

async function loadManifest(admin: SupabaseClient, templateId: string): Promise<TemplateManifest> {
  const { data, error } = await admin.from("studio_templates").select("manifest").eq("id", templateId).single();
  if (error || !data?.manifest) {
    throw new Error(`engine: template "${templateId}" has no compiled manifest (${error?.message ?? "not found"})`);
  }
  return manifestSchema.parse(data.manifest);
}

async function loadLeadRow(admin: SupabaseClient, leadId: string): Promise<Record<string, unknown>> {
  const { data, error } = await admin.from("leads").select("*").eq("id", leadId).single();
  if (error || !data) throw new Error(`engine: lead "${leadId}" not found (${error?.message ?? "no data"})`);
  return data as Record<string, unknown>;
}

async function persistRun(admin: SupabaseClient, id: string, patch: Record<string, unknown>): Promise<StudioRunRow> {
  const { data, error } = await admin
    .from("studio_runs")
    .update({ ...patch, updated_at: new Date().toISOString() })
    .eq("id", id)
    .select("*")
    .single();
  if (error || !data) throw new Error(`engine: failed to persist run "${id}" (${error?.message ?? "no data"})`);
  return data as StudioRunRow;
}

async function logEvent(
  admin: SupabaseClient,
  runId: string,
  step: RunStep,
  level: "info" | "warn" | "error",
  message: string,
  detail?: unknown,
): Promise<void> {
  await admin.from("studio_run_events").insert({ run_id: runId, step, level, message, detail: detail ?? null });
}

/** Deterministic prepare: lead -> dossier -> pages -> theme -> seeded doc.
 *  Fails FAST (before any AI call) if the template references an identity
 *  key this lead cannot supply — `renderSite`'s own completeness check is
 *  global (one missing key refuses the whole site), so catching it here
 *  means the operator never pays for a full round of page writes only to
 *  have `render` refuse at the end. */
async function runPrepare(admin: SupabaseClient, row: StudioRunRow, now: () => Date): Promise<StudioRunRow> {
  if (!row.lead_id) {
    const updated = await persistRun(admin, row.id, {
      status: "failed",
      error: "This run has no lead (it may have been deleted). Start a new run against a live lead.",
    });
    await logEvent(admin, row.id, "prepare", "error", "Prepare refused: run has no lead.");
    return updated;
  }

  const manifest = await loadManifest(admin, row.template_id);
  const tpl = await loadPackage(admin, row.template_id, manifest);
  const leadRow = await loadLeadRow(admin, row.lead_id);
  const dossier = buildDossier(leadRow);

  const requested = row.options.page_ids?.length ? row.options.page_ids : dossier.requested_pages;
  const selection = selectPages(manifest, {
    requested,
    services: dossier.services,
    areas: dossier.service_areas,
    fanOutServices: row.options.fan_out_services,
    fanOutAreas: row.options.fan_out_areas,
  });

  const { doc } = seedContentDoc(manifest, dossier, selection.pages);

  const referenced = referencedIdentityKeys(tpl);
  const missingIdentity = [...referenced].filter((k) => !(k in doc.identity));
  if (missingIdentity.length > 0) {
    const message =
      `This template needs ${humanizeMissingIdentity(missingIdentity)}, which this lead doesn't have. ` +
      `Add them to the lead and start a new run.`;
    const updated = await persistRun(admin, row.id, { status: "failed", error: message });
    await logEvent(
      admin, row.id, "prepare", "error",
      "Prepare refused: lead is missing identity data the template requires.",
      { missing: missingIdentity },
    );
    return updated;
  }

  const siteSlug = `${slugify(dossier.business_name) || "site"}-${randomBase36(6)}`;

  const updated = await persistRun(admin, row.id, {
    content_doc: doc,
    client_photos: dossier.client_photos,
    site_slug: siteSlug,
    steps: { ...row.steps, prepare: { at: now().toISOString(), pages: doc.pages.length } },
    status: "preparing",
  });
  await logEvent(
    admin, row.id, "prepare", "info",
    `Prepared ${doc.pages.length} page(s)${selection.skipped.length ? `; skipped: ${selection.skipped.join(", ")}` : ""}.`,
    { skipped: selection.skipped },
  );
  return updated;
}

/** Writes every PENDING doc-page in parallel (one AI call each, via
 *  `Promise.allSettled` so one page's failure can never block another's
 *  result from landing). "Pending" = not yet `written`, and under the
 *  2-attempt cap — so re-running this step (status stays unchanged while any
 *  page remains incomplete, letting `nextStep` route back here) naturally
 *  retries ONLY the pages that still need it; an already-written page is
 *  never re-called, and a page that has exhausted its attempts is left
 *  reported (not silently dropped) rather than retried forever. Status only
 *  advances once every doc-page is `written`. */
async function runWrite(admin: SupabaseClient, row: StudioRunRow, deps: RunStepDeps): Promise<StudioRunRow> {
  if (!row.content_doc) throw new Error("engine: write step reached before prepare completed");
  if (!row.lead_id) throw new Error("engine: write step has no lead");

  const manifest = await loadManifest(admin, row.template_id);
  const leadRow = await loadLeadRow(admin, row.lead_id);
  const dossier = buildDossier(leadRow);
  const pagesById = new Map(manifest.pages.map((p) => [p.id, p]));

  const doc = row.content_doc;
  const existing: Record<string, PageWriteState> = row.steps.write?.pages ?? {};

  const eligible: number[] = [];
  doc.pages.forEach((_, i) => {
    const st = existing[String(i)];
    if (!st || (st.status !== "written" && st.attempts < MAX_WRITE_ATTEMPTS)) eligible.push(i);
  });

  const settled = await Promise.allSettled(
    eligible.map((i) => {
      const page = doc.pages[i];
      const def = pagesById.get(page.page_id);
      if (!def) {
        return Promise.resolve<WriteResult>({
          ok: false,
          error: `engine: page "${page.page_id}" is not in the template manifest`,
        });
      }
      // A stamped fan-out page's stamp value rides along as its own
      // nav_title (seedContentDoc/selectPages set it to the same string) —
      // no separate storage needed to recover it here.
      return writePage(def, dossier, { stampValue: page.nav_title }, deps.aiCall);
    }),
  );

  let workingDoc = doc;
  const pages: Record<string, PageWriteState> = { ...existing };
  eligible.forEach((i, idx) => {
    const outcome = settled[idx];
    const r: WriteResult =
      outcome.status === "fulfilled"
        ? outcome.value
        : { ok: false, error: outcome.reason instanceof Error ? outcome.reason.message : String(outcome.reason) };
    const prevAttempts = pages[String(i)]?.attempts ?? 0;
    if (r.ok) {
      workingDoc = applyWritten(workingDoc, i, r);
      pages[String(i)] = { status: "written", attempts: prevAttempts + 1 };
    } else {
      pages[String(i)] = { status: "failed", attempts: prevAttempts + 1, error: r.error };
    }
  });

  const allWritten = doc.pages.every((_, i) => pages[String(i)]?.status === "written");

  const updated = await persistRun(admin, row.id, {
    content_doc: workingDoc,
    steps: { ...row.steps, write: { pages } },
    // Advance only once every page is written; otherwise leave status
    // exactly as it was so nextStep routes back to "write" and retries only
    // what's left.
    status: allWritten ? "writing" : row.status,
  });

  const failedCount = Object.values(pages).filter((p) => p.status === "failed").length;
  await logEvent(
    admin, row.id, "write",
    failedCount > 0 ? "warn" : "info",
    allWritten
      ? `All ${doc.pages.length} page(s) written.`
      : `${failedCount} page(s) failed to write this round; will retry on the next step call.`,
    { pages },
  );

  return updated;
}

/** Pure render check. A refusal (missing slot/repeat/identity content) is a
 *  RUN failure with the missing list attached — never a silent partial
 *  site. Does not persist the rendered files: they are cheap to recompute
 *  and `finalize` recomputes them anyway (see finalize.ts's doc comment). */
async function runRender(admin: SupabaseClient, row: StudioRunRow): Promise<StudioRunRow> {
  if (!row.content_doc) throw new Error("engine: render step reached before prepare completed");

  const manifest = await loadManifest(admin, row.template_id);
  const tpl = await loadPackage(admin, row.template_id, manifest);
  const result = renderSite(tpl, row.content_doc);

  if (!result.ok) {
    const message = `Render refused: missing ${result.missing.map((m) => `${m.page_id}/${m.slot_id}`).join(", ")}`;
    const updated = await persistRun(admin, row.id, { status: "failed", error: message });
    await logEvent(admin, row.id, "render", "error", "Render refused: content is incomplete.", { missing: result.missing });
    return updated;
  }

  const updated = await persistRun(admin, row.id, {
    steps: { ...row.steps, render: { at: new Date().toISOString(), files: Object.keys(result.files).length } },
    status: "rendering",
  });
  await logEvent(admin, row.id, "render", "info", `Rendered ${Object.keys(result.files).length} file(s).`);
  return updated;
}

/** Re-renders from scratch (never trusts `render`'s prior output — see
 *  finalize.ts), zips, and uploads. */
async function runFinalize(admin: SupabaseClient, row: StudioRunRow, now: () => Date): Promise<StudioRunRow> {
  if (!row.content_doc) throw new Error("engine: finalize step reached before prepare completed");

  const manifest = await loadManifest(admin, row.template_id);
  const tpl = await loadPackage(admin, row.template_id, manifest);
  const outcome = await finalizeRun(admin, tpl, row.content_doc, row.id);

  if (!outcome.ok) {
    const message = `Render refused: missing ${outcome.missing.map((m) => `${m.page_id}/${m.slot_id}`).join(", ")}`;
    const updated = await persistRun(admin, row.id, { status: "failed", error: message });
    await logEvent(admin, row.id, "finalize", "error", "Finalize's re-render was refused.", { missing: outcome.missing });
    return updated;
  }

  const updated = await persistRun(admin, row.id, {
    zip_path: outcome.zipPath,
    steps: { ...row.steps, finalize: { at: now().toISOString(), zip_bytes: outcome.zipBytes } },
    status: "ready",
  });
  await logEvent(admin, row.id, "finalize", "info", `Finalized: ${outcome.zipBytes} byte zip.`);
  return updated;
}

/**
 * Advances a run by exactly ONE step. Reads `nextStep(row.status)`: null
 * means the run is already terminal (or has nothing left to do), so this is
 * a safe no-op returning `{done:true}`. Otherwise runs that single step —
 * loading whatever durable inputs it needs (template package, lead row) from
 * `admin` fresh, never assuming anything from a previous call survived in
 * memory — and persists once. Every step appends a `studio_run_events` row.
 *
 * Every step is safe to call again: prepare/render/finalize recompute from
 * durable inputs, and write only retries pages that are not yet `written`.
 */
export async function runStep(admin: SupabaseClient, row: StudioRunRow, deps: RunStepDeps): Promise<RunStepResult> {
  const step = nextStep(row.status);
  if (!step) return { done: true, row };
  const now = deps.now ?? (() => new Date());

  switch (step) {
    case "prepare":
      return { done: false, row: await runPrepare(admin, row, now) };
    case "write":
      return { done: false, row: await runWrite(admin, row, deps) };
    case "render":
      return { done: false, row: await runRender(admin, row) };
    case "finalize":
      return { done: false, row: await runFinalize(admin, row, now) };
  }
}
