import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { guard, guardError } from "@/lib/site-studio/service/guard";
import {
  daConfigured,
  createSubdomain,
  subdomainExists,
  clearDocroot,
  uploadZipAndExtract,
  docrootFor,
} from "@/lib/template-engine/directadmin";
import { deployRun } from "@/lib/site-studio/deploy/deployRun";

export const runtime = "nodejs";
export const maxDuration = 300;

type Ctx = { params: Promise<{ id: string }> };

/**
 * POST: deploy (or redeploy) a `ready` run to its live subdomain via the kept
 * DirectAdmin layer. All the actual logic — resolution, cross-lead conflict
 * guard, clear-before-upload on reuse, `studio_deployments` bookkeeping — is
 * `deployRun.ts` (Task 9); this route is just guard + wiring + the
 * `studio_run_events` timeline entry every other run-mutating route writes.
 *
 * There is no "deployed" status in the run machine (see run/types.ts):
 * deployment is RECORDED (`deployed_url`, a `studio_deployments` row), not a
 * step, so the run's `status` is left exactly as `deployRun` found it.
 */
export async function POST(_req: Request, ctx: Ctx) {
  const auth = await guard();
  if ("error" in auth) return guardError(auth.error);
  const { id } = await ctx.params;

  const admin = createAdminClient();
  const outcome = await deployRun(
    admin,
    id,
    {
      daConfigured,
      daDomain: process.env.DA_DOMAIN ?? "",
      createSubdomain,
      subdomainExists,
      clearDocroot,
      uploadZipAndExtract,
      docrootFor,
    },
    auth.userId,
  );

  if (!outcome.ok) {
    await admin.from("studio_run_events").insert({
      run_id: id,
      step: "deploy",
      level: "error",
      message: outcome.error,
    });
    return NextResponse.json({ error: outcome.error }, { status: outcome.status });
  }

  await admin.from("studio_run_events").insert({
    run_id: id,
    step: "deploy",
    level: outcome.clearWarning ? "warn" : "info",
    message: `deployed to ${outcome.url}${outcome.reused ? " (redeploy, in place)" : ""}${outcome.clearWarning ? ` — ${outcome.clearWarning}` : ""}`,
    detail: { sub: outcome.sub, reused: outcome.reused, existed: outcome.existed, clearWarning: outcome.clearWarning ?? null },
  });

  return NextResponse.json({
    url: outcome.url,
    sub: outcome.sub,
    reused: outcome.reused,
    clearWarning: outcome.clearWarning ?? null,
  });
}
