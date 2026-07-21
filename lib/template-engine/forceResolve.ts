// Bring a generation to rest when NOBODY is going to do it cooperatively.
//
// The cooperative path (control.ts + abortRegistry.ts) is the right one and
// stays the default: a live runner is told to stop, unwinds, and writes its own
// terminal row. This file is what happens when there is no live runner —
// because the process was replaced by a deploy, because the host recycled it, or
// because the operator has decided they know better and pressed Force stop. In
// that world the flag has no reader, and something else has to make the
// transition or the run stays "building" forever (see liveness.ts for the
// incident).
//
// It is deliberately the SAME set of writes the at-rest path in /pause and
// /cancel has always performed — status, control cleared, queue rows resolved,
// artefacts removed on a cancel — so a force-resolved run is indistinguishable
// from one that stopped politely, and /retry accepts it exactly the same way.

import type { SupabaseClient } from "@supabase/supabase-js";
import { removeGenerationArtifacts } from "./cleanup";
import { abortGeneration } from "./abortRegistry";
import { CANCELLABLE_STATUSES } from "./control";
import { IN_FLIGHT_STATUSES } from "./liveness";
import type { GenStep } from "./types";

/** Statuses a force-resolve will transition FROM, unless the caller narrows it. */
const DEFAULT_FROM = IN_FLIGHT_STATUSES as readonly string[];

/** Everything that is not finished — what deleting a lead has to clear up after. */
const UNFINISHED_STATUSES = CANCELLABLE_STATUSES as readonly string[];

/**
 * A run's step timeline with every unfinished step rolled back to `pending`.
 * Pure — the only part of this file worth unit-testing without a database.
 */
export function rollBackRunningSteps(steps: GenStep[]): GenStep[] {
  return steps.map((s) => (s.status === "running" ? { ...s, status: "pending" as const, started_at: undefined } : s));
}

/** Defensive read of `template_generations.steps` — DB JSON, shape not guaranteed. */
async function readSteps(admin: SupabaseClient, generationId: string): Promise<GenStep[]> {
  const { data } = await admin.from("template_generations").select("steps").eq("id", generationId).maybeSingle();
  const raw = (data as { steps?: unknown } | null)?.steps;
  if (!Array.isArray(raw)) return [];
  return raw.filter(
    (s): s is GenStep =>
      !!s && typeof s === "object" && typeof (s as GenStep).key === "string" && typeof (s as GenStep).status === "string",
  );
}

export interface ForceResolveOptions {
  /** Where the run comes to rest. Cancel is terminal and deletes artefacts. */
  mode: "cancel" | "pause";
  /** CAS guard: only transition if the row is still in one of these statuses. */
  from?: readonly string[];
  /** Recorded on the generation so the operator can see WHY it stopped by itself. */
  reason?: string;
}

/**
 * Force a generation to `cancelled`/`paused` and clear everything that would
 * keep it looking alive.
 *
 * Order matters and is the same as the at-rest path's:
 *  1. CAS the status transition. Losing the CAS means a runner (or another
 *     click) got there first — the correct outcome, and we do nothing else.
 *  2. Resolve the queue rows. `pending` rows are deleted so nothing re-runs a
 *     stopped run; the `processing` row — the one that wedged the whole queue in
 *     the incident, because tge_claim_next() hands out no work while anything is
 *     processing — is marked `failed` with a readable reason rather than left
 *     for the 20-minute stale reclaim to re-queue.
 *  3. On a cancel, delete the partial build artefacts. Best-effort by
 *     construction (removeGenerationArtifacts never throws): a bucket that
 *     refuses to delete must not stop the run from being recorded as stopped.
 *
 * Returns true when this call is the one that resolved the run.
 */
export async function forceResolveGeneration(
  admin: SupabaseClient,
  generationId: string,
  opts: ForceResolveOptions,
): Promise<boolean> {
  const cancel = opts.mode === "cancel";
  const now = new Date().toISOString();
  // Steps left at `running` are the ones the dead process never finished. They
  // carry no output, and leaving them `running` is precisely the lie this whole
  // change exists to stop — the timeline would keep spinning on a resolved run.
  // Same rollback persistHalt does when a runner unwinds properly.
  const steps = rollBackRunningSteps(await readSteps(admin, generationId));
  const { data: resolved } = await admin
    .from("template_generations")
    .update({
      status: cancel ? "cancelled" : "paused",
      control: null,
      paused_at: cancel ? null : now,
      error: opts.reason ?? null,
      steps,
      // A pause keeps `current_step` — it is the "Paused at …" label, and it is
      // truthful. A cancel is terminal and points at nothing.
      ...(cancel ? { current_step: null } : {}),
      updated_at: now,
      // Nothing may point at build output a cancel is about to delete.
      ...(cancel ? { zip_path: null } : {}),
    })
    .eq("id", generationId)
    .in("status", [...(opts.from ?? DEFAULT_FROM)])
    .select("id")
    .maybeSingle();
  if (!resolved) return false;

  await admin.from("template_gen_queue").delete().eq("generation_id", generationId).eq("status", "pending");
  await admin
    .from("template_gen_queue")
    .update({
      status: "failed",
      error: (opts.reason ?? "Run force-resolved").slice(0, 500),
      finished_at: now,
    })
    .eq("generation_id", generationId)
    .eq("status", "processing");

  if (cancel) await removeGenerationArtifacts(admin, generationId);
  return true;
}

/**
 * Stop every unfinished generation belonging to leads that have just been
 * deleted, and clean up after them.
 *
 * In the incident the operator deleted the lead to be rid of the stuck build and
 * the generation outlived it: a soft-deleted lead (`leads.deleted_at`) leaves
 * its `template_generations` rows exactly as they were, so the run kept
 * "building", its queue row kept blocking the pipeline, and the ghost was now
 * unreachable through the UI as well — /pause and /cancel both 404 when the lead
 * is soft-deleted, so it could not even be stopped by hand.
 *
 * Called from the delete routes in the SAME request, and deliberately
 * NON-FATAL: cleaning up after a build must never be able to stop a lead from
 * being deleted. Every failure is swallowed and the count returned is only for
 * logging. Returns how many runs it brought to rest.
 */
export async function cancelGenerationsForLeads(
  admin: SupabaseClient,
  leadIds: string[],
  reason = "The lead this website was being generated for was deleted.",
): Promise<number> {
  if (leadIds.length === 0) return 0;
  let stopped = 0;
  try {
    const { data } = await admin
      .from("template_generations")
      .select("id, status")
      .in("lead_id", leadIds)
      .in("status", [...UNFINISHED_STATUSES]);
    for (const row of (data ?? []) as { id: string }[]) {
      try {
        // If a runner for it is live in THIS process, abort it too — otherwise it
        // would keep burning AI calls for a lead that no longer exists.
        abortGeneration(row.id, "cancel");
        if (await forceResolveGeneration(admin, row.id, { mode: "cancel", from: UNFINISHED_STATUSES, reason })) {
          stopped++;
        }
      } catch {
        // one stubborn generation must not block the rest, or the delete
      }
    }
  } catch {
    // cleanup is best-effort; the lead is deleted either way
  }
  return stopped;
}
