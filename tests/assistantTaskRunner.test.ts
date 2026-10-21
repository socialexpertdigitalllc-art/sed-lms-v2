// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from "vitest";
import { readFileSync } from "node:fs";
import { memorySupabase } from "./helpers/memorySupabase";

/**
 * The runner keeps a background task going with nobody watching: one run per
 * due task, as its owner, under its permission mode — and a run that died
 * with the server (no heartbeat) is simply run again.
 */

const h = vi.hoisted(() => ({
  bells: [] as { userId: string; n: Record<string, unknown> }[],
  autoRuns: [] as string[],
}));
vi.mock("@/lib/assistant/actions/people", () => ({
  bell: vi.fn(async (_admin: unknown, userId: string, n: Record<string, unknown>) => {
    h.bells.push({ userId, n });
  }),
  isAdminMember: vi.fn(async () => false),
  permissionsOf: vi.fn(async () => new Set(["assistant.use", "assistant.act"])),
}));
vi.mock("@/lib/settings/appSettings", () => ({ getAppSettings: vi.fn(async () => ({ work_timezone: "Asia/Karachi" })) }));
vi.mock("@/lib/assistant/actions/permissionStore", () => ({
  getActPermissions: vi.fn(async () => ({ mode: "ask", allow: [] })),
  getPermissionCap: vi.fn(async () => "auto"),
}));
vi.mock("@/lib/assistant/engine", () => ({ runTurn: vi.fn() }));
vi.mock("@/lib/auth/actAs", () => ({ actAs: vi.fn(), ActAsError: class extends Error {} }));
vi.mock("@/lib/supabase/server", () => ({ createClient: vi.fn() }));
vi.mock("@/lib/assistant/actions/run", () => ({
  autoRun: vi.fn(async (card: { id: string }) => {
    h.autoRuns.push(card.id);
    return { ran: true, card };
  }),
  autoRunPlan: vi.fn(async (cards: { id: string }[]) => {
    h.autoRuns.push(...cards.map((c) => c.id));
    return { cards, ran: cards.length, stoppedAt: null };
  }),
}));

import { rerunWaitingCards, runDueTasks, runTaskOnce, type TaskRunnerDeps } from "@/lib/assistant/taskRunner";
import { resetRuns, startRun } from "@/lib/assistant/runs";
import { TASK_BUSY_RETRY_MS, TASK_GAP_MS, TASK_STALE_MS, type AssistantTask } from "@/lib/assistant/tasks";
import type { TurnInput, TurnOutcome } from "@/lib/assistant/engine";
import { permissionsOf } from "@/lib/assistant/actions/people";

const now = new Date("2026-10-21T15:00:00Z");
const ago = (ms: number) => new Date(now.getTime() - ms).toISOString();

const taskRow = (over: Partial<AssistantTask> = {}): AssistantTask => ({
  id: "T1",
  user_id: "U1",
  conversation_id: "C1",
  goal: "Categorise every lead in the pipeline",
  progress: "100 of 822 done",
  status: "running",
  permission_mode: "auto",
  runs: 2,
  max_runs: 40,
  idle_runs: 0,
  failures: 0,
  changes: 100,
  next_run_at: ago(1000),
  claim_id: null,
  heartbeat_at: null,
  last_run_at: null,
  last_error: null,
  finished_at: null,
  created_at: ago(3_600_000),
  updated_at: ago(60_000),
  ...over,
});

function setup(task: Partial<AssistantTask> = {}, extra: Record<string, Record<string, unknown>[]> = {}) {
  const db = memorySupabase({
    assistant_tasks: [taskRow(task) as unknown as Record<string, unknown>],
    assistant_conversations: [{ id: "C1", user_id: "U1", title: "Categories", pinned: false, created_at: ago(9e6), updated_at: ago(60_000), last_message_at: ago(60_000) }],
    profiles: [{ id: "U1", display_name: "Aqib", email: "aqib@x.com", ui_preferences: {}, is_active: true }],
    assistant_actions: [],
    ...extra,
  });
  const turns: TurnInput[] = [];
  const runTurn = vi.fn(async (input: TurnInput): Promise<TurnOutcome> => {
    turns.push(input);
    // This run made 30 changes.
    for (let i = 0; i < 30; i++) db.tables.assistant_actions.push({ id: `a${i}`, turn_id: "turn-1", status: "done" });
    return { turnId: "turn-1", ended: "answered", answer: "Did 30 more.", taskId: "T1", progressSet: false };
  });
  const deps: TaskRunnerDeps = {
    now: () => now,
    actAs: async (_uid, fn) => fn(),
    runTurn,
    createClient: async () => db.client,
    rerunWaiting: async () => 0,
    origin: "https://lms.example",
  };
  return { db, deps, runTurn, turns, task: () => db.tables.assistant_tasks[0] as unknown as AssistantTask };
}

beforeEach(() => {
  resetRuns();
  h.bells.length = 0;
  h.autoRuns.length = 0;
  vi.mocked(permissionsOf).mockResolvedValue(new Set(["assistant.use", "assistant.act"]));
});

describe("runDueTasks / runTaskOnce", () => {
  it("runs a due task once, as its owner, in act mode under the task's permission mode — then schedules the next run", async () => {
    const { db, deps, turns, task } = setup();
    expect(await runDueTasks(db.client, deps)).toEqual({ ran: 1 });
    expect(turns).toHaveLength(1);
    expect(turns[0]).toMatchObject({
      userId: "U1",
      mode: "act",
      source: "scheduler",
      permissionMode: "auto",
      text: "[Background task — run 3] Carry on with the task: Categorise every lead in the pipeline",
      task: { id: "T1", goal: "Categorise every lead in the pipeline", progress: "100 of 822 done", run: 3, maxRuns: 40 },
    });
    expect(task()).toMatchObject({
      status: "running",
      runs: 3,
      changes: 130,
      progress: "Did 30 more.", // it didn't report, so its final words are kept
      claim_id: null,
      heartbeat_at: null,
      next_run_at: new Date(now.getTime() + TASK_GAP_MS).toISOString(),
    });
    expect(h.bells).toEqual([]); // not finished: nothing to tell
  });

  it("a run going right now (fresh heartbeat) is left alone; one silent too long died with the server and is run again", async () => {
    const live = setup({ claim_id: "other", heartbeat_at: ago(10_000) });
    expect(await runDueTasks(live.db.client, live.deps)).toEqual({ ran: 0 });
    expect(live.turns).toHaveLength(0);

    const dead = setup({ claim_id: "other", heartbeat_at: ago(TASK_STALE_MS + 1000) });
    expect(await runDueTasks(dead.db.client, dead.deps)).toEqual({ ran: 1 });
    expect(dead.turns).toHaveLength(1);
  });

  it("SED AI said done during the run → the owner is told, with a link to the chat", async () => {
    const s = setup();
    s.runTurn.mockImplementationOnce(async () => {
      Object.assign(s.db.tables.assistant_tasks[0], { status: "done", progress: "All 822 categorised; 9 left for you.", finished_at: now.toISOString() });
      s.db.tables.assistant_actions.push({ id: "z", turn_id: "turn-1", status: "done" });
      return { turnId: "turn-1", ended: "answered", answer: "Done.", taskId: "T1", progressSet: true };
    });
    await runTaskOnce(s.db.client, taskRow(), s.deps);
    expect(s.task()).toMatchObject({ status: "done", runs: 3, claim_id: null });
    expect(h.bells).toEqual([
      { userId: "U1", n: expect.objectContaining({ title: "SED AI finished a task", targetUrl: "/assistant?c=C1", dedupKey: "assistant_task:T1:done", body: expect.stringMatching(/All 822 categorised/) }) },
    ]);
  });

  it("the person is mid-answer in that chat → no run now; it tries again shortly, claim released", async () => {
    const s = setup();
    startRun("U1", "C1");
    expect(await runTaskOnce(s.db.client, taskRow(), s.deps)).toBe(false);
    expect(s.turns).toHaveLength(0);
    expect(s.task()).toMatchObject({ status: "running", claim_id: null, next_run_at: new Date(now.getTime() + TASK_BUSY_RETRY_MS).toISOString() });
  });

  it("the owner lost Act mode → it fails, and they're told why", async () => {
    vi.mocked(permissionsOf).mockResolvedValueOnce(new Set(["assistant.use"]));
    const s = setup();
    await runTaskOnce(s.db.client, taskRow(), s.deps);
    expect(s.turns).toHaveLength(0);
    expect(s.task()).toMatchObject({ status: "failed", last_error: expect.stringMatching(/no longer has SED AI's Act mode/) });
    expect(h.bells[0].n).toMatchObject({ title: "SED AI couldn't finish a task" });
  });

  it("a crashed run counts as a failure and backs off", async () => {
    const s = setup();
    s.runTurn.mockRejectedValueOnce(new Error("boom"));
    await runTaskOnce(s.db.client, taskRow(), s.deps);
    expect(s.task()).toMatchObject({ status: "running", failures: 1, last_error: "The run crashed.", claim_id: null });
    expect(Date.parse(s.task().next_run_at)).toBe(now.getTime() + 2 * 60_000);
  });

  it("a stopped (or finished) task is never run", async () => {
    const s = setup({ status: "stopped" });
    expect(await runDueTasks(s.db.client, s.deps)).toEqual({ ran: 0 });
    expect(s.turns).toHaveLength(0);
  });
});

describe("rerunWaitingCards", () => {
  it("re-runs the task's waiting cards (a plan in order), never older or expired ones", async () => {
    const created = ago(3_600_000);
    const card = (id: string, over: Record<string, unknown> = {}) => ({
      id,
      user_id: "U1",
      conversation_id: "C1",
      turn_id: "t",
      tool_call_id: null,
      plan_id: null,
      plan_index: null,
      plan_title: null,
      action_key: "lead.categorize",
      title: "Set categories",
      risk: "standard",
      input: {},
      card: {},
      status: "proposed",
      source: "chat",
      created_at: ago(3_500_000),
      updated_at: ago(3_500_000),
      expires_at: new Date(now.getTime() + 3_600_000).toISOString(),
      ...over,
    });
    const db = memorySupabase({
      assistant_actions: [
        card("held"),
        card("p2", { plan_id: "P", plan_index: 1 }),
        card("p1", { plan_id: "P", plan_index: 0 }),
        card("old", { created_at: ago(3 * 3_600_000) }),
        card("expired", { expires_at: ago(1000) }),
        card("done", { status: "done" }),
      ],
    });
    const ctx = { userId: "U1", displayName: "Aqib", perms: new Set<string>(), db: db.client, admin: db.client, timezone: "Asia/Karachi", now, isAdmin: false };
    const ran = await rerunWaitingCards(ctx, { mode: "auto", cap: "auto", allow: [], origin: "x", budget: { left: 60 } }, taskRow({ created_at: created }));
    expect(h.autoRuns).toEqual(["held", "p1", "p2"]);
    expect(ran).toBe(3);
  });
});

describe("wiring", () => {
  it("the sweep is allowlisted (no session), polled every 30s, and demands the secret", async () => {
    expect(readFileSync("lib/supabase/middleware.ts", "utf8")).toMatch(/path === "\/api\/assistant\/tasks\/process"/);
    expect(readFileSync("instrumentation.ts", "utf8")).toMatch(/\/api\/assistant\/tasks\/process[\s\S]{0,200}30_000/);
    process.env.WGE_PROCESSOR_SECRET = "s3cret";
    vi.doMock("next/server", async (orig) => ({ ...(await orig<object>()), after: vi.fn() }));
    const { POST } = await import("@/app/api/assistant/tasks/process/route");
    expect((await POST(new Request("http://x", { method: "POST" }))).status).toBe(401);
    expect((await POST(new Request("http://x", { method: "POST", headers: { "x-wge-secret": "nope" } }))).status).toBe(401);
    expect((await POST(new Request("http://x", { method: "POST", headers: { "x-wge-secret": "s3cret" } }))).status).toBe(200);
  });
});
