import type { SupabaseClient } from "@supabase/supabase-js";
import { callForTask } from "@/lib/ai-tools/providers/run";
import type { CompiledTemplate, ContentDoc, TemplateManifest } from "../schema";
import { manifestSchema } from "../schema";
import { findTokens } from "../tokens";
import { renderSite } from "../render/renderer";
import { loadPackage } from "../service/templates";
import { buildDossier, type Dossier } from "./dossier";
import { selectPages, slugify } from "./pageSelect";
import { seedContentDoc } from "./seed";
import { writePage, type AiCall, type WriteResult } from "./writer";
import { applyWritten } from "./applyWritten";
import { finalizeRun } from "./finalize";
import { nextStep, type PageWriteState, type RunStep, type RunStatus, type SlotImageState, type StudioRunRow } from "./types";
import { sourceImages } from "./imageSource";
import { searchPexels as pexelsSearch, type PexelsResult } from "../assets/pexels";
import { STUDIO_ASSETS_BUCKET } from "../assets/rehost";

/** Production AiCall: routes the per-page write through the task router on
 *  its own registered task ("content_write") — kept separate from
 *  "template_compile" so an operator retuning the compiler's model does not
 *  silently retune the Writer too; they are different jobs with different
 *  content-safety requirements. */
export const productionWriterCall: AiCall = async (system, user) => {
  const { text } = await callForTask("content_write", system, user, { maxTokens: 8000, temperature: 0.4 });
  return { text };
};

/** Production image search: the real Pexels client (reads PEXELS_API_KEY
 *  from the environment on its own). Routes wire this in explicitly, same
 *  pattern as `productionWriterCall` — kept as an explicit opt-in rather
 *  than `runWrite`'s own default so nothing here ever depends on whatever
 *  happens to be in `process.env` at test time (see the hermetic default on
 *  `RunStepDeps.searchPexels` below). */
export const productionSearchPexels = (query: string): Promise<PexelsResult> => pexelsSearch(query);

/** The hermetic default when a caller supplies no `searchPexels`: no
 *  candidates, no network, ever. Sourcing is an enhancement (spec §8) — a
 *  run must reach the gate with empty candidate lists rather than depend on
 *  an implicit environment default making a live call. */
const noPexelsConfigured = async (): Promise<PexelsResult> => ({
  ok: false,
  error: "no searchPexels configured for this run",
});

export interface RunStepDeps {
  aiCall: AiCall;
  /** Injectable clock — tests pin it; production omits it. */
  now?: () => Date;
  /** Image search for the write phase's parallel sourcing step. Production
   *  routes pass `productionSearchPexels`; omitting it (as most tests do,
   *  and as any test not exercising sourcing may) is safe and hermetic —
   *  see `noPexelsConfigured`. */
  searchPexels?: (query: string) => Promise<PexelsResult>;
}

export interface RunStepResult {
  done: boolean;
  row: StudioRunRow;
  /** False only when this call lost the race to claim the run — another
   *  concurrent call already advanced it between this call's read and its
   *  claim attempt. When false, `row` is simply the row as it was passed in:
   *  no work was done and, critically, no AI call was made. Always true for
   *  the done:true no-op case (nothing to claim) and for every step that
   *  actually ran. Also true (nothing to "lose") for the paused short-circuit
   *  below, since that never even attempts a claim. */
  claimed: boolean;
  /** True when this call did nothing because the run is paused — checked
   *  BEFORE the claim, so a paused run makes no claim and no AI call. */
  paused?: boolean;
}

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

/**
 * A `timestamptz`-valid ISO string with sub-millisecond entropy appended.
 * Plain `new Date().toISOString()` truncates to milliseconds — and the exact
 * scenario the claim below exists to stop (a double-click, two racing
 * requests) can easily put TWO writes inside the same millisecond. If a
 * claim's new value and the value a loser compares against ever collide as
 * STRINGS, the CAS silently stops distinguishing "unchanged" from "changed".
 * A per-process monotonic counter, cycled into the microsecond digits
 * Postgres `timestamptz` already accepts (up to 6 fractional digits), makes
 * every call from THIS process produce a distinct value even when several
 * land in the same millisecond — still a valid, still-basically-accurate
 * timestamp, not a marker value smuggled into a real column. It does not
 * protect against a same-microsecond collision from a genuinely SEPARATE
 * process racing this one, but that residual window is astronomically
 * narrower than the millisecond one a plain `toISOString()` left open.
 */
let claimSeq = 0;
function preciseNow(): string {
  const iso = new Date().toISOString(); // "...sss.SSSZ"
  claimSeq = (claimSeq + 1) % 1000;
  return `${iso.slice(0, -1)}${String(claimSeq).padStart(3, "0")}Z`;
}

/**
 * CONTRACT any writer of `studio_runs` must honour: `claimRun`'s CAS below
 * is keyed on `updated_at`, so ANY row mutation that must be visible to an
 * in-flight (or about-to-be-called) `runStep` — most notably flipping
 * `paused` — MUST bump `updated_at` in the same statement. A bare
 * `.update({paused: true})` that skips this leaves a step that already read
 * the row (with its OLD `updated_at`) free to win its claim and run a full
 * step (including an AI call) after the pause was requested, since the CAS
 * predicate would still match. This function always bumps it (via
 * `preciseNow()`) for exactly this reason; Task 9's control route (pause/
 * resume/cancel) must go through this same path, not a raw `.update()`.
 */
async function persistRun(admin: SupabaseClient, id: string, patch: Record<string, unknown>): Promise<StudioRunRow> {
  const { data, error } = await admin
    .from("studio_runs")
    .update({ ...patch, updated_at: preciseNow() })
    .eq("id", id)
    .select("*")
    .single();
  if (error || !data) throw new Error(`engine: failed to persist run "${id}" (${error?.message ?? "no data"})`);
  return data as StudioRunRow;
}

/**
 * Optimistic claim: before doing any work (and before making any AI call),
 * atomically re-touch the row's `updated_at`, guarded by the exact value
 * this caller read it at. Postgres only lets ONE concurrent `UPDATE ...
 * WHERE id = $1 AND updated_at = $2` succeed on the same row — the loser's
 * predicate no longer matches once the winner has committed a fresh
 * `updated_at` — so this is a real single-winner race, not just a
 * best-effort check. `updated_at` is used rather than `status` deliberately:
 * this table has no separate claim/heartbeat column by design (migration
 * 0053), and stamping a transitional "claimed" status here would corrupt
 * the meaning `nextStep`/`RUNNING_STATUS` already give the status column
 * (see the note on `nextStep`) — `updated_at` gives the same single-winner
 * guarantee without touching that. See `preciseNow` for why this doesn't
 * just call `new Date().toISOString()` directly. See `persistRun`'s own
 * comment for the contract this CAS imposes on every OTHER writer of this
 * row (e.g. a future pause/resume route): skip the `updated_at` bump and a
 * stale-read step can still win this claim after the mutation.
 */
async function claimRun(admin: SupabaseClient, row: StudioRunRow): Promise<StudioRunRow | null> {
  const { data, error } = await admin
    .from("studio_runs")
    .update({ updated_at: preciseNow() })
    .eq("id", row.id)
    .eq("updated_at", row.updated_at)
    .select("*")
    .single();
  if (error || !data) return null;
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

  const { doc } = seedContentDoc(manifest, dossier, selection.pages, now());

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

/** Sources image candidates for every image slot exactly ONCE per run. If
 *  `row.steps.images` is already present, this is a pure no-op returning the
 *  existing slots unchanged — a crash-retry of the write step (which always
 *  re-checks `row.steps.images` fresh from what was last persisted) must
 *  never re-query Pexels for slots that were already sourced. Never throws
 *  and never fails the run: `sourceImages` itself already degrades a Pexels
 *  outage to library-only candidates; this wrapper just also decides
 *  whether to call it at all, and carries its one-per-call warning out so
 *  the caller can log it through the run's own event stream (`sourceImages`'s
 *  `log` hook is synchronous; `logEvent` is not, so it can't be called
 *  directly from inside that hook). */
async function sourceImagesOnce(
  admin: SupabaseClient,
  row: StudioRunRow,
  manifest: TemplateManifest,
  doc: ContentDoc,
  dossier: Dossier,
  deps: RunStepDeps,
): Promise<{ slots: Record<string, SlotImageState>; warnings: string[] }> {
  if (row.steps.images?.slots) return { slots: row.steps.images.slots, warnings: [] };

  const warnings: string[] = [];
  const searchPexels = deps.searchPexels ?? noPexelsConfigured;
  try {
    const slots = await sourceImages(
      { admin, searchPexels, log: (_level, message) => warnings.push(message) },
      manifest, doc, dossier, row.lead_id,
    );
    return { slots, warnings };
  } catch (e) {
    // Belt-and-braces: sourceImages is documented to never throw, but
    // sourcing is an enhancement, never a cause of run failure — a bug here
    // must still degrade to "no candidates", not fail the whole write step.
    warnings.push(`image sourcing crashed unexpectedly: ${e instanceof Error ? e.message : String(e)}`);
    return { slots: {}, warnings };
  }
}

/** Writes every PENDING doc-page in parallel (one AI call each, via
 *  `Promise.allSettled` so one page's failure can never block another's
 *  result from landing), alongside image sourcing for every image slot
 *  (`Promise.all` — sourcing never depends on the write outcome and must
 *  never gate on it, or vice versa). "Pending" = not yet `written`, and
 *  under the 2-attempt cap — so re-running this step (status stays unchanged
 *  while any page remains incomplete, letting `nextStep` route back here)
 *  naturally retries ONLY the pages that still need it; an already-written
 *  page is never re-called, and `sourceImagesOnce` never re-sources an
 *  already-sourced slot either.
 *
 *  GATE 1: once every doc-page is `written` AND images are sourced, the run
 *  parks at "reviewing" (or skips straight to "approved" when
 *  `options.auto` is set) — never "writing", which is dead (see types.ts).
 *  A page that has now EXHAUSTED its attempts and still isn't written can
 *  never become written by retrying — retrying it forever would wedge the
 *  run at this status permanently (every `POST /step` a no-op forever,
 *  silently), which is exactly the orphaned-run class the short-step design
 *  exists to prevent. So once at least one unwritten page has hit the cap,
 *  the RUN itself fails, naming the stuck page(s) and their last error —
 *  never a silent, endless "will retry" that no longer will. */
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

  const [settled, imagesOutcome] = await Promise.all([
    Promise.allSettled(
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
    ),
    sourceImagesOnce(admin, row, manifest, doc, dossier, deps),
  ]);

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

  const notWritten = doc.pages.map((_, i) => i).filter((i) => pages[String(i)]?.status !== "written");
  const allWritten = notWritten.length === 0;
  const stuck = notWritten.filter((i) => (pages[String(i)]?.attempts ?? 0) >= MAX_WRITE_ATTEMPTS);

  let status: RunStatus = row.status; // default: unchanged, still retryable
  let runError: string | undefined;
  let level: "info" | "warn" | "error" = "warn";
  let message: string;
  let gateEvent: "gate_opened" | "gate_skipped_auto" | null = null;

  if (allWritten) {
    status = row.options.auto ? "approved" : "reviewing";
    level = "info";
    message = `All ${doc.pages.length} page(s) written.`;
    gateEvent = row.options.auto ? "gate_skipped_auto" : "gate_opened";
  } else if (stuck.length > 0) {
    // At least one page can never become "written" by retrying — fail the
    // RUN rather than leaving it retryable forever (see the doc comment
    // above). Pages that are merely failed-but-still-under-budget don't
    // block this; only truly exhausted ones do.
    status = "failed";
    level = "error";
    const details = stuck
      .map((i) => `"${doc.pages[i].page_id}" (page ${i}): ${pages[String(i)]?.error ?? "unknown error"}`)
      .join("; ");
    runError = `Write failed: ${stuck.length} page(s) exhausted ${MAX_WRITE_ATTEMPTS} write attempt(s) — ${details}`;
    message = runError;
  } else {
    message = `${notWritten.length} page(s) not yet written; will retry on the next step call.`;
  }

  const updated = await persistRun(admin, row.id, {
    content_doc: workingDoc,
    steps: { ...row.steps, write: { pages }, images: { slots: imagesOutcome.slots } },
    status,
    ...(runError !== undefined ? { error: runError } : {}),
  });

  await logEvent(admin, row.id, "write", level, message, { pages });
  for (const warning of imagesOutcome.warnings) {
    await logEvent(admin, row.id, "write", "warn", warning);
  }
  if (gateEvent) {
    await logEvent(admin, row.id, "write", "info", gateEvent);
  }

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

/** Loads a picked asset's bytes for `resolveAssets`, straight from the
 *  `studio_assets` row + the `studio-assets` bucket (assets/rehost.ts's
 *  private bucket). Returns null (never throws) on any failure — a missing
 *  row, a download error — exactly what `resolveAssets` treats as "this
 *  asset failed to resolve" and reports in `missing`. */
async function loadAssetBytes(admin: SupabaseClient, assetId: string): Promise<import("./resolveAssets").LoadedAsset | null> {
  const { data: row, error: rowError } = await admin.from("studio_assets").select("*").eq("id", assetId).single();
  if (rowError || !row) return null;
  const storagePath = (row as { storage_path: string }).storage_path;
  const contentType = (row as { content_type: string }).content_type;
  const { data, error } = await admin.storage.from(STUDIO_ASSETS_BUCKET).download(storagePath);
  if (error || !data) return null;
  const bytes = new Uint8Array(await data.arrayBuffer());
  return { bytes, contentType, storagePath };
}

/** Re-renders from scratch (never trusts `render`'s prior output — see
 *  finalize.ts), resolving every picked `asset:` slot into a real file along
 *  the way (see finalize.ts's own doc comment), zips, and uploads. */
async function runFinalize(admin: SupabaseClient, row: StudioRunRow, now: () => Date): Promise<StudioRunRow> {
  if (!row.content_doc) throw new Error("engine: finalize step reached before prepare completed");

  const manifest = await loadManifest(admin, row.template_id);
  const tpl = await loadPackage(admin, row.template_id, manifest);
  const outcome = await finalizeRun(admin, tpl, row.content_doc, row.id, {
    loadAssetBytes: (assetId) => loadAssetBytes(admin, assetId),
  });

  if (!outcome.ok) {
    const message =
      "missingAssets" in outcome
        ? `Finalize refused: picked image(s) failed to resolve — missing asset(s): ${outcome.missingAssets.join(", ")}`
        : `Render refused: missing ${outcome.missing.map((m) => `${m.page_id}/${m.slot_id}`).join(", ")}`;
    const updated = await persistRun(admin, row.id, { status: "failed", error: message });
    await logEvent(admin, row.id, "finalize", "error", "Finalize's re-render was refused.", { outcome });
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
 * a safe no-op returning `{done:true, claimed:true}`. Otherwise it first
 * CLAIMS the row (see `claimRun`) — if a concurrent call already advanced
 * this run since `row` was read, the claim fails and this returns
 * immediately with `claimed:false`, doing no work and making no AI call.
 * This is what stops two overlapping `POST /step` calls (a double-click, a
 * timeout-triggered retry, two open tabs) from paying for the same page
 * twice. Only the caller that wins the claim runs the step — loading
 * whatever durable inputs it needs (template package, lead row) from
 * `admin` fresh, never assuming anything from a previous call survived in
 * memory — and persists once. Every step appends a `studio_run_events` row.
 *
 * Every step is safe to call again: prepare/render/finalize recompute from
 * durable inputs, and write only retries pages that are not yet `written`.
 *
 * PAUSE: checked FIRST, before `nextStep` even matters and before any claim
 * is attempted — a paused run makes no claim and no AI call, full stop. This
 * is deliberately a plain boolean flag on the row, not a status (see
 * types.ts): Stop/Pause/Resume must remember exactly where the run was, and
 * a transitional "paused" status would corrupt the meaning `nextStep` and
 * `RUNNING_STATUS` already give the status column.
 */
export async function runStep(admin: SupabaseClient, row: StudioRunRow, deps: RunStepDeps): Promise<RunStepResult> {
  if (row.paused) return { done: false, row, claimed: false, paused: true };

  const step = nextStep(row.status);
  if (!step) return { done: true, row, claimed: true };
  const now = deps.now ?? (() => new Date());

  const claimed = await claimRun(admin, row);
  if (!claimed) return { done: false, row, claimed: false };

  switch (step) {
    case "prepare":
      return { done: false, row: await runPrepare(admin, claimed, now), claimed: true };
    case "write":
      return { done: false, row: await runWrite(admin, claimed, deps), claimed: true };
    case "render":
      return { done: false, row: await runRender(admin, claimed), claimed: true };
    case "finalize":
      return { done: false, row: await runFinalize(admin, claimed, now), claimed: true };
  }
}
