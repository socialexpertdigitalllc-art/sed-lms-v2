import { randomUUID } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import { actAs, ActAsError } from "@/lib/auth/actAs";
import { createClient } from "@/lib/supabase/server";
import { getAppSettings } from "@/lib/settings/appSettings";
import { AUTO_RUNS_PER_TURN, clampMode } from "./actions/permissions";
import { getActPermissions, getPermissionCap } from "./actions/permissionStore";
import { bell, isAdminMember, permissionsOf } from "./actions/people";
import { autoRun, autoRunPlan, type AutoRunContext } from "./actions/run";
import { listConversationActions, toCard } from "./actions/store";
import type { ActionContext, StoredAction } from "./actions/types";
import { runTurn, type TurnInput, type TurnOutcome } from "./engine";
import { assistantNameFrom, DEFAULT_ASSISTANT_NAME } from "./name";
import { endRun, startRun } from "./runs";
import { getConversation } from "./store";
import {
  afterRun,
  clip,
  getTask,
  runMessage,
  TASK_BUSY_RETRY_MS,
  TASK_HEARTBEAT_MS,
  TASK_RUN_TIMEOUT_MS,
  TASK_STALE_MS,
  type AssistantTask,
  type RunReport,
  type TaskStatus,
} from "./tasks";

/**
 * THE BACKGROUND-TASK RUNNER — keeps a long job going with nobody watching
 * (see ./tasks.ts). Every 30 seconds the instrumentation poller asks for a
 * sweep; each task that is due gets ONE run: an ordinary SED AI answer in its
 * chat, as its owner (actAs, exactly like the phone channels), under the
 * permission mode it was started with. Between runs the task's row holds
 * where it got to.
 *
 * Self-healing: a run claims its task and sends a heartbeat every 30s. If the
 * server dies mid-run, the heartbeat goes quiet and a later sweep runs the
 * task again — nothing waits on a browser or on this process surviving.
 */

const SWEEP_LIMIT = 6;
/** Runs side by side (each is one person's chat; the AI vendor gates its own rate). */
const RUN_CONCURRENCY = 2;
/** A card left waiting this long before the task started is not part of it. */
const OWN_CARDS_WINDOW_MS = 30 * 60_000;

export interface TaskRunnerDeps {
  now?: () => Date;
  actAs?: <T>(userId: string, fn: () => Promise<T>) => Promise<T>;
  runTurn?: (input: TurnInput) => Promise<TurnOutcome>;
  permissionsOf?: (admin: SupabaseClient, userId: string) => Promise<Set<string>>;
  createClient?: () => Promise<SupabaseClient>;
  /** Re-run the cards the task left waiting (skipped in some tests). */
  rerunWaiting?: (ctx: ActionContext, auto: AutoRunContext, task: AssistantTask) => Promise<number>;
  origin?: string;
}

let sweeping = false;

/** One sweep: run every task that is due (a few at a time). Never throws. */
export async function runDueTasks(admin: SupabaseClient, deps: TaskRunnerDeps = {}): Promise<{ ran: number; skipped?: string }> {
  if (sweeping) return { ran: 0, skipped: "busy" };
  sweeping = true;
  try {
    const now = (deps.now ?? (() => new Date()))();
    const { data, error } = await admin
      .from("assistant_tasks")
      .select("*")
      .eq("status", "running")
      .lte("next_run_at", now.toISOString())
      .order("next_run_at", { ascending: true })
      .limit(SWEEP_LIMIT);
    if (error) return { ran: 0, skipped: "no tasks table" }; // before migration 0092
    const due = ((data ?? []) as AssistantTask[]).filter((t) => !t.claim_id || !t.heartbeat_at || now.getTime() - Date.parse(t.heartbeat_at) >= TASK_STALE_MS);
    let ran = 0;
    let next = 0;
    const worker = async () => {
      while (next < due.length) {
        const task = due[next++];
        if (await runTaskOnce(admin, task, deps).catch((e) => (console.error("[assistant/tasks] run crashed:", e), false))) ran++;
      }
    };
    await Promise.all(Array.from({ length: Math.min(RUN_CONCURRENCY, due.length) }, worker));
    return { ran };
  } finally {
    sweeping = false;
  }
}

/** Claim the task for one run — only if nobody else holds a live claim. */
async function claim(admin: SupabaseClient, task: AssistantTask, now: Date): Promise<string | null> {
  const claimId = randomUUID();
  const staleIso = new Date(now.getTime() - TASK_STALE_MS).toISOString();
  let q = admin
    .from("assistant_tasks")
    .update({ claim_id: claimId, heartbeat_at: now.toISOString() })
    .eq("id", task.id)
    .eq("status", "running");
  q = task.claim_id ? q.eq("claim_id", task.claim_id).lt("heartbeat_at", staleIso) : q.is("claim_id", null);
  const { data } = await q.select("id").maybeSingle();
  return data ? claimId : null;
}

async function release(admin: SupabaseClient, taskId: string, claimId: string, patch: Partial<AssistantTask>): Promise<void> {
  await admin.from("assistant_tasks").update(patch).eq("id", taskId).eq("claim_id", claimId);
}

/** Changes this run really made (its answer's actions that are done). */
async function changesIn(admin: SupabaseClient, turnId: string): Promise<number> {
  const { count } = await admin.from("assistant_actions").select("id", { count: "exact", head: true }).eq("turn_id", turnId).eq("status", "done");
  return count ?? 0;
}

/**
 * Cards the task left waiting — most often the ones held back because an
 * answer had already made its maximum of changes on its own. Each goes through
 * autoRun exactly like a fresh proposal: re-checked as of now, run only if the
 * person's mode allows it, a plan in order. Returns how many ran.
 */
export async function rerunWaitingCards(ctx: ActionContext, auto: AutoRunContext, task: AssistantTask): Promise<number> {
  const since = Date.parse(task.created_at) - OWN_CARDS_WINDOW_MS;
  const now = ctx.now.getTime();
  const open = (await listConversationActions(ctx.admin, ctx.userId, task.conversation_id, 200).catch(() => [] as StoredAction[])).filter(
    (a) => a.status === "proposed" && Date.parse(a.created_at) >= since && Date.parse(a.expires_at) > now,
  );
  let ran = 0;
  const plans = new Map<string, StoredAction[]>();
  for (const a of open) {
    if (auto.budget.left <= 0) break;
    if (a.plan_id) {
      plans.set(a.plan_id, [...(plans.get(a.plan_id) ?? []), a]);
      continue;
    }
    if ((await autoRun(toCard(a, now), ctx, auto)).ran) ran++;
  }
  for (const steps of plans.values()) {
    if (auto.budget.left <= 0) break;
    const ordered = steps.sort((x, y) => (x.plan_index ?? 0) - (y.plan_index ?? 0)).map((a) => toCard(a, now));
    ran += (await autoRunPlan(ordered, ctx, auto)).ran;
  }
  return ran;
}

const FINISHED_WORDS: Partial<Record<TaskStatus, string>> = {
  done: "SED AI finished a task",
  blocked: "SED AI needs you to carry on a task",
  stopped: "SED AI stopped a task",
  failed: "SED AI couldn't finish a task",
};

async function tellOwner(admin: SupabaseClient, task: AssistantTask, status: TaskStatus, body: string): Promise<void> {
  const title = FINISHED_WORDS[status];
  if (!title) return;
  await bell(admin, task.user_id, {
    title,
    body: clip(`${clip(task.goal, 120)} — ${body}`, 900),
    dedupKey: `assistant_task:${task.id}:${status}`,
    targetUrl: `/assistant?c=${task.conversation_id}`,
    eventKey: "assistant_task",
  }).catch(() => {});
}

/**
 * One run of one task. Returns true when a run happened. Never leaves the
 * claim held: whatever happens, the row is released with what to do next.
 */
export async function runTaskOnce(admin: SupabaseClient, task: AssistantTask, deps: TaskRunnerDeps = {}): Promise<boolean> {
  const clock = deps.now ?? (() => new Date());
  const claimId = await claim(admin, task, clock());
  if (!claimId) return false;

  const finish = async (status: TaskStatus, why: string) => {
    const iso = clock().toISOString();
    await release(admin, task.id, claimId, { status, finished_at: iso, last_error: why, claim_id: null, heartbeat_at: null, updated_at: iso });
    await tellOwner(admin, task, status, why);
  };

  const conversation = await getConversation(admin, task.user_id, task.conversation_id).catch(() => null);
  if (!conversation) {
    await finish("failed", "Its chat no longer exists.");
    return false;
  }
  const { data: profile } = await admin.from("profiles").select("display_name, email, ui_preferences, is_active").eq("id", task.user_id).maybeSingle();
  const p = profile as { display_name?: string | null; email?: string | null; ui_preferences?: unknown; is_active?: boolean | null } | null;
  if (!p || p.is_active === false) {
    await finish("failed", "Its owner's account is no longer active.");
    return false;
  }
  const perms = await (deps.permissionsOf ?? permissionsOf)(admin, task.user_id);
  if (!perms.has("assistant.use") || !perms.has("assistant.act")) {
    await finish("failed", "Its owner no longer has SED AI's Act mode.");
    return false;
  }

  // The chat is busy (they're mid-answer there, or have two answers going): later.
  const run = startRun(task.user_id, task.conversation_id, Date.now(), { background: true });
  if ("reason" in run) {
    await release(admin, task.id, claimId, { claim_id: null, heartbeat_at: null, next_run_at: new Date(clock().getTime() + TASK_BUSY_RETRY_MS).toISOString() });
    return false;
  }

  const heartbeat = setInterval(() => {
    void admin.from("assistant_tasks").update({ heartbeat_at: new Date().toISOString() }).eq("id", task.id).eq("claim_id", claimId).then(
      () => {},
      () => {},
    );
  }, TASK_HEARTBEAT_MS);
  const timer = setTimeout(() => run.controller.abort("timeout"), TASK_RUN_TIMEOUT_MS);

  let outcome: TurnOutcome | null = null;
  let reran = 0;
  let crash: string | null = null;
  try {
    await (deps.actAs ?? actAs)(task.user_id, async () => {
      const [db, settings, isAdmin, saved, cap] = await Promise.all([
        (deps.createClient ?? (createClient as () => Promise<SupabaseClient>))(),
        getAppSettings().catch(() => null),
        isAdminMember(admin, task.user_id).catch(() => false),
        getActPermissions(admin, task.user_id),
        getPermissionCap(admin),
      ]);
      const displayName = p.display_name?.trim() || p.email?.split("@")[0] || "there";
      const now = clock();
      const origin = deps.origin ?? process.env.WGE_SELF_ORIGIN ?? "http://localhost:3000";
      const ctx: ActionContext = { userId: task.user_id, displayName, perms, db, admin, timezone: settings?.work_timezone || "Asia/Karachi", now, isAdmin };
      const auto: AutoRunContext = {
        mode: clampMode(task.permission_mode ?? saved.mode, cap),
        cap,
        allow: saved.allow,
        origin,
        budget: { left: AUTO_RUNS_PER_TURN },
      };
      // First the cards the task left waiting, then the next stretch of the job.
      reran = await (deps.rerunWaiting ?? rerunWaitingCards)(ctx, auto, task).catch(() => 0);
      outcome = await (deps.runTurn ?? runTurn)({
        userId: task.user_id,
        displayName,
        assistantName: assistantNameFrom(p.ui_preferences) ?? DEFAULT_ASSISTANT_NAME,
        perms,
        db,
        admin,
        conversation,
        text: runMessage(task),
        emit: () => {},
        signal: run.controller.signal,
        now,
        mode: "act",
        page: null,
        attachments: [],
        source: "scheduler",
        origin,
        permissionMode: auto.mode,
        task: { id: task.id, goal: task.goal, progress: task.progress, run: task.runs + 1, maxRuns: task.max_runs },
      });
    });
  } catch (e) {
    crash = e instanceof ActAsError ? `Couldn't act as its owner: ${e.message}` : "The run crashed.";
    if (!(e instanceof ActAsError)) console.error("[assistant/tasks] run failed:", e);
  } finally {
    clearInterval(heartbeat);
    clearTimeout(timer);
    endRun(task.conversation_id, run.controller);
  }

  const o = outcome as TurnOutcome | null;
  const report: RunReport = {
    ended: crash || !o ? "error" : o.ended,
    changes: reran + (o ? await changesIn(admin, o.turnId).catch(() => 0) : 0),
    progressSet: o?.progressSet ?? false,
    finalText: o?.answer ?? null,
    error: crash ?? o?.error ?? null,
  };
  const fresh = (await getTask(admin, task.id).catch(() => null)) ?? task;
  const verdict = afterRun(fresh, report, clock());
  await release(admin, task.id, claimId, verdict.patch);
  // SED AI said done / blocked during the run, or the runner ended it.
  const ended: TaskStatus | null = verdict.finished ?? (fresh.status !== "running" && fresh.status !== "stopped" ? fresh.status : null);
  if (ended) await tellOwner(admin, { ...fresh, ...verdict.patch } as AssistantTask, ended, (verdict.patch.last_error ?? fresh.progress) || "See the chat.");
  return true;
}
