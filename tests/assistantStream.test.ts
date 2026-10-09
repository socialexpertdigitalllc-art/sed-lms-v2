import { describe, it, expect } from "vitest";
import {
  LineBuffer,
  minimaxStatusToHttp,
  parseSseLine,
  readChunk,
  splitThinking,
  ThinkSplitter,
  ToolCallAccumulator,
} from "@/lib/assistant/stream";

/**
 * The pure half of the assistant's model call. The theme throughout: never
 * lose a byte the vendor needs back — MiniMax's <think> block during a tool
 * chain, Gemini 3's thought signature on every tool call.
 */

describe("ToolCallAccumulator", () => {
  it("assembles OpenAI-style indexed fragments into whole calls", () => {
    const acc = new ToolCallAccumulator();
    acc.add([{ index: 0, id: "call_a", type: "function", function: { name: "search_leads", arguments: "" } }]);
    acc.add([{ index: 0, function: { arguments: '{"query":' } }]);
    acc.add([{ index: 0, function: { arguments: '"plumb"}' } }]);
    acc.add([{ index: 1, id: "call_b", type: "function", function: { name: "calculate", arguments: '{"expression":"1+1"}' } }]);

    expect(acc.result()).toEqual([
      { id: "call_a", type: "function", function: { name: "search_leads", arguments: '{"query":"plumb"}' } },
      { id: "call_b", type: "function", function: { name: "calculate", arguments: '{"expression":"1+1"}' } },
    ]);
  });

  it("keeps vendor extras verbatim — Gemini's thought signature must round-trip", () => {
    const acc = new ToolCallAccumulator();
    acc.add([
      {
        index: 0,
        id: "fc-1",
        type: "function",
        function: { name: "get_pipeline_summary", arguments: "{}" },
        extra_content: { google: { thought_signature: "SIG==" } },
      },
    ]);
    const [call] = acc.result();
    expect(call.extra_content).toEqual({ google: { thought_signature: "SIG==" } });
    expect(call.function.name).toBe("get_pipeline_summary");
  });

  it("separates parallel calls that arrive with neither index nor id", () => {
    const acc = new ToolCallAccumulator();
    acc.add([
      { type: "function", id: "", function: { name: "search_leads", arguments: '{"status":["Ready"]}' } },
      { type: "function", id: "", function: { name: "search_leads", arguments: '{"status":["Closed"]}' } },
      { type: "function", id: "", function: { name: "calculate", arguments: '{"expression":"2*3"}' } },
    ]);
    const calls = acc.result();
    expect(calls.map((c) => c.function.arguments)).toEqual([
      '{"status":["Ready"]}',
      '{"status":["Closed"]}',
      '{"expression":"2*3"}',
    ]);
    // Synthesised ids are unique, so each tool result can name its call.
    expect(new Set(calls.map((c) => c.id)).size).toBe(3);
  });

  it("understands a vendor that re-sends the cumulative arguments on every chunk", () => {
    const acc = new ToolCallAccumulator();
    acc.add([{ index: 0, id: "c1", function: { name: "calculate", arguments: '{"expr' } }]);
    acc.add([{ index: 0, function: { arguments: '{"expression":"' } }]);
    acc.add([{ index: 0, function: { arguments: '{"expression":"3/4"}' } }]);
    expect(acc.result()[0].function.arguments).toBe('{"expression":"3/4"}');
  });

  it("drops a fragment set with no function name and defaults empty arguments", () => {
    const acc = new ToolCallAccumulator();
    acc.add([{ index: 0, id: "x" }]);
    acc.add([{ index: 1, id: "y", function: { name: "calculate" } }]);
    expect(acc.result()).toEqual([{ id: "y", type: "function", function: { name: "calculate", arguments: "{}" } }]);
  });

  it("ignores garbage without throwing", () => {
    const acc = new ToolCallAccumulator();
    acc.add(null);
    acc.add("nope");
    acc.add([1, null, "x"]);
    expect(acc.result()).toEqual([]);
  });
});

describe("ThinkSplitter", () => {
  it("splits MiniMax's inline thinking from the answer, even with tags cut across chunks", () => {
    const s = new ThinkSplitter();
    const parts = ["<thi", "nk>Let me look", " at the data.</th", "ink>\n\nYou closed ", "**4** deals."].map((c) => s.push(c));
    const tail = s.flush();
    const text = parts.map((p) => p.text).join("") + tail.text;
    const reasoning = parts.map((p) => p.reasoning).join("") + tail.reasoning;
    expect(reasoning).toBe("Let me look at the data.");
    // The blank line after </think> is not part of the answer.
    expect(text).toBe("You closed **4** deals.");
  });

  it("passes plain text straight through and holds back only a possible tag prefix", () => {
    const s = new ThinkSplitter();
    expect(s.push("Hello <")).toEqual({ text: "Hello ", reasoning: "" });
    expect(s.push("b>world")).toEqual({ text: "<b>world", reasoning: "" });
    expect(s.flush()).toEqual({ text: "", reasoning: "" });
  });

  it("treats an unclosed think block at the end as reasoning", () => {
    expect(splitThinking("<think>still thinking")).toEqual({ text: "", reasoning: "still thinking" });
  });

  it("handles a reply with no thinking at all", () => {
    expect(splitThinking("  Just the answer.")).toEqual({ text: "Just the answer.", reasoning: "" });
  });
});

describe("SSE framing", () => {
  it("yields only complete lines and keeps the rest for the next chunk", () => {
    const b = new LineBuffer();
    expect(b.push("data: {\"a\":")).toEqual([]);
    expect(b.push("1}\ndata: [DO")).toEqual(['data: {"a":1}']);
    expect(b.push("NE]\n")).toEqual(["data: [DONE]"]);
    expect(b.push("data: tail")).toEqual([]);
    expect(b.flush()).toEqual(["data: tail"]);
  });

  it("parses data lines, recognises [DONE], and skips everything else", () => {
    expect(parseSseLine('data: {"x":1}')).toEqual({ x: 1 });
    expect(parseSseLine("data: [DONE]")).toBe("done");
    expect(parseSseLine(": keep-alive")).toBeNull();
    expect(parseSseLine("event: message")).toBeNull();
    expect(parseSseLine("data: {broken")).toBeNull();
  });
});

describe("readChunk", () => {
  it("reads content, tool calls, finish reason and usage from a delta", () => {
    const v = readChunk({
      choices: [{ delta: { content: "Hi", tool_calls: [{ index: 0 }] }, finish_reason: "tool_calls" }],
      usage: { prompt_tokens: 10, completion_tokens: 2, total_tokens: 12 },
    });
    expect(v.content).toBe("Hi");
    expect(v.toolCalls).toEqual([{ index: 0 }]);
    expect(v.finishReason).toBe("tool_calls");
    expect(v.usage?.total_tokens).toBe(12);
    expect(v.error).toBeNull();
  });

  it("reads reasoning from whichever field the vendor uses", () => {
    expect(readChunk({ choices: [{ delta: { reasoning_content: "a" } }] }).reasoning).toBe("a");
    expect(readChunk({ choices: [{ delta: { reasoning_details: [{ type: "reasoning.text", text: "b" }] } }] }).reasoning).toBe("b");
  });

  it("reads a whole non-streamed message too", () => {
    const v = readChunk({ choices: [{ message: { content: "done", tool_calls: [] }, finish_reason: "stop" }] });
    expect(v.content).toBe("done");
    expect(v.finishReason).toBe("stop");
  });

  it("surfaces MiniMax's HTTP-200 failures as the status they behave like", () => {
    expect(readChunk({ base_resp: { status_code: 1002, status_msg: "rate limit" } }).error).toEqual({ message: "rate limit", status: 429 });
    expect(readChunk({ base_resp: { status_code: 0, status_msg: "success" } }).error).toBeNull();
    expect(minimaxStatusToHttp(1008)).toBe(402);
    expect(minimaxStatusToHttp(1004)).toBe(401);
    expect(minimaxStatusToHttp(1013)).toBe(502);
  });

  it("surfaces an in-stream error object", () => {
    expect(readChunk({ error: { message: "overloaded", code: 503 } }).error).toEqual({ message: "overloaded", status: 503 });
  });
});
