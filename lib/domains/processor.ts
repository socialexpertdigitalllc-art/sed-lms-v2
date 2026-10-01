// lib/domains/processor.ts — drives client domains through the pipeline.
// Called by the background poller (POST /api/domains/process, every minute on
// prod) and right after a purchase / assignment for an instant start.
//
// Concurrency (the site-agent discipline): a row is CLAIMED with a fresh
// claim_id via an optimistic update on updated_at, and every write after that
// is guarded on claim_id — an operator unlinking or retrying the domain
// clears the claim, so a stale worker's next write matches nothing and it
// stops. A claim older than CLAIM_STALE_MS (worker died) can be retaken.
import { randomUUID } from "node:crypto";
import { notify as realNotify } from "@/lib/notifications/notify";
import { MAX_POLLS, runStep, type PipelineDeps, type StepOutcome } from "./pipeline";
import { ACTIVE_DOMAIN_STATUSES, stepsFor, type ClientDomainRow, type StepKey, type StepProgress } from "./types";

export const CLAIM_STALE_MS = 10 * 60_000;
/** A domain waiting for the lead's site looks again this often. */
export const SITE_RECHECK_MS = 10 * 60_000;

export interface ProcessOptions {
  /** Process only this row (the instant kick after a purchase / assignment). */
  onlyId?: string;
  /** Stop starting new work after this long (the route's maxDuration minus slack). */
  budgetMs?: number;
  now?: () => Date;
  notify?: typeof realNotify;
}

export interface ProcessedDomain {
  id: string;
  domain: string;
  status: string;
  step: string | null;
  detail: string | null;
}

export async function processDomains(deps: PipelineDeps, opts: ProcessOptions = {}): Promise<ProcessedDomain[]> {
  const now = opts.now ?? (() => new Date());
  const notify = opts.notify ?? realNotify;
  const started = Date.now();
  const budget = opts.budgetMs ?? 200_000;
  const out: ProcessedDomain[] = [];

  let q = deps.admin
    .from("client_domains")
    .select("*")
    .in("status", [...ACTIVE_DOMAIN_STATUSES])
    .order("next_run_at", { ascending: true, nullsFirst: true })
    .limit(10);
  if (opts.onlyId) q = q.eq("id", opts.onlyId);
  const { data, error } = await q;
  if (error || !data) return out;

  const t = () => now().getTime();
  const due = (data as ClientDomainRow[]).filter(
    (r) =>
      (!r.next_run_at || Date.parse(r.next_run_at) <= t()) &&
      (!r.claim_id || !r.claimed_at || t() - Date.parse(r.claimed_at) > CLAIM_STALE_MS),
  );

  for (const candidate of due) {
    if (Date.now() - started > budget) break;
    const claimId = randomUUID();
    const claimedAt = now().toISOString();
    const { data: claimed } = await deps.admin
      .from("client_domains")
      .update({ claim_id: claimId, claimed_at: claimedAt, updated_at: claimedAt })
      .eq("id", candidate.id)
      .eq("updated_at", candidate.updated_at)
      .select("*")
      .maybeSingle();
    if (!claimed) continue; // someone else got it first
    const final = await advance(claimed as ClientDomainRow, claimId, deps, { now, notify, started, budget });
    if (final) out.push(final);
  }
  return out;
}

async function advance(
  start: ClientDomainRow,
  claimId: string,
  deps: PipelineDeps,
  ctx: { now: () => Date; notify: typeof realNotify; started: number; budget: number },
): Promise<ProcessedDomain | null> {
  const order = stepsFor(start.registrar);
  let row = start;
  let lastDetail: string | null = null;

  for (let hop = 0; hop <= order.length; hop++) {
    const step: StepKey = row.step && order.includes(row.step) ? row.step : order[0];
    let outcome: StepOutcome;
    try {
      outcome = await runStep(row, step, deps);
    } catch (e) {
      outcome = { kind: "fail", detail: `Unexpected error: ${e instanceof Error ? e.message : String(e)}` };
    }

    // a step that keeps waiting past its budget is given up — loudly
    if (outcome.kind === "wait" && row.attempts + 1 > MAX_POLLS[step]) {
      outcome = { kind: "fail", detail: `Gave up after ${row.attempts + 1} checks — ${outcome.detail}` };
    }

    const at = ctx.now().toISOString();
    const steps: Partial<Record<StepKey, StepProgress>> = { ...(row.steps ?? {}) };
    const patch: Record<string, unknown> = { updated_at: at };
    let terminal = true;

    switch (outcome.kind) {
      case "done": {
        steps[step] = { state: "done", at, detail: outcome.detail };
        Object.assign(patch, outcome.patch ?? {});
        const next = order[order.indexOf(step) + 1] ?? null;
        patch.step = next;
        patch.attempts = 0;
        patch.last_error = null;
        if (step === "registration" && !row.lead_id) {
          // bought for stock: owned now, set up once it is linked to a lead
          patch.status = "unassigned";
          patch.step = null;
          patch.next_run_at = null;
        } else if (next) {
          patch.status = "setting_up";
          patch.next_run_at = at;
          steps[next] = { state: "running", at };
          terminal = Date.now() - ctx.started > ctx.budget; // keep going while time remains
        } else {
          // nothing after it: never leave a step-less "setting_up" row behind,
          // which the next run would restart from the first step
          patch.status = "live";
          patch.next_run_at = null;
        }
        break;
      }
      case "wait":
        steps[step] = { state: "waiting", at, detail: outcome.detail };
        Object.assign(patch, outcome.patch ?? {});
        patch.step = step;
        patch.attempts = row.attempts + 1;
        patch.next_run_at = new Date(ctx.now().getTime() + outcome.retryInMs).toISOString();
        break;
      case "fail":
        steps[step] = { state: "failed", at, detail: outcome.detail };
        patch.step = step;
        patch.status = outcome.purchaseFailed ? "failed" : "needs_attention";
        patch.last_error = outcome.detail;
        patch.next_run_at = null;
        break;
      case "waiting_for_site":
        steps.site = { state: "waiting", at, detail: outcome.detail };
        patch.step = "site";
        patch.status = "waiting_for_site";
        patch.attempts = 0;
        patch.next_run_at = new Date(ctx.now().getTime() + SITE_RECHECK_MS).toISOString();
        break;
      case "live":
        steps.site = { state: "done", at, detail: outcome.detail };
        patch.step = null;
        patch.status = "live";
        patch.attempts = 0;
        patch.last_error = null;
        patch.next_run_at = null;
        break;
    }
    patch.steps = steps;
    if (terminal) {
      patch.claim_id = null;
      patch.claimed_at = null;
    }
    lastDetail = outcome.detail;

    const { data: written } = await deps.admin
      .from("client_domains")
      .update(patch)
      .eq("id", row.id)
      .eq("claim_id", claimId)
      .select("*")
      .maybeSingle();
    if (!written) return null; // claim lost — the operator changed the row; stop quietly
    row = written as ClientDomainRow;

    if (outcome.kind === "fail") await alert(row, step, outcome.detail, deps, ctx.notify);
    if (terminal) break;
  }
  return { id: row.id, domain: row.domain, status: row.status, step: row.step, detail: lastDetail };
}

async function alert(
  row: ClientDomainRow,
  step: StepKey,
  detail: string,
  deps: PipelineDeps,
  notify: typeof realNotify,
): Promise<void> {
  try {
    let lead: { agent_id: string | null; closed_by: string | null } | null = null;
    if (row.lead_id) {
      const { data } = await deps.admin.from("leads").select("agent_id, closed_by").eq("id", row.lead_id).maybeSingle();
      if (data) lead = { agent_id: data.agent_id ?? null, closed_by: data.closed_by ?? null };
    }
    await notify(
      "domain_needs_attention",
      { leadId: row.lead_id, lead },
      {
        title: row.status === "failed" ? `Domain purchase failed: ${row.domain}` : `Domain setup stopped: ${row.domain}`,
        body: detail.slice(0, 300),
        dedupKey: `domain_needs_attention:${row.id}:${step}:${row.updated_at}`,
        targetUrl: row.lead_id ? `/leads/${row.lead_id}` : "/domains",
      },
    );
    await deps.admin.from("activity_log").insert({
      user_id: row.purchased_by ?? row.created_by,
      action: row.status === "failed" ? "domain.purchase_failed" : "domain.setup_stopped",
      entity_type: "client_domain",
      entity_id: row.id,
      new_value: { domain: row.domain, step, error: detail.slice(0, 500), lead_id: row.lead_id },
    });
  } catch {
    /* the row already says what failed */
  }
}
