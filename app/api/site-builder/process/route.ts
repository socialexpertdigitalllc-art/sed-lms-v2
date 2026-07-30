import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { generateRunNow } from "@/lib/site-builder/generateRun";

export const runtime = "nodejs";
// Hosts the same rounds loop as the operator's /generate route (see its
// docblock): a run can legitimately spend most of an hour in here.
export const maxDuration = 3600;

/**
 * The background processor: runs start (and parked runs resume) without a
 * screen being open. Called by the instrumentation.ts poller every ~60s, and
 * guarded by the same shared secret as the WGE processor — this is a
 * server-to-server endpoint, not an operator one.
 *
 * Eligible runs:
 *  - `queued` — created but never kicked (or the kick was lost to a restart);
 *  - `failed` with a due `resume_at` and `auto_resume` not switched off —
 *    a PARKED run (see lib/site-builder/generateRun.ts) whose quota window
 *    has reset. `auto_resume` absent means TRUE: parking defaults to
 *    resuming on its own, and only an explicit operator opt-out stops it.
 */
export async function POST(req: Request) {
  const expected = process.env.WGE_PROCESSOR_SECRET;
  // Fail closed, loudly: an unconfigured secret is a deployment problem
  // (503), a wrong or missing header is an unauthorized caller (401). Never
  // process unauthenticated, which would otherwise pass when expected is
  // undefined and the header is absent.
  if (!expected) {
    return NextResponse.json({ error: "WGE_PROCESSOR_SECRET is not configured" }, { status: 503 });
  }
  if (req.headers.get("x-wge-secret") !== expected) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const admin = createAdminClient();

  /**
   * Eligibility is decided in JS over a plain select rather than a composed
   * `.or()/.lte()` PostgREST filter: builder_runs stays small (an operator's
   * worth of runs), and the `coalesce(options->>'auto_resume','true')`
   * semantics — ABSENT MEANS TRUE — are clearer and more testable spelled
   * out here than encoded in a filter string.
   */
  const { data: rows, error } = await admin.from("builder_runs").select("*");
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const now = Date.now();
  const eligible = ((rows ?? []) as Record<string, unknown>[]).filter((r) => {
    if (r.status === "queued") return true;
    // A parked run: failed + a resume_at that has come due. An ordinary
    // failure (resume_at null) is the OPERATOR's to retry, never ours.
    if (r.status !== "failed" || !r.resume_at) return false;
    if (new Date(r.resume_at as string).getTime() > now) return false;
    const auto = (r.options as { auto_resume?: unknown } | null | undefined)?.auto_resume;
    // ABSENT MEANS TRUE: parking defaults to resuming on its own; only an
    // explicit operator opt-out (`auto_resume: false`) leaves it parked.
    return auto !== false;
  });

  /**
   * SINGLE-FLIGHT: at most ONE run per invocation, oldest first. Generation
   * takes minutes and the poller fires every ~60s, so processing one per tick
   * keeps a bulk kick (or several runs' quota windows resetting at once) from
   * bursting past the provider rate gate all at the same time — the same
   * discipline as the WGE processor. The claim CAS + `generation_id` token
   * inside `generateRunNow` makes any race with an open run screen safe: one
   * claimant wins, the other gets `refused` and nothing is double-spent.
   */
  eligible.sort(
    (a, b) => new Date(a.created_at as string).getTime() - new Date(b.created_at as string).getTime(),
  );
  const target = eligible[0];
  if (!target) return NextResponse.json({ processed: 0 });

  const outcome = await generateRunNow(admin, target.id as string);

  /**
   * Always 200 for a completed invocation: a failed RUN is not a failed
   * PROCESSOR call — the run row carries its own status/error, and a non-200
   * here would only make the fire-and-forget poller look broken. `refused`
   * (lost the claim race to an open run screen, or the run moved between our
   * select and the claim) still reports `processed: 1`: work WAS attempted on
   * a run this tick, and the next tick will simply pick the next one up.
   */
  return NextResponse.json({ processed: 1, runId: target.id, kind: outcome.kind });
}
