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
 * from lib/site-builder/generateRun.ts). Cancellation rides the same guard:
 * discard flips status, the next guarded write matches nothing, and the
 * driver's shouldCancel kills the child.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import { unzipToMap, zipFromMap } from "@/lib/template-engine/zip";
import { buildTaskPrompt } from "./task";
import { harvestChanges } from "./harvest";
import { summarizeEventForTail, type AgyDriver } from "./agy";
import {
  AGENT_SITES_BUCKET, AGY_TIMEOUT_MS, PROGRESS_THROTTLE_MS, STALE_RUNNING_MS,
  TAIL_MAX_CHARS, originalZipPath, resultZipPath, type AgentRunRow,
} from "./types";

export interface Workspace {
  /** Write the map to a scratch dir; returns its absolute path. */
  materialize(map: Record<string, Uint8Array>, runId: string): Promise<string>;
  /** Read the scratch dir back as a relative-path map (forward slashes). */
  collect(runId: string): Promise<Record<string, Uint8Array>>;
  cleanup(runId: string): Promise<void>;
}

export interface WorkerDeps {
  admin: SupabaseClient;
  driver: AgyDriver;
  workspace: Workspace;
  notify: (eventKey: string, ctx: Record<string, unknown>, opts: {
    title: string; body: string; dedupKey: string; targetUrl?: string | null;
  }) => Promise<void>;
  now?: () => Date;
}

export type WorkerOutcome =
  | { picked: false }
  | { picked: true; runId: string; outcome: "review" | "failed" | "superseded" };

async function download(admin: SupabaseClient, path: string): Promise<Uint8Array | null> {
  const { data } = await admin.storage.from(AGENT_SITES_BUCKET).download(path);
  if (!data) return null;
  return new Uint8Array(await data.arrayBuffer());
}

export async function processNextAgentRun(deps: WorkerDeps): Promise<WorkerOutcome> {
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
    await patch({ status: "failed", error: message });
    // Audit + bell are best-effort: the row already says failed, and a
    // notification hiccup must not blow up the worker loop.
    try {
      await admin.from("activity_log").insert({
        user_id: run.created_by, action: "site_agent.run.failed",
        entity_type: "ticket", entity_id: run.ticket_id, new_value: { run_id: run.id, error: message },
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
    await deps.workspace.cleanup(run.id).catch(() => {});
    return { picked: true, runId: run.id, outcome: "failed" };
  };

  try {
    // Ticket + lead give the prompt its content; a purged ticket = no task.
    if (!run.ticket_id) return await fail("This run's ticket no longer exists (retention purge?) — nothing to do.");
    const { data: ticket } = await admin
      .from("lead_tickets")
      .select("id, title, assigned_to, created_by, lead_id, items:ticket_items(body, sort)")
      .eq("id", run.ticket_id)
      .maybeSingle();
    if (!ticket) return await fail("This run's ticket no longer exists — nothing to do.");
    const lead = run.lead_id
      ? (await admin.from("leads").select("business_name").eq("id", run.lead_id).maybeSingle()).data
      : null;

    // Workspace: a revise (conversation_id set) continues from the last
    // RESULT so the agent sees its own prior work; the diff stays against
    // ORIGINAL so the change list is cumulative.
    const original = await download(admin, originalZipPath(run.id));
    if (!original) return await fail("original.zip is missing from storage — recreate the run.");
    const originalMap = unzipToMap(original);
    let seedMap = originalMap;
    if (run.conversation_id) {
      const prior = await download(admin, resultZipPath(run.id));
      if (prior) seedMap = unzipToMap(prior);
    }
    // ONE materialize: the scratch dir is created here and its path handed to
    // the driver — materialize wipes the dir, so a second call would destroy
    // the seeded files (fsWorkspace, Task 6).
    const cwd = await deps.workspace.materialize(seedMap, run.id);

    const items = ((ticket.items as { body: string; sort: number }[] | null) ?? []);
    const prompt = buildTaskPrompt({
      businessName: String((lead?.business_name as string | undefined) ?? "this client"),
      ticketTitle: (ticket.title as string | null) ?? "Untitled change request",
      ticketItems: [...items].sort((a, b) => a.sort - b.sort).map((i) => i.body),
      instructions: run.instructions,
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

    const outcome = await deps.driver(
      {
        cwd,
        prompt,
        conversationId: run.conversation_id,
        timeoutMs: AGY_TIMEOUT_MS,
        shouldCancel: () => cancelled,
      },
      (e) => {
        const line = summarizeEventForTail(e);
        if (line) {
          tail += (tail ? "\n" : "") + line;
          flush().catch(() => {});
        }
      },
    );
    await flush(true);
    if (cancelled) {
      await deps.workspace.cleanup(run.id).catch(() => {});
      return { picked: true, runId: run.id, outcome: "superseded" };
    }

    if (outcome.killed) return await fail("The agent hit the 15-minute time cap and was stopped.");
    if (!outcome.result) return await fail("agy produced no result event — is the CLI installed and signed in on this box?");
    if (outcome.result.status !== "SUCCESS") {
      return await fail(`Antigravity reported an error: ${outcome.result.error ?? "unknown"}`);
    }

    const edited = await deps.workspace.collect(run.id);
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
      await deps.workspace.cleanup(run.id).catch(() => {});
      return { picked: true, runId: run.id, outcome: "superseded" };
    }

    // The run IS in review from here — audit + bell are best-effort, so a
    // notification hiccup can never bounce a finished run through fail().
    try {
      await admin.from("activity_log").insert({
        user_id: run.created_by, action: "site_agent.run.completed",
        entity_type: "ticket", entity_id: run.ticket_id,
        new_value: { run_id: run.id, changed_files: Object.keys(harvested.changes).length },
      });
      await deps.notify("site_agent_run_ready",
        {
          leadId: run.lead_id,
          ticket: { assigned_to: (ticket.assigned_to as string | null) ?? null, created_by: (ticket.created_by as string | null) ?? null },
        },
        {
          title: "AI site edit ready for review",
          body: `${Object.keys(harvested.changes).length} file(s) changed — review and deploy from the ticket.`,
          dedupKey: `site_agent_run_ready:${run.id}`, targetUrl: `/tickets/${run.ticket_id}`,
        });
    } catch { /* the review row is the source of truth */ }

    await deps.workspace.cleanup(run.id).catch(() => {});
    return { picked: true, runId: run.id, outcome: "review" };
  } catch (e) {
    return await fail(e instanceof Error ? e.message : "The agent worker crashed unexpectedly.");
  }
}
