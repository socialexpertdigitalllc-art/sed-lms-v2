// @vitest-environment node
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { streamChat, type WireMessage } from "@/lib/assistant/llm";
import type { ProviderSpec } from "@/lib/ai-tools/run";
import { resetGates } from "@/lib/ai-tools/providers/gate";
import { AiCallAborted } from "@/lib/ai-tools/abort";

/**
 * `streamChat` against hand-built SSE responses. Hermetic: nothing touches the
 * network. The contract under test is round-trip fidelity — the assistant
 * message it returns is exactly what the vendor needs back on the next request.
 */

const spec: ProviderSpec = {
  label: "MiniMax MiniMax-M3",
  endpoint: "https://api.example.com/v1/chat/completions",
  apiKey: "k",
  maxOutputTokens: 524288,
  outputTokenParam: "max_completion_tokens",
  providerKey: "assistant-test",
};

const frame = (obj: unknown) => `data: ${JSON.stringify(obj)}`;
const sse = (lines: string[], status = 200) =>
  new Response(lines.join("\n") + "\n", { status, headers: { "content-type": "text/event-stream" } });
const messages: WireMessage[] = [
  { role: "system", content: "sys" },
  { role: "user", content: "How many leads did I close?" },
];

describe("streamChat", () => {
  beforeEach(() => resetGates());
  afterEach(() => vi.restoreAllMocks());

  it("streams the visible answer, splits out MiniMax's thinking, and keeps the raw message for the next round", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      sse([
        frame({ choices: [{ delta: { role: "assistant", content: "<think>Need the pipeline." } }] }),
        frame({ choices: [{ delta: { content: "</think>\n\nChecking." } }] }),
        frame({
          choices: [
            {
              delta: { tool_calls: [{ index: 0, id: "call_1", type: "function", function: { name: "get_pipeline_summary", arguments: '{"from":' } }] },
            },
          ],
        }),
        frame({ choices: [{ delta: { tool_calls: [{ index: 0, function: { arguments: '"2026-10-01"}' } }] }, finish_reason: "tool_calls" }] }),
        frame({ choices: [], usage: { prompt_tokens: 900, completion_tokens: 60, total_tokens: 960 } }),
        "data: [DONE]",
      ]),
    );
    const text: string[] = [];
    const reasoning: string[] = [];

    const out = await streamChat(spec, "MiniMax-M3", messages, {
      maxTokens: 16000,
      temperature: 1,
      tools: [{ type: "function", function: { name: "get_pipeline_summary", description: "d", parameters: { type: "object", properties: {} } } }],
      onText: (d) => text.push(d),
      onReasoning: (d) => reasoning.push(d),
    });

    expect(text.join("")).toBe("Checking.");
    expect(out.text).toBe("Checking.");
    expect(out.reasoning).toBe("Need the pipeline.");
    expect(reasoning.join("")).toBe("Need the pipeline.");
    // MiniMax needs the COMPLETE message back during a tool chain — think block included.
    expect(out.message).toEqual({
      role: "assistant",
      content: "<think>Need the pipeline.</think>\n\nChecking.",
      tool_calls: [{ id: "call_1", type: "function", function: { name: "get_pipeline_summary", arguments: '{"from":"2026-10-01"}' } }],
    });
    expect(out.finishReason).toBe("tool_calls");
    expect(out.usage?.total_tokens).toBe(960);

    // The request: multi-turn messages, tools, MiniMax's output-budget field, streaming with usage.
    const body = JSON.parse(String(fetchMock.mock.calls[0][1]?.body));
    expect(body.messages).toEqual(messages);
    expect(body.max_completion_tokens).toBe(16000);
    expect(body.max_tokens).toBeUndefined();
    expect(body.stream).toBe(true);
    expect(body.stream_options).toEqual({ include_usage: true });
    expect(body.tools).toHaveLength(1);
    // "auto" is everyone's default — only "none" is ever sent.
    expect(body.tool_choice).toBeUndefined();
  });

  it("returns Gemini's tool calls with their thought signatures untouched", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      sse([
        frame({
          choices: [
            {
              delta: {
                role: "assistant",
                tool_calls: [
                  {
                    id: "function-call-1",
                    type: "function",
                    function: { name: "search_leads", arguments: '{"status":["Ready"]}' },
                    extra_content: { google: { thought_signature: "c2lnbmF0dXJl" } },
                  },
                ],
              },
              finish_reason: "tool_calls",
            },
          ],
        }),
        "data: [DONE]",
      ]),
    );

    const out = await streamChat(spec, "gemini-3.1-pro-preview", messages, { maxTokens: 8000, temperature: 1 });

    expect(out.message.content).toBeNull();
    expect(out.message.tool_calls?.[0].extra_content).toEqual({ google: { thought_signature: "c2lnbmF0dXJl" } });
  });

  it("sends tool_choice none when asked for a final answer", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(sse([frame({ choices: [{ delta: { content: "Final." } }] }), "data: [DONE]"]));
    await streamChat(spec, "m", messages, {
      maxTokens: 100,
      temperature: 1,
      toolChoice: "none",
      tools: [{ type: "function", function: { name: "t", description: "d", parameters: { type: "object", properties: {} } } }],
    });
    expect(JSON.parse(String(fetchMock.mock.calls[0][1]?.body)).tool_choice).toBe("none");
  });

  it("retries a 429 and tells the caller to discard partial output from a stream that died", async () => {
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      // 1st: streams some text, then MiniMax reports a rate limit in-band.
      .mockResolvedValueOnce(
        sse([frame({ choices: [{ delta: { content: "Partial" } }] }), frame({ base_resp: { status_code: 1002, status_msg: "rate limit" } })]),
      )
      // 2nd: succeeds.
      .mockResolvedValueOnce(sse([frame({ choices: [{ delta: { content: "Whole answer." } }] }), "data: [DONE]"]));
    vi.spyOn(Math, "random").mockReturnValue(0); // no backoff wait
    const retries: number[] = [];
    const text: string[] = [];

    const out = await streamChat(spec, "m", messages, {
      maxTokens: 100,
      temperature: 1,
      onText: (d) => text.push(d),
      onRetry: (n) => retries.push(n),
    });

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(retries).toEqual([1]);
    expect(out.text).toBe("Whole answer.");
  });

  it("does not retry a terminal failure", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ error: { message: "invalid api key" } }), { status: 401, headers: { "content-type": "application/json" } }),
    );
    await expect(streamChat(spec, "m", messages, { maxTokens: 100, temperature: 1 })).rejects.toThrow("invalid api key");
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("honours a Stop that is already pressed without dialling", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch");
    const controller = new AbortController();
    controller.abort();
    await expect(
      streamChat(spec, "m", messages, { maxTokens: 100, temperature: 1, signal: controller.signal }),
    ).rejects.toBeInstanceOf(AiCallAborted);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("accepts a vendor that ignored stream:true and answered with plain JSON", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(
        JSON.stringify({
          choices: [
            {
              message: {
                content: "",
                tool_calls: [
                  { id: "", type: "function", function: { name: "calculate", arguments: '{"expression":"1+1"}' } },
                  { id: "", type: "function", function: { name: "calculate", arguments: '{"expression":"2+2"}' } },
                ],
              },
              finish_reason: "tool_calls",
            },
          ],
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      ),
    );
    const out = await streamChat(spec, "m", messages, { maxTokens: 100, temperature: 1 });
    expect(out.toolCalls.map((c) => c.function.arguments)).toEqual(['{"expression":"1+1"}', '{"expression":"2+2"}']);
  });
});
