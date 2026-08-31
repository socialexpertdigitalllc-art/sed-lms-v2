import type { SupabaseClient } from "@supabase/supabase-js";
import { deployBuilderRun } from "@/lib/site-builder/deploy";

/**
 * Headless auto-deploy: publish a run the moment it finishes generating,
 * with no operator in the loop.
 *
 * Opted into per run (`builder_runs.options.auto_deploy === true`, set from
 * the new-site screen) and invoked from the ONE place both generation entry
 * points share — `generateRunNow`'s success path — so it behaves identically
 * whether an operator watched the run finish or the background processor
 * resumed a parked run hours later with nobody looking.
 *
 * It replays exactly what the two manual clicks do, in order:
 *   1. the Approve CAS (`review` -> `approved`), which `deployBuilderRun`
 *      requires and which also makes the transition auditable;
 *   2. `deployBuilderRun`, which owns every deploy side effect — subdomain
 *      resolution and the cross-lead guard, clear-before-upload, the
 *      `studio_deployments` row, `builder_runs.status = "deployed"`, the
 *      lead's `website_link`, the activity log, and the agent notification.
 *
 * `actorUserId` is the run's creator, NOT null: the operator who ticked the
 * box is the person who authorised publishing, so the activity log and the
 * notification's actor attribute it to them. A run with no creator (imported
 * or seeded) deploys with a null actor, which the log accepts.
 *
 * NEVER THROWS. Generation has already succeeded and its row is written by
 * the time this runs; a deploy problem must leave the run sitting in
 * `review` for a manual deploy, not turn a good generation into a failure.
 *
 * A failure also writes its reason to `options.auto_deploy_error`, because a
 * run silently parked in `review` looks exactly like a run that was never
 * asked to publish — which is how a month of aborted subdomain creates went
 * unnoticed. The run screen reads it back.
 */
export interface AutoDeployOutcome {
  ok: boolean;
  url?: string;
  error?: string;
}

/** Read-modify-write of the run's `options` jsonb: a bare update would
 *  replace the whole object, taking `auto_deploy`/`auto_resume` with it. */
async function patchOptions(
  admin: SupabaseClient,
  runId: string,
  patch: Record<string, unknown>,
): Promise<void> {
  const { data } = await admin.from("builder_runs").select("options").eq("id", runId).maybeSingle();
  const current = (data?.options as Record<string, unknown> | null) ?? {};
  await admin
    .from("builder_runs")
    .update({ options: { ...current, ...patch } })
    .eq("id", runId);
}

export async function autoDeployRun(
  admin: SupabaseClient,
  runId: string,
  actorUserId: string | null,
): Promise<AutoDeployOutcome> {
  try {
    const {
      daConfigured,
      createSubdomain,
      subdomainExists,
      clearDocroot,
      uploadZipAndExtract,
      docrootFor,
    } = await import("@/lib/template-engine/directadmin");

    // 1. Approve (CAS from "review" — anything else means somebody already
    //    acted on this run, and auto-deploy must not fight them).
    const { data: approved, error: approveErr } = await admin
      .from("builder_runs")
      .update({ status: "approved", updated_at: new Date().toISOString() })
      .eq("id", runId)
      .eq("status", "review")
      .select("id")
      .single();
    if (approveErr || !approved) {
      return { ok: false, error: "Run was not in review when auto-deploy tried to approve it" };
    }
    await admin.from("activity_log").insert({
      user_id: actorUserId,
      action: "site_builder.run.approved",
      entity_type: "builder_run",
      entity_id: runId,
      new_value: { status: "approved", auto: true },
    });

    // 2. Deploy (owns every remaining side effect, including the notification).
    const outcome = await deployBuilderRun(
      admin,
      runId,
      {
        daConfigured,
        daDomain: process.env.DA_DOMAIN ?? "",
        createSubdomain,
        subdomainExists,
        clearDocroot,
        uploadZipAndExtract,
        docrootFor,
      },
      actorUserId,
    );
    if (!outcome.ok) {
      // Put the run back in review so the operator can retry by hand — an
      // "approved" run that never deployed looks finished on the board.
      await admin
        .from("builder_runs")
        .update({ status: "review", updated_at: new Date().toISOString() })
        .eq("id", runId)
        .eq("status", "approved");
      await admin.from("activity_log").insert({
        user_id: actorUserId,
        action: "site_builder.run.auto_deploy_failed",
        entity_type: "builder_run",
        entity_id: runId,
        new_value: { error: outcome.error },
      });
      await patchOptions(admin, runId, { auto_deploy_error: outcome.error ?? "Auto deploy failed" });
      return { ok: false, error: outcome.error };
    }

    // Clear any reason a previous attempt left behind — this run published.
    await patchOptions(admin, runId, { auto_deploy_error: null });
    return { ok: true, url: outcome.url };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "auto-deploy failed unexpectedly" };
  }
}
