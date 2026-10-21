// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from "vitest";
import { memorySupabase, type MemoryDb } from "./helpers/memorySupabase";

/** Stop means stop: the chat's Stop and the banner's Stop task both end a background task. */

const h = vi.hoisted(() => ({ db: null as unknown as MemoryDb, userId: "U1" }));
vi.mock("@/lib/assistant/http", async (importOriginal) => ({
  ...(await importOriginal<object>()),
  assistantGuard: async () => ({ ok: true, caller: { user: { id: h.userId }, perms: new Set(["assistant.use", "assistant.act"]) } }),
}));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => h.db.client }));

import { POST as chatStop } from "@/app/api/assistant/chat/stop/route";
import { POST as taskStop } from "@/app/api/assistant/tasks/[id]/stop/route";
import { resetRuns, startRun, isRunning } from "@/lib/assistant/runs";

const T = "11111111-1111-4111-8111-111111111111";
const C = "22222222-2222-4222-8222-222222222222";
const row = (over: Record<string, unknown> = {}) => ({ id: T, user_id: "U1", conversation_id: C, goal: "Categorise every lead", progress: "", status: "running", runs: 2, max_runs: 40, changes: 10, claim_id: null, heartbeat_at: null, ...over });
const post = (body: unknown = {}) => new Request("http://x", { method: "POST", body: JSON.stringify(body) });

beforeEach(() => {
  resetRuns();
  h.userId = "U1";
  h.db = memorySupabase({ assistant_tasks: [row()] });
});

describe("Stop", () => {
  it("the chat's Stop stops the answer AND the chat's running task", async () => {
    const run = startRun("U1", C, Date.now(), { background: true });
    expect("controller" in run).toBe(true);
    const res = await chatStop(post({ conversationId: C }));
    expect(await res.json()).toEqual({ stopped: true, taskStopped: true });
    expect(h.db.tables.assistant_tasks[0]).toMatchObject({ status: "stopped", last_error: "Stopped by you." });
    expect("controller" in run && run.controller.signal.aborted).toBe(true);
  });

  it("Stop task: the owner's task (and its run going right now)", async () => {
    const run = startRun("U1", C, Date.now(), { background: true });
    const res = await taskStop(post(), { params: Promise.resolve({ id: T }) });
    expect(res.status).toBe(200);
    expect((await res.json()).task).toMatchObject({ id: T, status: "stopped" });
    expect("controller" in run && run.controller.signal.aborted).toBe(true);
    expect(isRunning(C)).toBe(true); // released by the run itself when it unwinds
  });

  it("someone else's task reads as not found and is left alone", async () => {
    h.userId = "U2";
    const res = await taskStop(post(), { params: Promise.resolve({ id: T }) });
    expect(res.status).toBe(404);
    expect(h.db.tables.assistant_tasks[0]).toMatchObject({ status: "running" });
  });
});
