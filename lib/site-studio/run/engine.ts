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
 *  fragments, nav item labels, AND tokenized text assets (.js/.css; see
 *  compiler/assetIdentity.ts). Mirrors `renderSite`'s own completeness check
 *  EXACTLY (including the asset scan — a template's identity manifest can
 *  include AI-invented keys tokenized into a .js/.css file just as easily as
 *  into an HTML skeleton, and missing that source here would let a key slip
 *  past `prepare` only to surface as a render-time surprise after Gate 1 was
 *  already approved). `prepare` runs this BEFORE `write` so every fact the
 *  template needs — supplied by the dossier or not — is known and (for the
 *  ones the dossier can't supply) surfaced to the operator before a single AI
 *  call is paid for, instead of only failing at `render` after every page has
 *  been written. */
function referencedIdentityKeys(tpl: CompiledTemplate): Set<string> {
  const navLabels = tpl.manifest.nav.flatMap((r) => (r.items ?? []).map((it) => it.label));
  const tokenizedAssetPaths = tpl.manifest.tokenizedAssets ?? [];
  const assetTexts = tokenizedAssetPaths.map((p) => new TextDecoder().decode(tpl.assets[p] ?? new Uint8Array()));
  const haystacks = [...Object.values(tpl.pages), ...Object.values(tpl.fragments), ...navLabels, ...assetTexts];
  const keys = new Set<string>();
  for (const s of haystacks) for (const t of findTokens(s)) if (t.kind === "id") keys.add(t.key);
  return keys;
}

/** Where a pending identity key showed up in the compiled package: total
 *  `{{id:key}}` occurrence count, and which manifest page ids reference it —
 *  purely so Gate 1's "Site facts" panel can show the operator something more
 *  useful than a bare key name ("this shows up in 3 places, on Home and
 *  Contact"). A key found directly in one page's own skeleton is credited
 *  only to that page; a key found in a shared fragment, a nav item label, or
 *  a tokenized text asset is credited to EVERY page in the manifest, since
 *  all three render on every built page (nav/footer fragments are included
 *  site-wide; a tokenized .js/.css asset ships unchanged to every page that
 *  loads it, which in practice is all of them). */
function identityUsage(tpl: CompiledTemplate, keys: string[]): Record<string, { count: number; pages: string[] }> {
  const usage: Record<string, { count: number; pages: string[] }> = {};
  for (const key of keys) usage[key] = { count: 0, pages: [] };
  if (keys.length === 0) return usage;

  const countOf = (key: string, text: string): number =>
    findTokens(text).filter((t) => t.kind === "id" && t.key === key).length;
  const addPages = (key: string, pageIds: string[]) => {
    const set = new Set(usage[key].pages);
    for (const id of pageIds) set.add(id);
    usage[key].pages = [...set];
  };

  for (const def of tpl.manifest.pages) {
    const html = tpl.pages[def.file] ?? "";
    for (const key of keys) {
      const n = countOf(key, html);
      if (n > 0) { usage[key].count += n; addPages(key, [def.id]); }
    }
  }

  const allPageIds = tpl.manifest.pages.map((p) => p.id);
  const navLabels = tpl.manifest.nav.flatMap((r) => (r.items ?? []).map((it) => it.label));
  const tokenizedAssetPaths = tpl.manifest.tokenizedAssets ?? [];
  const assetTexts = tokenizedAssetPaths.map((p) => new TextDecoder().decode(tpl.assets[p] ?? new Uint8Array()));
  const sharedTexts = [...Object.values(tpl.fragments), ...navLabels, ...assetTexts];
  for (const key of keys) {
    for (const text of sharedTexts) {
      const n = countOf(key, text);
      if (n > 0) { usage[key].count += n; addPages(key, allPageIds); }
    }
  }
  return usage;
}

function randomBase36(len: number): string {
  return Math.random().toString(36).slice(2, 2 + len).padEnd(len, "0");
}

/** Exported so routes that need the compiled manifest (Task 9's `reroll` and
 *  `images` routes) load it exactly this way, rather than triplicating this
 *  five-line fetch-and-parse per route. */
export async function loadManifest(admin: SupabaseClient, templateId: string): Promise<TemplateManifest> {
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
 *
 * `guard`, when supplied, adds `.eq("status", guard.expectStatus)` to the
 * update — the SAME optimistic-concurrency shape `claimRun` uses below, but
 * keyed on `status` instead of `updated_at` for exactly the scenario
 * `claimRun`'s own claim can't cover: a run that was CANCELLED (or otherwise
 * changed) by a concurrent actor (the control route) AFTER this step already
 * won its claim. Without this, a step's own FINAL persist — e.g.
 * `runFinalize` deciding "ready" — would unconditionally overwrite whatever
 * `status` the row holds NOW, silently resurrecting a run the operator just
 * cancelled mid-step. Every step's terminal persist (the one that decides
 * the run's new `status`) must pass `guard: { expectStatus: <the status this
 * step read at claim time>, step: <this step> }`. A zero-row update (someone
 * else already changed `status`) is NOT an error: this function re-fetches
 * the CURRENT row, logs one `studio_run_events` note explaining the
 * abandonment, and returns that current row untouched by this call's patch —
 * "abandon my status write" rather than clobber a status a human explicitly
 * set.
 */
async function persistRun(
  admin: SupabaseClient,
  id: string,
  patch: Record<string, unknown>,
  guard?: { expectStatus: RunStatus; step: RunStep },
): Promise<StudioRunRow> {
  let query = admin.from("studio_runs").update({ ...patch, updated_at: preciseNow() }).eq("id", id);
  if (guard) query = query.eq("status", guard.expectStatus);
  const { data, error } = await query.select("*").single();

  if (guard && (error || !data)) {
    const { data: current, error: currentErr } = await admin.from("studio_runs").select("*").eq("id", id).single();
    if (currentErr || !current) {
      throw new Error(
        `engine: failed to persist run "${id}" (${error?.message ?? "no data"}) and could not re-fetch it either (${currentErr?.message ?? "no data"})`,
      );
    }
    await logEvent(
      admin, id, guard.step, "warn",
      `Abandoned this step's terminal write: expected status "${guard.expectStatus}" but the run is now "${(current as StudioRunRow).status}" — someone else (a cancel, a concurrent step) changed it first.`,
    );
    return current as StudioRunRow;
  }

  if (error || !data) throw new Error(`engine: failed to persist run "${id}" (${error?.message ?? "no data"})`);
  return data as StudioRunRow;
}

/**
 * Pause/resume for the control route (Task 9). Goes through `persistRun` —
 * never a bare `.update({paused})` — for exactly the reason documented on
 * `persistRun` above: the claim CAS is keyed on `updated_at`, so flipping
 * `paused` without bumping it would leave a step that already read the OLD
 * row free to win `claimRun` and execute a full step (including an AI call)
 * after the pause was requested. This is the one and only sanctioned way to
 * change `paused` outside of `runStep` itself.
 */
export async function setRunPaused(admin: SupabaseClient, row: StudioRunRow, paused: boolean): Promise<StudioRunRow> {
  return persistRun(admin, row.id, { paused });
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
 *
 *  IDENTITY (Phase 4b revision): a template's `{{id:*}}` vocabulary is not
 *  closed — the AI identity pass (compiler/ai/identityAi.ts) deliberately
 *  mints ARBITRARY keys (`owner_name`, `city_2`, `neighborhood`, ...) for
 *  whatever the demo site's copy actually names, and the dossier this run is
 *  built from only ever supplies a fixed, closed set of nine. A template
 *  asking for a fact no lead column can ever hold used to be a hard, un-
 *  fixable dead run ("add it to the lead" is not actionable when there is no
 *  such lead field). Instead: every referenced key the dossier can't supply
 *  is seeded into `content_doc.identity` as `""` — present, so the
 *  renderer's own completeness check (`key in doc.identity`) is satisfied and
 *  `write`/`render` proceed normally — and recorded in `steps.prepare.
 *  pending_identity` (with per-key usage in `pending_identity_usage`) so
 *  Gate 1 can ask the operator to fill each one in, or explicitly leave it
 *  blank (a legitimate "skip" — the site simply renders with that spot
 *  blank). See `PATCH /api/site-studio/runs/[id]/identity` for how those
 *  facts get filled in after this step. The renderer's completeness check
 *  itself is UNCHANGED — it remains the real backstop against a key that
 *  somehow ends up absent from `identity` entirely. */
async function runPrepare(admin: SupabaseClient, row: StudioRunRow, now: () => Date): Promise<StudioRunRow> {
  if (!row.lead_id) {
    const updated = await persistRun(
      admin, row.id,
      { status: "failed", error: "This run has no lead (it may have been deleted). Start a new run against a live lead." },
      { expectStatus: row.status, step: "prepare" },
    );
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
  const pendingIdentity = [...referenced].filter((k) => !(k in doc.identity)).sort();
  // Present-but-empty, not omitted: `"" in doc.identity` reads true, which is
  // exactly what both this render check and the renderer's own rely on.
  for (const key of pendingIdentity) doc.identity[key] = "";

  const siteSlug = `${slugify(dossier.business_name) || "site"}-${randomBase36(6)}`;

  const prepareStep: NonNullable<StudioRunRow["steps"]["prepare"]> = {
    at: now().toISOString(),
    pages: doc.pages.length,
    ...(pendingIdentity.length > 0
      ? { pending_identity: pendingIdentity, pending_identity_usage: identityUsage(tpl, pendingIdentity) }
      : {}),
  };

  const updated = await persistRun(
    admin, row.id,
    {
      content_doc: doc,
      client_photos: dossier.client_photos,
      site_slug: siteSlug,
      steps: { ...row.steps, prepare: prepareStep },
      status: "preparing",
    },
    { expectStatus: row.status, step: "prepare" },
  );
  const pendingNote =
    pendingIdentity.length > 0
      ? ` This lead doesn't have ${humanizeMissingIdentity(pendingIdentity)} the template asks for — fill it in at Gate 1, or leave it blank to skip.`
      : "";
  await logEvent(
    admin, row.id, "prepare", "info",
    `Prepared ${doc.pages.length} page(s)${selection.skipped.length ? `; skipped: ${selection.skipped.join(", ")}` : ""}.${pendingNote}`,
    { skipped: selection.skipped, pending_identity: pendingIdentity },
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

  const updated = await persistRun(
    admin, row.id,
    {
      content_doc: workingDoc,
      steps: { ...row.steps, write: { pages }, images: { slots: imagesOutcome.slots } },
      status,
      ...(runError !== undefined ? { error: runError } : {}),
    },
    { expectStatus: row.status, step: "write" },
  );

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
    const updated = await persistRun(
      admin, row.id,
      { status: "failed", error: message },
      { expectStatus: row.status, step: "render" },
    );
    await logEvent(admin, row.id, "render", "error", "Render refused: content is incomplete.", { missing: result.missing });
    return updated;
  }

  const updated = await persistRun(
    admin, row.id,
    {
      steps: { ...row.steps, render: { at: new Date().toISOString(), files: Object.keys(result.files).length } },
      status: "rendering",
    },
    { expectStatus: row.status, step: "render" },
  );
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
    const updated = await persistRun(
      admin, row.id,
      { status: "failed", error: message },
      { expectStatus: row.status, step: "finalize" },
    );
    await logEvent(admin, row.id, "finalize", "error", "Finalize's re-render was refused.", { outcome });
    return updated;
  }

  const updated = await persistRun(
    admin, row.id,
    {
      zip_path: outcome.zipPath,
      steps: { ...row.steps, finalize: { at: now().toISOString(), zip_bytes: outcome.zipBytes } },
      status: "ready",
    },
    { expectStatus: row.status, step: "finalize" },
  );
  await logEvent(admin, row.id, "finalize", "info", `Finalized: ${outcome.zipBytes} byte zip.`);
  return updated;
}

export type RefreshZipOutcome = { ok: true } | { ok: false; warning: string };

/**
 * Re-finalizes a `ready` run's zip after a Gate 2 edit (content, theme,
 * revert, reroll, or an image pick) — the `content`/`theme`/`revert`/
 * `reroll`/`images` routes all call this, once, right after their own
 * successful `content_doc` write, whenever the row they just persisted has
 * `status === "ready"`.
 *
 * WHY THIS EXISTS: `finalize` (see `runFinalize` above / `finalizeRun` in
 * `./finalize`) writes `zip_path` once, the FIRST time a run reaches
 * "ready". Gate 2 exists specifically so an operator can keep editing AFTER
 * that point — but nothing re-ran finalize, so every Gate 2 edit landed in
 * `content_doc` while the deployed/downloadable zip at `zip_path` silently
 * kept serving the PRE-edit bytes. An operator who edits, then deploys,
 * would get their old content back with no error — the same "never trust a
 * stale artifact" lesson `finalize` itself embodies (see that file's own doc
 * comment on why it always re-renders from scratch rather than trusting a
 * prior `render` step). Calling `finalizeRun` again is exactly what fixes
 * this, and is safe to do on every edit: `finalizeRun` is pure render + zip
 * + `upsert:true` upload, so calling it once or five times on the same
 * `content_doc` produces the same bytes either way.
 *
 * RE-READS the run FROM THE DATABASE rather than trusting a row the caller
 * already has in hand — the caller's own write may have raced another editor
 * (both are running under this same discipline), so the freshest
 * `content_doc` is whatever is actually in the table right now, not
 * necessarily what the caller's own CAS write just returned.
 *
 * DOES NOT bump `updated_at`: the zip is a DERIVED artifact, not the source
 * of truth the CAS check in `content`/`theme`/`revert`/`reroll`/`images` is
 * protecting — bumping it here would invalidate the `updated_at` token the
 * client just received from ITS OWN write, making that client's very next
 * edit fail its CAS for no reason (a self-inflicted 409 on every second Gate
 * 2 edit). A plain `.update(...)` that never sets `updated_at` leaves the
 * column exactly as the content write left it, matching real Postgres (no
 * trigger touches it — see migration 0053) and keeping the CAS token the
 * client is holding valid.
 *
 * NEVER THROWS. A render refusal (missing slot) or a missing picked asset is
 * NOT this call's failure to report as a 500 — the operator's edit already
 * persisted successfully, and the ONLY thing wrong is that the deployable
 * build is now stale until whatever's missing is fixed. Returns
 * `{ok:false, warning}` for that case (and for any other unexpected
 * failure — a bad manifest, storage being down) so the calling route can
 * still answer 200 for the edit itself while surfacing the warning
 * verbatim; the caller must never treat `{ok:false}` here as reason to
 * discard the edit or answer anything but success for the request the
 * operator actually made.
 */
export async function refreshFinalizedZip(admin: SupabaseClient, runId: string): Promise<RefreshZipOutcome> {
  try {
    const { data: row, error } = await admin.from("studio_runs").select("*").eq("id", runId).single();
    if (error || !row) {
      return { ok: false, warning: "Could not reload this run to refresh its deployable build." };
    }
    const run = row as StudioRunRow;
    // Nothing to refresh: either the edit that triggered this call raced a
    // status change away from "ready", or there is no content yet.
    if (run.status !== "ready" || !run.content_doc) return { ok: true };

    const manifest = await loadManifest(admin, run.template_id);
    const tpl = await loadPackage(admin, run.template_id, manifest);
    const outcome = await finalizeRun(admin, tpl, run.content_doc, run.id, {
      loadAssetBytes: (assetId) => loadAssetBytes(admin, assetId),
    });

    if (!outcome.ok) {
      const detail =
        "missingAssets" in outcome
          ? `missing image asset(s): ${outcome.missingAssets.join(", ")}`
          : `missing ${outcome.missing.map((m) => `${m.page_id}/${m.slot_id}`).join(", ")}`;
      await logEvent(
        admin, runId, "finalize", "warn",
        `Gate 2 edit saved, but re-finalizing the deployable zip was refused: ${detail}`,
        { outcome },
      );
      return {
        ok: false,
        warning: `Your edit was saved, but the deployable/downloadable build is now stale (${detail}) until this is fixed.`,
      };
    }

    const { error: updateError } = await admin
      .from("studio_runs")
      .update({
        zip_path: outcome.zipPath,
        steps: { ...run.steps, finalize: { at: new Date().toISOString(), zip_bytes: outcome.zipBytes } },
      })
      .eq("id", runId)
      .select("id")
      .single();
    if (updateError) {
      return { ok: false, warning: `Your edit was saved, but recording the refreshed build failed: ${updateError.message}` };
    }

    await logEvent(admin, runId, "finalize", "info", `Refreshed the deployable zip after a Gate 2 edit (${outcome.zipBytes} bytes).`);
    return { ok: true };
  } catch (e) {
    const message = e instanceof Error ? e.message : "unknown error";
    await logEvent(admin, runId, "finalize", "warn", `Gate 2 edit saved, but refreshing the deployable zip failed: ${message}`);
    return { ok: false, warning: `Your edit was saved, but the deployable build could not be refreshed (${message}).` };
  }
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
