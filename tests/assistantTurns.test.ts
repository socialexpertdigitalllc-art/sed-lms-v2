import { describe, it, expect } from "vitest";
import { answerText, applyEvent, liveTurn, turnsFromMessages } from "@/lib/assistant/turns";
import type { UiMessage } from "@/lib/assistant/view";

const msg = (over: Partial<UiMessage>): UiMessage => ({
  id: "x",
  turn_id: "t1",
  role: "assistant",
  content: "",
  reasoning: null,
  tool_calls: null,
  tool_call_id: null,
  tool_name: null,
  meta: null,
  status: "complete",
  error: null,
  created_at: "",
  ...over,
});

describe("turn model", () => {
  it("rebuilds a saved turn in order", () => {
    const [turn] = turnsFromMessages([
      msg({ id: "t1", role: "user", content: "How did I do?" }),
      msg({ reasoning: "thinking", tool_calls: [{ id: "c1", name: "get_pipeline_summary" }] }),
      msg({ role: "tool", tool_call_id: "c1", tool_name: "get_pipeline_summary", meta: { label: "Reading the pipeline", ok: true, summary: "12 leads", duration_ms: 40 } }),
      msg({ content: "Great month." }),
    ]);
    expect(turn.question).toBe("How did I do?");
    expect(turn.segments.map((s) => s.kind)).toEqual(["reasoning", "tool", "text"]);
    expect(turn.segments[1]).toMatchObject({ label: "Reading the pipeline", status: "ok", summary: "12 leads" });
    expect(answerText(turn)).toBe("Great month.");
  });

  it("shows a failed answer as an error with its reason", () => {
    const [turn] = turnsFromMessages([msg({ id: "t1", role: "user", content: "Q" }), msg({ status: "error", error: "No key" })]);
    expect(turn).toMatchObject({ status: "error", error: "No key" });
  });

  it("builds the same thing live, event by event — and a retry drops only the current round", () => {
    let t = liveTurn("tmp", "How did I do?");
    t = applyEvent(t, { type: "start", conversation: {} as never, userMessageId: "t1" });
    t = applyEvent(t, { type: "reasoning", delta: "think" });
    t = applyEvent(t, { type: "reasoning", delta: "ing" });
    t = applyEvent(t, { type: "tool_start", callId: "c1", name: "calculate", label: "Calculating", args: {} });
    t = applyEvent(t, { type: "tool_end", callId: "c1", name: "calculate", ok: true, summary: "1+1 = 2", durationMs: 3 });
    t = applyEvent(t, { type: "text", delta: "Partial…" });
    t = applyEvent(t, { type: "reset" });
    t = applyEvent(t, { type: "text", delta: "Great " });
    t = applyEvent(t, { type: "text", delta: "month." });
    t = applyEvent(t, { type: "done", messageId: "m9", stopped: false });

    expect(t.id).toBe("t1");
    expect(t.status).toBe("done");
    expect(t.segments).toEqual([
      { kind: "reasoning", text: "thinking" },
      { kind: "tool", callId: "c1", name: "calculate", label: "Calculating", status: "ok", summary: "1+1 = 2", args: {} },
      { kind: "text", text: "Great month." },
    ]);
  });

  it("marks a stopped answer as stopped", () => {
    const t = applyEvent(liveTurn("tmp", "Q"), { type: "done", messageId: null, stopped: true });
    expect(t.status).toBe("stopped");
  });
});
