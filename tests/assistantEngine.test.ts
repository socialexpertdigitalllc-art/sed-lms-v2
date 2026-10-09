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

const { runTurn } = await import("@/lib/assistant/engine");
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

    // The system prompt carries the memory, under its handle.
    expect(bodyOf(fetchMock, 0).messages[0].content).toContain("[m3f9a2c1] (goal) Wants to close 10 sites in October");

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
});
