// @vitest-environment node
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { AssistantMessageRow, AssistantStreamEvent, AssistantConversation } from "@/lib/assistant/types";

/**
 * The whole answer loop — question saved, model streamed, tools run, results
 * fed back, answer saved — against a scripted vendor (fetch) and an in-memory
 * store. The rest (tools, history, prompt, the streaming client, the provider
 * gate) is the real code.
 */

const rows: AssistantMessageRow[] = [];
let seq = 0;

vi.mock("@/lib/assistant/store", async (orig) => {
  const real = await orig<typeof import("@/lib/assistant/store")>();
  return {
    ...real,
    insertMessage: vi.fn(async (_a: unknown, _u: string, conversationId: string, m: Partial<AssistantMessageRow>) => {
      const row = {
        id: m.id ?? `msg-${++seq}`,
        seq: ++seq,
        conversation_id: conversationId,
        turn_id: m.turn_id ?? null,
        role: m.role!,
        content: m.content ?? "",
        reasoning: m.reasoning ?? null,
        tool_calls: m.tool_calls ?? null,
        tool_call_id: m.tool_call_id ?? null,
        tool_name: m.tool_name ?? null,
        meta: m.meta ?? null,
        provider: m.provider ?? null,
        model: m.model ?? null,
        usage: m.usage ?? null,
        status: m.status ?? "complete",
        error: m.error ?? null,
        created_at: new Date().toISOString(),
      } as AssistantMessageRow;
      rows.push(row);
      return row;
    }),
    listMessages: vi.fn(async () => [...rows]),
    listMemories: vi.fn(async () => [
      { id: "3f9a2c1e-0000-0000-0000-000000000000", content: "Wants to close 10 sites in October", kind: "goal", source: "assistant", conversation_id: null, created_at: "", updated_at: "" },
    ]),
    updateConversation: vi.fn(async () => null),
  };
});

const resolved = (providerKey: string, model: string) => ({
  providerKey,
  model,
  outputTokens: 16000,
  usedFallback: false,
  fallbackReason: null,
  spec: {
    label: `${providerKey} ${model}`,
    endpoint: `https://${providerKey}.example.com/v1/chat/completions`,
    apiKey: "k",
    maxOutputTokens: 64000,
    providerKey: `engine-test-${providerKey}`,
  },
});

const resolveMock = vi.fn(async () => resolved("minimax", "MiniMax-M3"));
const defaultMock = vi.fn(async () => null as ReturnType<typeof resolved> | null);
vi.mock("@/lib/ai-tools/providers/run", () => ({ resolveTaskModelCached: () => resolveMock() }));
vi.mock("@/lib/ai-tools/providers/config", () => ({ defaultSpecForTask: () => defaultMock() }));
vi.mock("@/lib/settings/appSettings", () => ({
  getAppSettings: async () => ({ work_timezone: "Asia/Karachi", company_name: "SED", work_start_time: "09:00", idle_timeout_minutes: 15 }),
}));
vi.mock("@/lib/users/directory", () => ({
  getUserDirectory: async () => [{ id: "sam", display_name: "Sam Khan", is_active: true }],
}));
vi.mock("@/lib/teams/closers", () => ({ getTeamAgentIds: async () => [] }));
const permissionState = vi.hoisted(() => ({ saved: { mode: "ask", allow: [] as string[] }, cap: "auto" }));
vi.mock("@/lib/assistant/actions/permissionStore", () => ({
  getActPermissions: async () => permissionState.saved,
  getPermissionCap: async () => permissionState.cap,
}));

const { friendlyError, runTurn } = await import("@/lib/assistant/engine");
const { ProviderHttpError } = await import("@/lib/ai-tools/providers/errors");
const { resetGates } = await import("@/lib/ai-tools/providers/gate");

const frame = (obj: unknown) => `data: ${JSON.stringify(obj)}`;
const sse = (lines: string[]) =>
  new Response([...lines, "data: [DONE]"].join("\n") + "\n", { status: 200, headers: { "content-type": "text/event-stream" } });
const textReply = (text: string) => sse([frame({ choices: [{ delta: { content: text }, finish_reason: "stop" }] })]);
const toolReply = (call: Record<string, unknown>, content = "") =>
  sse([
    ...(content ? [frame({ choices: [{ delta: { content } }] })] : []),
    frame({ choices: [{ delta: { tool_calls: [{ index: 0, ...call }] }, finish_reason: "tool_calls" }] }),
  ]);

const db = { from: () => ({}) } as unknown as SupabaseClient;
const admin = {
  from: () => {
    const b: Record<string, unknown> = {};
    Object.assign(b, { select: () => b, eq: () => Promise.resolve({ data: [], error: null }) });
    return b;
  },
} as unknown as SupabaseClient;
const conversation: AssistantConversation = {
  id: "conv-1",
  title: "Test",
  pinned: false,
  last_provider: null,
  last_model: null,
  created_at: "",
  updated_at: "",
  last_message_at: "",
};

async function ask(text: string, perms = new Set(["assistant.use"]), signal = new AbortController().signal) {
  const events: AssistantStreamEvent[] = [];
  await runTurn({
    userId: "sam",
    displayName: "Sam Khan",
    assistantName: "Nova",
    perms,
    db,
    admin,
    conversation,
    text,
    emit: (e) => events.push(e),
    signal,
    now: new Date("2026-10-09T10:00:00Z"),
  });
  return events;
}

const bodyOf = (fetchMock: { mock: { calls: unknown[][] } }, i: number) =>
  JSON.parse(String((fetchMock.mock.calls[i][1] as RequestInit | undefined)?.body));

describe("runTurn", () => {
  beforeEach(() => {
    rows.length = 0;
    resetGates();
    resolveMock.mockImplementation(async () => resolved("minimax", "MiniMax-M3"));
    defaultMock.mockImplementation(async () => null);
  });
  afterEach(() => vi.restoreAllMocks());

  it("looks something up, feeds the result back with MiniMax's thinking intact, and answers", async () => {
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(
        toolReply(
          { id: "call_1", type: "function", function: { name: "calculate", arguments: '{"expression":"10 - 4"}' } },
          "<think>They need 10 and have 4.</think>",
        ),
      )
      .mockResolvedValueOnce(textReply("You need **6** more closes."));

    const events = await ask("How many more sites do I need?");

    // Round 2 is sent the round-1 assistant message VERBATIM, then the result.
    const second = bodyOf(fetchMock, 1).messages;
    const assistantTurn = second.find((m: { role: string; tool_calls?: unknown }) => m.role === "assistant" && m.tool_calls);
    expect(assistantTurn.content).toBe("<think>They need 10 and have 4.</think>");
    expect(assistantTurn.tool_calls[0].id).toBe("call_1");
    const toolMsg = second[second.length - 1];
    expect(toolMsg).toMatchObject({ role: "tool", tool_call_id: "call_1", name: "calculate" });
    expect(JSON.parse(toolMsg.content)).toEqual({ expression: "10 - 4", result: 6 });

    // The system prompt carries the memory, under its handle — and the
    // assistant's name, as this user chose it.
    const system = bodyOf(fetchMock, 0).messages[0].content;
    expect(system).toContain("[m3f9a2c1] (goal) Wants to close 10 sites in October");
    expect(system).toMatch(/^You are Nova, /);

    // Nothing sent to the browser says which vendor or model answered.
    const start = events.find((e) => e.type === "start")!;
    expect(Object.keys(start).sort()).toEqual(["conversation", "type", "userMessageId"]);
    expect(JSON.stringify(events)).not.toMatch(/minimax|gemini/i);

    // Streamed to the browser in order.
    const kinds = events.filter((e) => e.type !== "ping").map((e) => e.type);
    expect(kinds).toEqual(["start", "reasoning", "tool_start", "tool_end", "text", "done"]);
    expect(events.find((e) => e.type === "tool_end")).toMatchObject({ ok: true, summary: "10 - 4 = 6" });

    // Saved in order: question, the call, its result, the answer.
    expect(rows.map((r) => r.role)).toEqual(["user", "assistant", "tool", "assistant"]);
    expect(rows[1].reasoning).toBe("They need 10 and have 4.");
    expect(rows[1].content).toBe("");
    expect(rows[3].content).toBe("You need **6** more closes.");
    expect(new Set(rows.map((r) => r.turn_id)).size).toBe(1);
  });

  it("round-trips Gemini's thought signature to the next request", async () => {
    resolveMock.mockImplementation(async () => resolved("gemini", "gemini-3.1-pro-preview"));
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(
        toolReply({
          id: "fc-1",
          type: "function",
          function: { name: "calculate", arguments: '{"expression":"2+2"}' },
          extra_content: { google: { thought_signature: "SIG" } },
        }),
      )
      .mockResolvedValueOnce(textReply("4."));

    await ask("2+2?");

    const call = bodyOf(fetchMock, 1).messages.find((m: { tool_calls?: unknown[] }) => m.tool_calls).tool_calls[0];
    expect(call.extra_content).toEqual({ google: { thought_signature: "SIG" } });
  });

  it("switches itself to Act mode for a task, then offers the action tools and the Act prompt", async () => {
    const names = (body: { tools: { function: { name: string } }[] }) => body.tools.map((t) => t.function.name);
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(toolReply({ id: "call_s", type: "function", function: { name: "switch_to_action_mode", arguments: '{"task":"create a lead"}' } }))
      .mockResolvedValueOnce(textReply("What is the business's phone number?"));

    const events = await ask("create a lead for Jumbo's Pizza", new Set(["assistant.use", "assistant.act", "leads.create"]));

    const first = bodyOf(fetchMock, 0);
    expect(names(first)).toContain("switch_to_action_mode");
    expect(names(first)).not.toContain("prepare_action");
    expect(first.messages[0].content).toMatch(/call switch_to_action_mode first/);

    const second = bodyOf(fetchMock, 1);
    expect(names(second)).toEqual(expect.arrayContaining(["prepare_action", "describe_action", "propose_plan"]));
    expect(names(second)).not.toContain("switch_to_action_mode");
    expect(second.messages[0].content).toMatch(/Act mode is on/);
    expect(second.messages[0].content).toMatch(/lead\.create: Create a lead/);

    expect(events).toContainEqual({ type: "mode", mode: "act", reason: "create a lead" });
    expect(rows[0].meta).toMatchObject({ mode: "ask" });
  });

  it("tells the model the person's permission mode — the one picked in the chat, never above the company limit", async () => {
    const actPrompt = async (opts: { saved: string; cap: string; picked?: "ask" | "auto_safe" | "auto" }) => {
      permissionState.saved = { mode: opts.saved, allow: [] };
      permissionState.cap = opts.cap;
      const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(textReply("Which lead?"));
      await runTurn({
        userId: "sam",
        displayName: "Sam Khan",
        assistantName: "Nova",
        perms: new Set(["assistant.use", "assistant.act"]),
        db,
        admin,
        conversation,
        text: "log a call",
        emit: () => {},
        signal: new AbortController().signal,
        now: new Date("2026-10-09T10:00:00Z"),
        mode: "act",
        ...(opts.picked ? { permissionMode: opts.picked } : {}),
      });
      const system = bodyOf(fetchMock, 0).messages[0].content as string;
      fetchMock.mockRestore();
      return system;
    };
    try {
      expect(await actPrompt({ saved: "auto_safe", cap: "auto" })).toMatch(/permission mode is "Auto-run safe changes"/);
      expect(await actPrompt({ saved: "auto_safe", cap: "auto", picked: "ask" })).toMatch(/ONLY by preparing them for confirmation/);
      expect(await actPrompt({ saved: "ask", cap: "auto_safe", picked: "auto" })).toMatch(/permission mode is "Auto-run safe changes"/);
      expect(await actPrompt({ saved: "auto", cap: "ask" })).toMatch(/ONLY by preparing them for confirmation/);
    } finally {
      permissionState.saved = { mode: "ask", allow: [] };
      permissionState.cap = "auto";
    }
  });

  it("an auto permission mode gets the long budget for a big job; Ask keeps the short one", async () => {
    const { memorySupabase } = await import("./helpers/memorySupabase");
    const calc = (i: number) => toolReply({ id: `call_${i}`, type: "function", function: { name: "calculate", arguments: `{"expression":"${i}+1"}` } });
    const runAct = async (saved: string) => {
      permissionState.saved = { mode: saved, allow: [] };
      const fetchMock = vi.spyOn(globalThis, "fetch");
      for (let i = 0; i < 14; i++) fetchMock.mockResolvedValueOnce(calc(i));
      fetchMock.mockResolvedValueOnce(textReply("Done."));
      await runTurn({
        userId: "sam", displayName: "Sam Khan", assistantName: "Nova", perms: new Set(["assistant.use", "assistant.act"]),
        db, admin: memorySupabase({}).client, conversation, text: "categorise everything", emit: () => {},
        signal: new AbortController().signal, now: new Date("2026-10-09T10:00:00Z"), mode: "act",
      });
      const bodies = fetchMock.mock.calls.map((_, i) => bodyOf(fetchMock, i));
      fetchMock.mockRestore();
      return bodies;
    };
    try {
      const asking = await runAct("ask");
      // Ask: the 13th request (round 12) is told to answer, with no tools.
      expect(asking[12].tool_choice).toBe("none");
      expect(JSON.stringify(asking[12].messages.at(-1))).toMatch(/lookup budget for this answer is used up/);
      const autonomous = await runAct("auto");
      expect(autonomous).toHaveLength(15);
      expect(autonomous[12].tool_choice).toBeUndefined();
      // Older lookups were shortened as the job went on.
      expect(JSON.stringify(autonomous[14].messages)).toMatch(/shortened to save room/);
    } finally {
      permissionState.saved = { mode: "ask", allow: [] };
    }
  });

  it("a big job cut off by the answer's budget becomes a background task that carries on by itself", async () => {
    const { memorySupabase } = await import("./helpers/memorySupabase");
    const { MAX_AUTONOMOUS_ROUNDS } = await import("@/lib/assistant/engine");
    permissionState.saved = { mode: "auto", allow: [] };
    const store = memorySupabase({}, { assistant_tasks: () => ({ id: "task-1", status: "running", progress: "", runs: 0, max_runs: 40, created_at: new Date().toISOString() }) });
    const fetchMock = vi.spyOn(globalThis, "fetch");
    for (let i = 0; i < MAX_AUTONOMOUS_ROUNDS; i++) {
      fetchMock.mockResolvedValueOnce(toolReply({ id: `call_${i}`, type: "function", function: { name: "calculate", arguments: `{"expression":"${i}+1"}` } }));
    }
    fetchMock.mockResolvedValueOnce(textReply("Did 600 of 822. It carries on in the background."));
    try {
      const out = await runTurn({
        userId: "sam", displayName: "Sam Khan", assistantName: "Nova", perms: new Set(["assistant.use", "assistant.act"]),
        db, admin: store.client, conversation, text: "categorise every lead in the pipeline by its services", emit: () => {},
        signal: new AbortController().signal, now: new Date("2026-10-09T10:00:00Z"), mode: "act",
      });
      expect(out).toMatchObject({ ended: "budget", taskId: "task-1", answer: "Did 600 of 822. It carries on in the background." });
      expect(store.tables.assistant_tasks).toEqual([
        expect.objectContaining({ user_id: "sam", conversation_id: "conv-1", goal: "categorise every lead in the pipeline by its services", permission_mode: "auto" }),
      ]);
      const last = bodyOf(fetchMock, MAX_AUTONOMOUS_ROUNDS);
      expect(last.tool_choice).toBe("none");
      expect(JSON.stringify(last.messages.at(-1))).toMatch(/carries on by itself in the background — they do not need to say/);
    } finally {
      fetchMock.mockRestore();
      permissionState.saved = { mode: "ask", allow: [] };
    }
  });

  it("a background run: its opening message is marked as the task's, and the model is told where the task got to", async () => {
    const { memorySupabase } = await import("./helpers/memorySupabase");
    permissionState.saved = { mode: "auto", allow: [] };
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(textReply("This run did 40 more."));
    try {
      const out = await runTurn({
        userId: "sam", displayName: "Sam Khan", assistantName: "Nova", perms: new Set(["assistant.use", "assistant.act"]),
        db, admin: memorySupabase({}).client, conversation, text: "[Background task — run 3] Carry on with the task: categorise every lead",
        emit: () => {}, signal: new AbortController().signal, now: new Date("2026-10-09T10:00:00Z"), mode: "act", source: "scheduler",
        task: { id: "task-1", goal: "categorise every lead", progress: "412 of 822 done", run: 3, maxRuns: 40 },
      });
      expect(out).toMatchObject({ ended: "answered", taskId: "task-1", progressSet: false });
      expect(rows[0]).toMatchObject({ role: "user", meta: expect.objectContaining({ task: { id: "task-1", run: 3 } }) });
      const body = bodyOf(fetchMock, 0);
      expect(body.messages[0].content).toMatch(/Background task — run 3 of at most 40/);
      expect(body.messages[0].content).toMatch(/Progress so far: 412 of 822 done/);
      expect(body.tools.map((t: { function: { name: string } }) => t.function.name)).toContain("update_task_progress");
    } finally {
      fetchMock.mockRestore();
      permissionState.saved = { mode: "ask", allow: [] };
    }
  });

  it("a normal answer in a chat with a task running is told about it", async () => {
    const { memorySupabase } = await import("./helpers/memorySupabase");
    const store = memorySupabase({
      assistant_tasks: [{ id: "task-1", conversation_id: "conv-1", user_id: "sam", status: "running", goal: "categorise every lead", progress: "500 done", runs: 4, max_runs: 40 }],
    });
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(textReply("It's at 500."));
    try {
      const out = await runTurn({
        userId: "sam", displayName: "Sam Khan", assistantName: "Nova", perms: new Set(["assistant.use", "assistant.act"]),
        db, admin: store.client, conversation, text: "how far is it?", emit: () => {},
        signal: new AbortController().signal, now: new Date("2026-10-09T10:00:00Z"), mode: "act",
      });
      expect(out.taskId).toBe("task-1");
      expect(bodyOf(fetchMock, 0).messages[0].content).toMatch(/## Background task in this chat[\s\S]*Progress so far: 500 done/);
    } finally {
      fetchMock.mockRestore();
    }
  });

  it("after asking to switch the permission mode, the answer wraps up without more tools", async () => {
    const { memorySupabase } = await import("./helpers/memorySupabase");
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(toolReply({ id: "call_p", type: "function", function: { name: "request_permission_mode", arguments: '{"mode":"auto","reason":"802 leads"}' } }))
      .mockResolvedValueOnce(textReply("Switch with the button and I'll carry on."));
    await runTurn({
      userId: "sam", displayName: "Sam Khan", assistantName: "Nova", perms: new Set(["assistant.use", "assistant.act"]),
      db, admin: memorySupabase({ assistant_messages: [] }).client, conversation, text: "categorise everything, you have my permission",
      emit: () => {}, signal: new AbortController().signal, now: new Date("2026-10-09T10:00:00Z"), mode: "act",
    });
    expect(fetchMock).toHaveBeenCalledTimes(2);
    const second = bodyOf(fetchMock, 1);
    expect(second.tool_choice).toBe("none");
    expect(JSON.stringify(second.messages.at(-1))).toMatch(/you asked them to switch the permission mode/);
  });

  it("never offers Act mode to someone without it", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(textReply("I can't change things for you."));
    await ask("create a lead for Jumbo's Pizza", new Set(["assistant.use", "leads.create"]));
    const body = bodyOf(fetchMock, 0);
    expect(body.tools.map((t: { function: { name: string } }) => t.function.name)).not.toContain("switch_to_action_mode");
    expect(body.messages[0].content).toMatch(/not enabled for their account/);
  });

  it("offers the model only the tools this user's permissions allow", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(textReply("Hi."));
    await ask("hello", new Set(["assistant.use", "leads.view"]));
    const offered = bodyOf(fetchMock, 0).tools.map((t: { function: { name: string } }) => t.function.name);
    expect(offered).toContain("get_pipeline_summary");
    expect(offered).not.toContain("get_team_performance");
    expect(offered).not.toContain("get_team_activity");
  });

  it("falls back to the default model when the assigned one is misconfigured", async () => {
    resolveMock.mockImplementation(async () => resolved("gemini", "gemini-3.1-pro-preview"));
    defaultMock.mockImplementation(async () => resolved("minimax", "MiniMax-M3"));
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(new Response(JSON.stringify({ error: { message: "API key not valid" } }), { status: 400 }))
      .mockResolvedValueOnce(textReply("Answer from the fallback."));

    const events = await ask("hi");

    expect(String(fetchMock.mock.calls[1][0])).toContain("minimax.example.com");
    expect(events.at(-1)).toMatchObject({ type: "done", stopped: false });
    expect(rows.at(-1)).toMatchObject({ provider: "minimax", content: "Answer from the fallback." });
  });

  it("keeps what was written when the user presses Stop", async () => {
    const controller = new AbortController();
    vi.spyOn(globalThis, "fetch").mockImplementationOnce(async (_url, init) => {
      const signal = (init as RequestInit).signal!;
      const enc = new TextEncoder();
      const body = new ReadableStream<Uint8Array>({
        start(c) {
          c.enqueue(enc.encode(`${frame({ choices: [{ delta: { content: "Partial answer" } }] })}\n`));
          // …then nothing, until the Stop.
          signal.addEventListener("abort", () => c.error(Object.assign(new Error("aborted"), { name: "AbortError" })));
        },
      });
      setTimeout(() => controller.abort("stopped by user"), 20);
      return new Response(body, { status: 200, headers: { "content-type": "text/event-stream" } });
    });

    const events = await ask("long question", undefined, controller.signal);

    expect(events.at(-1)).toMatchObject({ type: "done", stopped: true });
    expect(rows.at(-1)).toMatchObject({ role: "assistant", status: "stopped", content: "Partial answer" });
  });

  it("says plainly when no model is configured — and still keeps the question", async () => {
    resolveMock.mockImplementation(async () => {
      throw new Error("MiniMax is not configured (missing MINIMAX_API_KEY).");
    });
    const events = await ask("hi");
    expect(events).toEqual([{ type: "error", message: expect.stringMatching(/Admin → AI Models/) }]);
    expect(rows.map((r) => [r.role, r.status])).toEqual([
      ["user", "complete"],
      ["assistant", "error"],
    ]);
  });

  it("retries an empty reply once before giving up", async () => {
    vi.spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(sse([frame({ choices: [{ delta: { content: "" }, finish_reason: "stop" }] })]))
      .mockResolvedValueOnce(textReply("Second time lucky."));
    const events = await ask("hi");
    expect(events.at(-1)).toMatchObject({ type: "done" });
    expect(rows.at(-1)?.content).toBe("Second time lucky.");
  });

  it("words every failure for users without naming a vendor or echoing the vendor's own text", () => {
    const failures = [
      new Error("MiniMax is not configured (missing MINIMAX_API_KEY)."),
      new ProviderHttpError("invalid api key for minimax", 401, null, null),
      new ProviderHttpError("insufficient balance", 402, null, null),
      new ProviderHttpError("Gemini: rate limit", 429, null, null),
      new ProviderHttpError("MiniMax error 2013: invalid params", 400, null, null),
      new ProviderHttpError("upstream gemini overloaded", 503, null, null),
      new Error("MiniMax MiniMax-M3 call timed out after 150s"),
      new Error("anything else"),
    ];
    for (const e of failures) {
      const message = friendlyError(e);
      expect(message).not.toMatch(/minimax|gemini|deepseek|kimi|moonshot|api key for/i);
      expect(message.length).toBeGreaterThan(10);
    }
    expect(friendlyError(failures[0])).toMatch(/SED AI isn't set up yet/);
  });
});
