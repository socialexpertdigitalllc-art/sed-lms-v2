import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { guard, guardError } from "@/lib/site-studio/service/guard";
import { generateRunNow } from "@/lib/site-builder/generateRun";

export const runtime = "nodejs";
/**
 * Generation is PACED behind each provider's rate budget (see
 * lib/ai-tools/providers/gate.ts) and now LOOPS retry rounds inside one
 * request (see lib/site-builder/generateRun.ts), so a run can legitimately
 * spend a long time in here. The core's own in-request budget (~45 min) sits
 * safely under this ceiling and PARKS the run rather than letting the
 * platform's clock kill it mid-write.
 *
 * Self-hosted `next start` does not enforce this the way a serverless
 * platform does; it is raised anyway so the intent is explicit rather than
 * incidental. The run screen polls per-page progress throughout (the core's
 * guarded progress chain), so a long run stays observable rather than
 * looking hung.
 */
export const maxDuration = 3600;

type Ctx = { params: Promise<{ id: string }> };

/**
 * Thin wrapper over `generateRunNow` (lib/site-builder/generateRun.ts), which
 * holds ALL the generation semantics — the RESUMABLE/stale gate, the claim
 * CAS + `generation_id` stamping, the retry-rounds loop with quota-aware
 * pacing and parking, terminal-write-before-upload, and the release write.
 * The core is shared with the background processor; this route only maps its
 * outcomes onto HTTP and writes the operator-attributed activity log entry.
 */
export async function POST(_req: Request, ctx: Ctx) {
  const auth = await guard();
  if ("error" in auth) return guardError(auth.error);
  const { id } = await ctx.params;

  const admin = createAdminClient();
  const outcome = await generateRunNow(admin, id);

  if (outcome.kind === "refused") return NextResponse.json({ error: outcome.error }, { status: outcome.status });
  /**
   * 409, not 500: nothing malfunctioned and the operator did not cause it.
   * This is a lost race with a decision somebody else made, which is exactly
   * what a conflict status is for — and it keeps this off the error paths
   * that page an operator about broken generations.
   */
  if (outcome.kind === "superseded") return NextResponse.json({ error: outcome.error }, { status: 409 });
  // Parked is not an error: the run row carries `resume_at` and the paused
  // explanation, and the screen renders the countdown from it.
  if (outcome.kind === "parked") return NextResponse.json({ run: outcome.run });

  await admin.from("activity_log").insert({
    user_id: auth.userId,
    action: "site_builder.run.generated",
    entity_type: "builder_run",
    entity_id: id,
    new_value: {
      status: outcome.run.status,
      pages: Object.keys((outcome.run.pages ?? {}) as Record<string, unknown>).length,
    },
  });

  return NextResponse.json({ run: outcome.run });
}
