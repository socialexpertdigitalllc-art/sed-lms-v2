// @vitest-environment node
import { describe, it, expect } from "vitest";
import { memorySupabase } from "./helpers/memorySupabase";
import {
  afterRun,
  goalFrom,
  reportTask,
  runMessage,
  startTask,
  stopTask,
  taskView,
  TASK_GAP_MS,
  TASK_MAX_FAILURES,
  TASK_MAX_IDLE_RUNS,
  TASK_STALE_MS,
  type AssistantTask,
  type RunReport,
} from "@/lib/assistant/tasks";
import { startBackgroundTaskTool, updateTaskProgressTool } from "@/lib/assistant/tools/tasks";
import { requestPermissionModeTool } from "@/lib/assistant/tools/actions";
import { taskSection } from "@/lib/assistant/prompt";
import type { ToolContext } from "@/lib/assistant/tools/types";

/**
 * A long job ("categorise every lead") is a background task: it carries on by
 * itself, run after run, with nobody watching — and always ends: done, waiting
 * for the person, stopped, or given up — never silently "dead".
 */

const now = new Date("2026-10-21T15:00:00Z");
const task = (over: Partial<AssistantTask> = {}): AssistantTask => ({
  id: "T1",
  user_id: "U1",
  conversation_id: "C1",
  goal: "Categorise every lead in the pipeline",
  progress: "",
  status: "running",
  permission_mode: "auto",
  runs: 3,
  max_runs: 40,
  idle_runs: 0,
  failures: 0,
  changes: 120,
  next_run_at: now.toISOString(),
  claim_id: "claim",
  heartbeat_at: now.toISOString(),
  last_run_at: null,
  last_error: null,
  finished_at: null,
  created_at: now.toISOString(),
  updated_at: now.toISOString(),
  ...over,
});
const run = (over: Partial<RunReport> = {}): RunReport => ({ ended: "answered", changes: 40, progressSet: true, finalText: "Did 40.", ...over });

describe("afterRun", () => {
  it("made progress → the next run in a few seconds, claim released, totals kept", () => {
    const v = afterRun(task(), run(), now);
    expect(v.finished).toBeNull();
    expect(v.patch).toMatchObject({ runs: 4, changes: 160, idle_runs: 0, failures: 0, claim_id: null, heartbeat_at: null, next_run_at: new Date(now.getTime() + TASK_GAP_MS).toISOString() });
    expect(v.patch.progress).toBeUndefined(); // SED AI reported its own
  });

  it("no progress report from SED AI → its final words are kept as progress", () => {
    expect(afterRun(task(), run({ progressSet: false, finalText: "412 of 822 done; next: August leads." }), now).patch.progress).toBe("412 of 822 done; next: August leads.");
  });

  it("SED AI marked it done (or the person stopped it) during the run → just released", () => {
    const v = afterRun(task({ status: "done" }), run(), now);
    expect(v.finished).toBeNull();
    expect(v.patch.status).toBeUndefined();
    expect(v.patch.claim_id).toBeNull();
  });

  it("runs that change nothing stop it — finished or stuck, it never loops forever", () => {
    const first = afterRun(task(), run({ changes: 0 }), now);
    expect(first.finished).toBeNull();
    expect(first.patch.idle_runs).toBe(1);
    const second = afterRun(task({ idle_runs: TASK_MAX_IDLE_RUNS - 1 }), run({ changes: 0 }), now);
    expect(second.finished).toBe("stopped");
    expect(second.patch.last_error).toMatch(/no changes in its last 2 runs/);
  });

  it("errors back off, then give up after a few in a row", () => {
    const once = afterRun(task(), run({ ended: "error", error: "SED AI is busy right now." }), now);
    expect(once.finished).toBeNull();
    expect(once.patch).toMatchObject({ failures: 1, last_error: "SED AI is busy right now." });
    expect(Date.parse(once.patch.next_run_at!)).toBe(now.getTime() + 2 * 60_000);
    const last = afterRun(task({ failures: TASK_MAX_FAILURES - 1 }), run({ ended: "error", error: "boom" }), now);
    expect(last).toMatchObject({ finished: "failed", patch: { status: "failed", last_error: "boom" } });
  });

  it("a run that hit its time limit just carries on next time", () => {
    expect(afterRun(task(), run({ ended: "timeout", changes: 10 }), now).finished).toBeNull();
  });

  it("stops at its run limit", () => {
    expect(afterRun(task({ runs: 39, max_runs: 40 }), run(), now)).toMatchObject({ finished: "stopped", patch: { status: "stopped", last_error: expect.stringMatching(/limit of 40 runs/) } });
  });
});

describe("goalFrom", () => {
  it("the person's message — and when it only says 'continue', the messages before it too", () => {
    expect(goalFrom("Categorise every lead by its services", [])).toBe("Categorise every lead by its services");
    expect(goalFrom("continue the task and don't stop until all are done", ["add categories to all leads", "list the ones you can't decide"])).toBe(
      "add categories to all leads\n\nlist the ones you can't decide\n\ncontinue the task and don't stop until all are done",
    );
  });
});

describe("taskView / runMessage", () => {
  it("working = a run is going right now (a fresh heartbeat)", () => {
    expect(taskView(task(), now.getTime()).working).toBe(true);
    expect(taskView(task(), now.getTime() + TASK_STALE_MS + 1).working).toBe(false);
    expect(taskView(task({ claim_id: null }), now.getTime()).working).toBe(false);
    expect(taskView(task()) as unknown as Record<string, unknown>).not.toHaveProperty("claim_id");
  });

  it("a run opens with the goal and its number", () => {
    expect(runMessage(task())).toBe("[Background task — run 4] Carry on with the task: Categorise every lead in the pipeline");
  });
});

describe("the store", () => {
  const newRow = () => ({ id: `T${Math.random().toString(36).slice(2, 8)}`, status: "running", progress: "", runs: 0, max_runs: 40, idle_runs: 0, failures: 0, changes: 0, created_at: now.toISOString() });

  it("one live task per chat: starting again hands back the running one", async () => {
    const db = memorySupabase({}, { assistant_tasks: newRow });
    const a = await startTask(db.client, { userId: "U1", conversationId: "C1", goal: "Categorise every lead", permissionMode: "auto" });
    expect(a.created).toBe(true);
    expect(a.task).toMatchObject({ user_id: "U1", conversation_id: "C1", goal: "Categorise every lead", permission_mode: "auto", status: "running" });
    const b = await startTask(db.client, { userId: "U1", conversationId: "C1", goal: "Something else", permissionMode: "auto" });
    expect(b).toMatchObject({ created: false, task: { id: a.task.id } });
    expect(db.tables.assistant_tasks).toHaveLength(1);
  });

  it("SED AI's report: working keeps it going, done finishes it; a stopped task can't be revived by a report", async () => {
    const db = memorySupabase({ assistant_tasks: [task({ claim_id: null }) as unknown as Record<string, unknown>] });
    expect(await reportTask(db.client, "T1", { progress: "200 done", status: "working" }, now)).toMatchObject({ status: "running", progress: "200 done" });
    expect(await reportTask(db.client, "T1", { progress: "All 822 done", status: "done" }, now)).toMatchObject({ status: "done", finished_at: now.toISOString() });
    expect(await reportTask(db.client, "T1", { progress: "more", status: "working" }, now)).toBeNull();
  });

  it("Stop: only the owner's running task", async () => {
    const db = memorySupabase({ assistant_tasks: [task() as unknown as Record<string, unknown>] });
    expect(await stopTask(db.client, "SOMEONE-ELSE", "T1", now)).toBeNull();
    expect(await stopTask(db.client, "U1", "T1", now)).toMatchObject({ status: "stopped", last_error: "Stopped by you." });
  });
});

describe("the tools", () => {
  const ctxFor = (db: ReturnType<typeof memorySupabase>, act: Partial<NonNullable<ToolContext["act"]>> = {}): ToolContext =>
    ({
      userId: "U1",
      displayName: "Aqib",
      perms: new Set(["assistant.act"]),
      db: db.client,
      admin: db.client,
      timezone: "Asia/Karachi",
      now,
      conversationId: "C1",
      data: {} as never,
      act: { mode: "act", turnId: "turn", source: "chat", isAdmin: false, auto: { mode: "auto", cap: "auto", allow: [], origin: "x", budget: { left: 60 } }, autonomous: true, task: null, ...act },
    }) as ToolContext;
  const newRow = () => ({ id: "T9", status: "running", progress: "", runs: 0, max_runs: 40, idle_runs: 0, failures: 0, changes: 0, created_at: now.toISOString() });

  it("start_background_task: needs a mode that lets changes run on their own", async () => {
    const db = memorySupabase({}, { assistant_tasks: newRow });
    await expect(startBackgroundTaskTool.run({ goal: "Categorise every lead" }, ctxFor(db, { autonomous: false }))).rejects.toThrow(/request_permission_mode/);
    expect(db.tables.assistant_tasks ?? []).toHaveLength(0);
  });

  it("start_background_task: starts it, and this answer now knows the task", async () => {
    const db = memorySupabase({}, { assistant_tasks: newRow });
    const ctx = ctxFor(db);
    const r = await startBackgroundTaskTool.run({ goal: "Categorise every lead by its services; list the unclear ones" }, ctx);
    expect(r.data).toMatchObject({ status: "started", task_id: "T9" });
    expect(String((r.data as { next: string }).next)).toMatch(/does NOT need to say "continue"/);
    expect(ctx.act?.task).toMatchObject({ id: "T9", background: false });
    expect(db.tables.assistant_tasks[0]).toMatchObject({ permission_mode: "auto", conversation_id: "C1" });
  });

  it("update_task_progress: there must be a task; done finishes it", async () => {
    const db = memorySupabase({ assistant_tasks: [task({ claim_id: null }) as unknown as Record<string, unknown>] });
    await expect(updateTaskProgressTool.run({ progress: "x", status: "working" }, ctxFor(db))).rejects.toThrow(/no background task/);
    const ctx = ctxFor(db, { task: { id: "T1", goal: "g", background: true, progressSet: false } });
    const r = await updateTaskProgressTool.run({ progress: "All 822 leads categorised; 9 left for you: …", status: "done" }, ctx);
    expect(r.summary).toBe("Task done");
    expect(ctx.act?.task?.progressSet).toBe(true);
    expect(db.tables.assistant_tasks[0]).toMatchObject({ status: "done" });
  });
});

describe("a background run can't ask for a button", () => {
  it("request_permission_mode is refused — nobody is there to press it", async () => {
    const db = memorySupabase({ assistant_messages: [] });
    const ctx = {
      userId: "U1", displayName: "Aqib", perms: new Set(["assistant.act"]), db: db.client, admin: db.client, timezone: "Asia/Karachi", now, conversationId: "C1", data: {} as never,
      act: { mode: "act", turnId: "turn", source: "scheduler", isAdmin: false, auto: { mode: "auto_safe", cap: "auto", allow: [], origin: "x", budget: { left: 60 } }, autonomous: true, task: { id: "T1", goal: "g", background: true, progressSet: false } },
    } as ToolContext;
    await expect(requestPermissionModeTool.run({ mode: "auto", reason: "200 leads" }, ctx)).rejects.toThrow(/background run — nobody is here to press a button/);
    expect(ctx.act?.askedPermission).toBeFalsy();
  });
});

describe("the prompt", () => {
  it("a background run is told nobody is watching, where it got to, and to report before it ends", () => {
    const s = taskSection({ goal: "Categorise every lead", progress: "412 of 822", run: 5, maxRuns: 40, background: true });
    expect(s).toMatch(/Background task — run 5 of at most 40/);
    expect(s).toMatch(/nobody is watching/);
    expect(s).toMatch(/Progress so far: 412 of 822/);
    expect(s).toMatch(/call update_task_progress: "done" only when the WHOLE goal is finished/);
  });

  it("in a normal answer, a running task is mentioned so they can ask about it or stop it", () => {
    const s = taskSection({ goal: "Categorise every lead", progress: "", run: 2, maxRuns: 40, background: false });
    expect(s).toMatch(/carries on by itself between the person's messages/);
    expect(s).toMatch(/Progress so far: \(nothing recorded yet\)/);
    expect(taskSection(null)).toBe("");
  });
});
