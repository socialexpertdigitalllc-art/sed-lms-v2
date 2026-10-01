// lib/site-agent/worker.ts
/**
 * The Ticket Agent worker engine — runs ONLY on the box where
 * AGENT_WORKER_ENABLED=1 (the operator's Windows machine, where `agy` is
 * installed and signed in). One call = at most ONE run processed
 * (single-flight, oldest first — the Site Builder processor's discipline).
 *
 * Concurrency: a CAS claim stamps a fresh claim_id; EVERY later write is
 * guarded .eq("claim_id", …), so a reclaimed/superseded attempt matches zero
 * rows and silently discards its own result (the generation_id discipline
 * from lib/site-builder/generateRun.ts). The scratch dir is claim-scoped too
 * ({runId}-{claim prefix}), so an attempt that reclaims a stale run can never
 * wipe or collect a still-live predecessor's workspace. Cancellation rides
 * the claim guard, and the contract is precise: the discard route must set
 * claim_id: NULL (a status flip alone would NOT break the guard — the guard
 * filters on claim_id, not status); once the token is nulled, the worker's
 * next guarded patch matches nothing and the driver's shouldCancel kills the
 * child. While agy runs, a guarded keepalive patch (KEEPALIVE_MS) keeps a
 * live row's updated_at moving — that is what makes the STALE_RUNNING_MS
 * reclaim safe — and doubles as the discard listener between events.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import { unzipToMap, zipFromMap } from "@/lib/template-engine/zip";
import { buildResumePrompt, buildTaskPrompt } from "./task";
import { harvestChanges } from "./harvest";
import { summarizeEventForTail, type AgyDriver, type AgyEvent, type AgyRunOutcome } from "./agy";
import {
  AGENT_SITES_BUCKET, AGY_MAX_ATTEMPTS, AGY_MIN_ATTEMPT_MS, AGY_RETRY_DELAYS_MS, AGY_TIMEOUT_MS,
  KEEPALIVE_MS, MODELS_REFRESH_MS, PROGRESS_THROTTLE_MS, STALE_RUNNING_MS, TAIL_MAX_CHARS,
  originalZipPath, resultZipPath,
  type AgentRunRow, type AgyModel,
} from "./types";

export interface Workspace {
  /** Write the map to a scratch dir for `key`; returns its absolute path.
   *  `key` is the engine's claim-scoped scratch key, not a bare run id. */
  materialize(map: Record<string, Uint8Array>, key: string): Promise<string>;
  /** Read the scratch dir back as a relative-path map (forward slashes). */
  collect(key: string): Promise<Record<string, Uint8Array>>;
  cleanup(key: string): Promise<void>;
}

export interface WorkerDeps {
  admin: SupabaseClient;
  driver: AgyDriver;
  workspace: Workspace;
  /** Structurally matches lib/notifications/notify.ts, so the real notify
   *  drops in without an adapter (ctx is a subset of NotifyContext). */
  notify: (
    eventKey: string,
    ctx: { leadId?: string | null; ticket?: { assigned_to: string | null; created_by: string | null } | null },
    opts: { title: string; body: string; dedupKey: string; targetUrl?: string | null },
  ) => Promise<void>;
  /** Live `agy models` catalogue (listAgyModels on the worker box); MUST
   *  return [] on failure — an empty list is treated as "agy is unwell,
   *  publish nothing" so the panel's model select never goes blank. */
  listModels: () => Promise<AgyModel[]>;
  now?: () => Date;
  /** Back-off pause between agy attempts — the test seam; a real timer by default. */
  sleep?: (ms: number) => Promise<void>;
}

/** agy errors another try cannot fix: the account, its quota, or the chosen
 *  model is the problem, not the connection. Everything else agy has reported
 *  so far — stream cuts, 500/503s, socket timeouts, a sign-in token refresh
 *  that timed out at launch — cleared up on its own within minutes. */
const PERMANENT_AGY_ERROR = /not logged in|not signed in|RESOURCE_EXHAUSTED|quota|PERMISSION_DENIED|(invalid|unknown|unsupported) model/i;

/** True when this attempt failed in a way worth another try. A time-cap kill
 *  (budget spent) and a launch failure (broken worker, released below) are
 *  not; a missing result event is — that is agy dying mid-run. */
function isRetryable(o: AgyRunOutcome): boolean {
  if (o.killed || o.spawnError) return false;
  if (!o.result) return true;
  if (o.result.status === "SUCCESS") return false;
  return !PERMANENT_AGY_ERROR.test(o.result.error ?? "");
}

export type WorkerOutcome =
  | { picked: false }
  | { picked: true; runId: string; outcome: "review" | "failed" | "superseded" };

/** A storage error and an absent object are different failures: a network
 *  blip must not be reported as a missing file. */
async function download(
  admin: SupabaseClient, path: string,
): Promise<{ bytes: Uint8Array | null; error: string | null }> {
  const { data, error } = await admin.storage.from(AGENT_SITES_BUCKET).download(path);
  if (error) return { bytes: null, error: error.message || "storage error" };
  if (!data) return { bytes: null, error: null };
  return { bytes: new Uint8Array(await data.arrayBuffer()), error: null };
}

export async function processNextAgentRun(deps: WorkerDeps): Promise<WorkerOutcome> {
  const outcome = await claimAndProcessOne(deps);
  // v2 F2: refresh the published model catalogue only AFTER the run outcome is
  // decided (or when nothing was picked) — never before or during a claim, so
  // a queued run never waits on a multi-second `agy models` fetch.
  await publishModelsIfStale(deps);
  return outcome;
}

/**
 * v2 F2 — publish agy's live model catalogue to
 * app_settings.agent_worker_models ({fetched_at, models}), refetching at most
 * every MODELS_REFRESH_MS. Entirely best-effort and column-tolerant (0072 may
 * lag code locally): a read/write error or a throwing listModels changes
 * nothing about the poll's outcome. An EMPTY list writes NOTHING — a transient
 * agy failure must not blank the panel's model select.
 */
async function publishModelsIfStale(deps: WorkerDeps): Promise<void> {
  const now = deps.now ?? (() => new Date());
  try {
    const { data } = await deps.admin
      .from("app_settings")
      .select("agent_worker_models")
      .eq("singleton", true)
      .maybeSingle();
    const existing = (data as { agent_worker_models?: { fetched_at?: string } | null } | null)
      ?.agent_worker_models;
    const fetchedAt = existing?.fetched_at ? new Date(existing.fetched_at).getTime() : NaN;
    if (Number.isFinite(fetchedAt) && now().getTime() - fetchedAt < MODELS_REFRESH_MS) return;
    const models = await deps.listModels();
    if (!models.length) return;
    await deps.admin
      .from("app_settings")
      .update({ agent_worker_models: { fetched_at: now().toISOString(), models } })
      .eq("singleton", true);
  } catch { /* best-effort — the outcome already belongs to the caller */ }
}

async function claimAndProcessOne(deps: WorkerDeps): Promise<WorkerOutcome> {
  const admin = deps.admin;
  const now = deps.now ?? (() => new Date());
  const iso = () => now().toISOString();

  // Heartbeat — best-effort and column-tolerant (0071 may lag code locally).
  try {
    await admin.from("app_settings").update({ agent_worker_seen_at: iso() }).eq("singleton", true);
  } catch { /* never blocks work */ }

  // Narrow eligibility select (disk-IO rule) — queued, or running-stale.
  const { data: rows, error: selErr } = await admin
    .from("site_agent_runs")
    .select("id, status, updated_at, created_at")
    .in("status", ["queued", "running"])
    .order("created_at", { ascending: true })
    .limit(20);
  if (selErr || !rows?.length) return { picked: false };

  const nowMs = now().getTime();
  const candidate = (rows as Pick<AgentRunRow, "id" | "status" | "updated_at" | "created_at">[]).find(
    (r) => r.status === "queued" ||
      (r.status === "running" && nowMs - new Date(r.updated_at).getTime() > STALE_RUNNING_MS),
  );
  if (!candidate) return { picked: false };

  // CAS claim: single winner, fresh ownership token.
  const claimId = crypto.randomUUID();
  const { data: claimed } = await admin
    .from("site_agent_runs")
    .update({ status: "running", claim_id: claimId, error: null, updated_at: iso() })
    .eq("id", candidate.id)
    .eq("status", candidate.status)
    .eq("updated_at", candidate.updated_at)
    .select()
    .single();
  if (!claimed) return { picked: false }; // lost the race — next tick retries
  const run = claimed as AgentRunRow;

  /** Claim-scoped scratch key: two attempts at one run (stale reclaim racing
   *  a not-actually-dead predecessor) get DIFFERENT dirs, so neither can wipe
   *  or harvest the other's workspace. */
  const wsKey = `${run.id}-${claimId.slice(0, 8)}`;

  /** Guarded write; returns false when this attempt no longer owns the run
   *  (discarded, or reclaimed after a stale window). */
  const patch = async (fields: Record<string, unknown>): Promise<boolean> => {
    const { data } = await admin
      .from("site_agent_runs")
      .update({ ...fields, updated_at: iso() })
      .eq("id", run.id)
      .eq("claim_id", claimId)
      .select("id")
      .maybeSingle();
    return Boolean(data);
  };

  const fail = async (message: string): Promise<WorkerOutcome> => {
    // Ownership first: if the guarded write matches nothing, the dashboard
    // already discarded (or another attempt reclaimed) this run — no failure
    // bell, no activity row, for a failure nobody owns any more.
    const owned = await patch({ status: "failed", error: message });
    if (!owned) {
      await deps.workspace.cleanup(wsKey).catch(() => {});
      return { picked: true, runId: run.id, outcome: "superseded" };
    }
    // Audit + bell are best-effort: the row already says failed, and a
    // notification hiccup must not blow up the worker loop.
    try {
      await admin.from("activity_log").insert({
        user_id: run.created_by, action: "site_agent.run.failed",
        entity_type: run.ticket_id ? "ticket" : "lead", entity_id: run.ticket_id ?? run.lead_id,
        new_value: { run_id: run.id, error: message },
      });
      if (run.ticket_id) {
        const { data: t } = await admin
          .from("lead_tickets").select("assigned_to, created_by").eq("id", run.ticket_id).maybeSingle();
        await deps.notify("site_agent_run_failed",
          {
            leadId: run.lead_id,
            ticket: { assigned_to: (t?.assigned_to as string | null) ?? null, created_by: (t?.created_by as string | null) ?? null },
          },
          {
            title: "AI site edit failed", body: message.slice(0, 300),
            dedupKey: `site_agent_run_failed:${run.id}:${iso()}`, targetUrl: `/tickets/${run.ticket_id}`,
          });
      }
    } catch { /* the failure itself is already recorded on the row */ }
    await deps.workspace.cleanup(wsKey).catch(() => {});
    return { picked: true, runId: run.id, outcome: "failed" };
  };

  try {
    // Prompt content: a ticket run composes from its ticket; a TICKETLESS run
    // (v2 F5 — "AI edit site" on the lead screen) has ticket_id null and
    // carries its whole request in task_text. Only null-ticket AND no task
    // text is a purge orphan with nothing to do.
    type TicketRow = {
      id: string; title: string | null; assigned_to: string | null; created_by: string | null;
      lead_id: string | null; items: { id: string; body: string; sort: number; is_done: boolean }[] | null;
    };
    let ticket: TicketRow | null = null;
    if (run.ticket_id) {
      const { data } = await admin
        .from("lead_tickets")
        .select("id, title, assigned_to, created_by, lead_id, items:ticket_items(id, body, sort, is_done)")
        .eq("id", run.ticket_id)
        .maybeSingle();
      if (!data) return await fail("This run's ticket no longer exists — nothing to do.");
      ticket = data as unknown as TicketRow;
    } else if (!(run.task_text ?? "").trim()) {
      return await fail("This run has neither a ticket nor a task (retention purge?) — nothing to do.");
    }
    const lead = run.lead_id
      ? (await admin.from("leads").select("business_name").eq("id", run.lead_id).maybeSingle()).data
      : null;

    // Workspace: a revise (conversation_id set) continues from the last
    // RESULT so the agent sees its own prior work; the diff stays against
    // ORIGINAL so the change list is cumulative.
    const original = await download(admin, originalZipPath(run.id));
    if (original.error) return await fail(`original.zip could not be read from storage: ${original.error}`);
    if (!original.bytes) return await fail("original.zip is missing from storage — recreate the run.");
    const originalMap = unzipToMap(original.bytes);
    let seedMap = originalMap;
    if (run.conversation_id) {
      const prior = await download(admin, resultZipPath(run.id));
      if (prior.bytes) seedMap = unzipToMap(prior.bytes);
    }
    // ONE materialize: the scratch dir is created here and its path handed to
    // the driver — materialize wipes the dir, so a second call would destroy
    // the seeded files (fsWorkspace, Task 6).
    const cwd = await deps.workspace.materialize(seedMap, wsKey);

    const items = ticket?.items ?? [];
    // v2 F1: a run scoped to selected items feeds ONLY those to the prompt.
    // Unknown ids simply match nothing — the create route validates upstream.
    // A whole-ticket run (null item_ids) composes from the UNDONE items only:
    // that's exactly what the dialog previews, and re-requesting work already
    // marked done would undo F3's own bookkeeping.
    const scoped = Array.isArray(run.item_ids) && run.item_ids.length
      ? items.filter((i) => run.item_ids!.includes(i.id))
      : items.filter((i) => !i.is_done);
    // A ticketless run always has task_text (guarded above), which replaces
    // the composed block verbatim — the fallback title never renders for it.
    const prompt = buildTaskPrompt({
      businessName: String((lead?.business_name as string | undefined) ?? "this client"),
      ticketTitle: ticket?.title ?? "Direct change request",
      ticketItems: [...scoped].sort((a, b) => a.sort - b.sort).map((i) => i.body),
      instructions: run.instructions,
      // v2 F4: operator-edited task text replaces the composed block verbatim.
      taskText: run.task_text ?? null,
      // agy ≥1.1.26 doesn't anchor the model to the launch cwd — name it.
      workspaceDir: cwd,
    });

    // Progress: throttled tail patches; a patch matching zero rows means we
    // lost ownership (discarded) → the driver's shouldCancel kills agy.
    let tail = "";
    let lastFlush = 0;
    let cancelled = false;
    const flush = async (force = false) => {
      const t = Date.now();
      if (!force && t - lastFlush < PROGRESS_THROTTLE_MS) return;
      lastFlush = t;
      const owned = await patch({ output_tail: tail.slice(-TAIL_MAX_CHARS) });
      if (!owned) cancelled = true;
    };

    const onEvent = (e: AgyEvent) => {
      const line = summarizeEventForTail(e);
      if (!line) return;
      // agy's result.response echoes the closing agent_response text_delta
      // verbatim (both real success captures) — skip the RESULT line when
      // its trimmed text is exactly what the tail already ends with, at a
      // chunk boundary. Scoped to result on purpose: a genuinely repeated
      // narration line (say, a retried identical tool call) is real
      // progress and must be kept. Lives here so summarizeEventForTail
      // stays pure.
      if (e.kind === "result") {
        const t = line.trim();
        const prior = tail.trimEnd();
        if (t && (prior === t || prior.endsWith("\n" + t))) return;
      }
      tail += (tail ? "\n" : "") + line;
      flush().catch(() => {});
    };

    // Keepalive: agy can run for minutes without emitting an event, and the
    // stale-reclaim predicate reads updated_at. This guarded no-field patch
    // (it touches ONLY updated_at) keeps a live run visibly alive — so it can
    // never be reclaimed as stale — and doubles as the discard listener
    // between events: a missed patch flips `cancelled`, and shouldCancel
    // kills the child. It spans the retry pauses too.
    const keepalive = setInterval(() => {
      patch({}).then((owned) => { if (!owned) cancelled = true; }).catch(() => {});
    }, KEEPALIVE_MS);
    const sleep = deps.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
    // ONE budget for every attempt, so the 15-minute cap (and the stale
    // window's margin over it) holds however often the stream drops.
    const deadline = Date.now() + AGY_TIMEOUT_MS;
    let attemptPrompt = prompt;
    let attemptConversation = run.conversation_id;
    let attempts = 0;
    let outcome: AgyRunOutcome;
    try {
      for (;;) {
        attempts++;
        let started = false;
        outcome = await deps.driver(
          {
            cwd,
            prompt: attemptPrompt,
            conversationId: attemptConversation,
            timeoutMs: deadline - Date.now(),
            // v2 F2: the run's chosen model (null = Antigravity default).
            model: run.model ?? null,
            shouldCancel: () => cancelled,
          },
          (e) => {
            if (e.kind === "init" || e.kind === "step") started = true;
            onEvent(e);
          },
        );
        if (cancelled || attempts >= AGY_MAX_ATTEMPTS || !isRetryable(outcome)) break;
        const pause = AGY_RETRY_DELAYS_MS[Math.min(attempts, AGY_RETRY_DELAYS_MS.length) - 1];
        if (deadline - Date.now() - pause < AGY_MIN_ATTEMPT_MS) break;
        // A turn that got going is CONTINUED in its own conversation — its
        // edits are already on disk in cwd. One that never started is sent
        // again unchanged: swapping a revise's follow-up for "continue" would
        // silently drop the developer's instructions.
        if (started && outcome.conversationId) {
          attemptConversation = outcome.conversationId;
          attemptPrompt = buildResumePrompt({ workspaceDir: cwd });
        }
        tail += `${tail ? "\n" : ""}⟳ The connection to the AI dropped — picking the task back up in ${pause / 1000}s (try ${attempts + 1} of ${AGY_MAX_ATTEMPTS})…`;
        await flush(true);
        if (cancelled) break;
        await sleep(pause);
        if (cancelled) break;
      }
    } finally {
      clearInterval(keepalive);
    }
    await flush(true);
    if (cancelled) {
      await deps.workspace.cleanup(wsKey).catch(() => {});
      return { picked: true, runId: run.id, outcome: "superseded" };
    }
    const triedNote = attempts > 1 ? ` (gave up after ${attempts} tries)` : "";

    if (outcome.killed) return await fail("The agent hit the 15-minute time cap and was stopped.");
    if (!outcome.result) {
      if (outcome.spawnError) {
        // The CLI could not even LAUNCH on this machine (missing binary/cwd).
        // That is a broken WORKER, not a broken RUN — release the claim so a
        // healthy worker can pick it up, instead of eating the run with a
        // failure bell (a misconfigured instance once burned 5 runs this way).
        console.warn(`[site-agent] releasing run ${run.id}: agy launch failed here: ${outcome.spawnError}`);
        const { data: released } = await admin
          .from("site_agent_runs")
          .update({ status: "queued", claim_id: null, updated_at: iso() })
          .eq("id", run.id)
          .eq("claim_id", claimId)
          .select("id")
          .maybeSingle();
        if (!released) console.warn(`[site-agent] release of ${run.id} lost its claim first (discarded?)`);
        await deps.workspace.cleanup(wsKey).catch(() => {});
        return { picked: true, runId: run.id, outcome: "superseded" };
      }
      return await fail(`agy ran but produced no result event${triedNote} — check the CLI's sign-in and its log on the worker box.`);
    }
    if (outcome.result.status !== "SUCCESS") {
      return await fail(`Antigravity reported an error: ${outcome.result.error ?? "unknown"}${triedNote}`);
    }

    const edited = await deps.workspace.collect(wsKey);
    const harvested = harvestChanges(originalMap, edited);
    if (!harvested.ok) return await fail(harvested.error);

    const resultZip = zipFromMap(harvested.resultMap);
    const { error: upErr } = await admin.storage
      .from(AGENT_SITES_BUCKET)
      .upload(resultZipPath(run.id), resultZip, { upsert: true, contentType: "application/zip" });
    if (upErr) return await fail(`Could not store the edited site: ${upErr.message}`);

    const owned = await patch({
      status: "review",
      conversation_id: outcome.conversationId ?? run.conversation_id,
      files: harvested.changes,
      summary: outcome.result.response.slice(0, 4000),
      usage: outcome.result.usage,
      output_tail: tail.slice(-TAIL_MAX_CHARS),
    });
    if (!owned) {
      await deps.workspace.cleanup(wsKey).catch(() => {});
      return { picked: true, runId: run.id, outcome: "superseded" };
    }

    // The run IS in review from here — audit + bell are best-effort, so a
    // notification hiccup can never bounce a finished run through fail().
    try {
      await admin.from("activity_log").insert({
        user_id: run.created_by, action: "site_agent.run.completed",
        entity_type: run.ticket_id ? "ticket" : "lead", entity_id: run.ticket_id ?? run.lead_id,
        new_value: { run_id: run.id, changed_files: Object.keys(harvested.changes).length },
      });
      // The "ready" bell derives its audience from the ticket; a ticketless
      // run has none — its creator watches the lead panel (spec: notification
      // targeting for ticketless runs is out of scope).
      if (run.ticket_id && ticket) {
        await deps.notify("site_agent_run_ready",
          {
            leadId: run.lead_id,
            ticket: { assigned_to: ticket.assigned_to ?? null, created_by: ticket.created_by ?? null },
          },
          {
            title: "AI site edit ready for review",
            body: `${Object.keys(harvested.changes).length} file(s) changed — review and deploy from the ticket.`,
            // Per-cycle dedup (the :iso suffix): a revise cycle's second "ready"
            // bell must not be swallowed by the first cycle's dedup row.
            dedupKey: `site_agent_run_ready:${run.id}:${iso()}`, targetUrl: `/tickets/${run.ticket_id}`,
          });
      }
    } catch { /* the review row is the source of truth */ }

    await deps.workspace.cleanup(wsKey).catch(() => {});
    return { picked: true, runId: run.id, outcome: "review" };
  } catch (e) {
    return await fail(e instanceof Error ? e.message : "The agent worker crashed unexpectedly.");
  }
}
