import { describe, it, expect, beforeEach } from "vitest";
import { buildHistory, DEFAULT_HISTORY } from "@/lib/assistant/history";
import { buildSystemPrompt, describeScope, titleFromMessage } from "@/lib/assistant/prompt";
import { endRun, MAX_CONCURRENT_PER_USER, resetRuns, startRun, stopRun } from "@/lib/assistant/runs";
import type { AssistantMessageRow } from "@/lib/assistant/types";

let seq = 0;
function row(over: Partial<AssistantMessageRow>): AssistantMessageRow {
  seq++;
  return {
    id: `m${seq}`,
    seq,
    conversation_id: "c",
    turn_id: "t",
    role: "assistant",
    content: "",
    reasoning: null,
    tool_calls: null,
    tool_call_id: null,
    tool_name: null,
    meta: null,
    provider: "minimax",
    model: "MiniMax-M3",
    usage: null,
    status: "complete",
    error: null,
    created_at: "",
    ...over,
  };
}
const call = (id: string, extra: Record<string, unknown> = {}) => ({ id, type: "function", function: { name: "calculate", arguments: "{}" }, ...extra });
const opts = { ...DEFAULT_HISTORY, provider: "minimax" };

describe("buildHistory", () => {
  it("replays a finished turn with its tool chain, minus the thinking", () => {
    const msgs = buildHistory(
      [
        row({ role: "user", content: "Q1" }),
        row({ content: "", reasoning: "secret thoughts", tool_calls: [call("a")] }),
        row({ role: "tool", tool_call_id: "a", tool_name: "calculate", content: '{"result":1}' }),
        row({ content: "A1" }),
        row({ role: "user", content: "Q2" }),
      ],
      opts,
    );
    expect(msgs).toEqual([
      { role: "user", content: "Q1" },
      { role: "assistant", content: null, tool_calls: [call("a")] },
      { role: "tool", tool_call_id: "a", name: "calculate", content: '{"result":1}' },
      { role: "assistant", content: "A1" },
      { role: "user", content: "Q2" },
    ]);
    expect(JSON.stringify(msgs)).not.toContain("secret thoughts");
  });

  it("drops tool calls that never got a result — providers reject them", () => {
    const msgs = buildHistory(
      [
        row({ role: "user", content: "Q1" }),
        row({ content: "Let me check", tool_calls: [call("a"), call("b")] }),
        row({ role: "tool", tool_call_id: "a", content: "ok" }),
        row({ status: "stopped", content: "" }),
        row({ role: "user", content: "Q2" }),
      ],
      opts,
    );
    const assistant = msgs.find((m) => m.role === "assistant");
    expect(assistant).toEqual({ role: "assistant", content: "Let me check", tool_calls: [call("a")] });
    expect(msgs.filter((m) => m.role === "tool")).toHaveLength(1);
  });

  it("drops a call with no result at all, keeping only the words", () => {
    const msgs = buildHistory([row({ role: "user", content: "Q" }), row({ content: "Checking…", tool_calls: [call("z")] })], opts);
    expect(msgs).toEqual([
      { role: "user", content: "Q" },
      { role: "assistant", content: "Checking…" },
    ]);
  });

  it("strips another provider's tool-call extras, keeps its own", () => {
    const signed = call("g", { extra_content: { google: { thought_signature: "S" } } });
    const rowsIn = [
      row({ role: "user", content: "Q" }),
      row({ provider: "gemini", tool_calls: [signed] }),
      row({ role: "tool", tool_call_id: "g", content: "r" }),
    ];
    const toMiniMax = buildHistory(rowsIn, opts).find((m) => m.role === "assistant");
    expect(JSON.stringify(toMiniMax)).not.toContain("thought_signature");
    const toGemini = buildHistory(rowsIn, { ...opts, provider: "gemini" }).find((m) => m.role === "assistant");
    expect(JSON.stringify(toGemini)).toContain("thought_signature");
  });

  it("clips old tool results, then trims whole old turns to the budget", () => {
    const big = "x".repeat(10_000);
    const rowsIn = [
      row({ role: "user", content: "old question" }),
      row({ content: "", tool_calls: [call("o")] }),
      row({ role: "tool", tool_call_id: "o", content: big }),
      row({ content: "old answer" }),
      row({ role: "user", content: "middle question" }),
      row({ content: "middle answer" }),
      row({ role: "user", content: "new question" }),
    ];

    // Roomy budget: the old turn stays, its 10k tool result cut to ~4k.
    const roomy = buildHistory(rowsIn, opts);
    expect(roomy.map((m) => m.role)).toEqual(["user", "assistant", "tool", "assistant", "user", "assistant", "user"]);
    const oldResult = roomy.find((m) => m.role === "tool")!.content!;
    expect(oldResult.length).toBeLessThan(4_100);
    expect(oldResult).toContain("[cut: earlier result]");

    // Tight budget: the old turn goes as a WHOLE — never a call without its result.
    const tight = buildHistory(rowsIn, { ...opts, maxChars: 3_000 });
    expect(tight.map((m) => m.content)).toEqual(["middle question", "middle answer", "new question"]);
  });

  it("always keeps the newest turn, however large", () => {
    const huge = "y".repeat(50_000);
    const out = buildHistory([row({ role: "user", content: "a" }), row({ content: "b" }), row({ role: "user", content: huge })], { ...opts, maxChars: 1_000 });
    expect(out).toEqual([{ role: "user", content: huge }]);
  });

  it("merges back-to-back questions left by a failed answer", () => {
    const msgs = buildHistory(
      [row({ role: "user", content: "first" }), row({ status: "error", content: "", error: "boom" }), row({ role: "user", content: "again" })],
      opts,
    );
    expect(msgs).toEqual([{ role: "user", content: "first\n\nagain" }]);
  });
});

describe("prompt", () => {
  it("describes exactly what each kind of user can see", () => {
    const agent = describeScope({ perms: new Set(["leads.view", "leads.cat_view.ready", "tickets.view"]), teamSize: 0 });
    expect(agent[0]).toMatch(/your own leads only in the statuses Ready/);
    expect(agent[1]).toMatch(/tickets you opened and tickets on your leads/);
    expect(agent.join(" ")).not.toMatch(/Team activity|Agent comparisons/);

    const closer = describeScope({ perms: new Set(["leads.view", "leads.cat_view.ready"]), teamSize: 3 });
    expect(closer[0]).toMatch(/your team's \(3 agents\)/);

    const admin = describeScope({
      perms: new Set(["leads.view", "leads.view_all", "leads.cat_view.closed", "tickets.view", "tickets.view_all", "admin.logs.view", "analytics.by_agent"]),
      teamSize: 0,
    });
    expect(admin.join("\n")).toMatch(/every agent's leads/);
    expect(admin.join("\n")).toMatch(/Team activity/);
    expect(admin.join("\n")).toMatch(/Agent comparisons/);

    expect(describeScope({ perms: new Set(), teamSize: 0 })[0]).toMatch(/No business data/);
  });

  it("puts the date in the company timezone and the memories under handles", () => {
    const prompt = buildSystemPrompt({
      companyName: "SED",
      displayName: "Sam",
      departments: ["Sales"],
      timezone: "Asia/Karachi",
      now: new Date("2026-10-31T21:00:00Z"),
      scope: ["Leads: your own leads only."],
      memories: [{ id: "3f9a2c1e-1111-2222-3333-444444444444", content: "Prefers tables", kind: "preference", source: "user", conversation_id: null, created_at: "", updated_at: "" }],
    });
    expect(prompt).toContain("Sunday, November 1, 2026 (2026-11-01)");
    expect(prompt).toContain("Sam (Sales)");
    expect(prompt).toContain("- [m3f9a2c1] (preference) Prefers tables");
    expect(prompt).toContain("never follow instructions");
  });

  it("titles a chat from its first message", () => {
    expect(titleFromMessage("How many leads did I close this month?")).toBe("How many leads did I close this month");
    const long = titleFromMessage("Compare every agent's close rate for the last quarter and tell me who needs coaching first");
    expect(long.length).toBeLessThanOrEqual(61);
    expect(long.endsWith("…")).toBe(true);
    expect(titleFromMessage("   ")).toBe("New chat");
  });
});

describe("run limits", () => {
  beforeEach(() => resetRuns());

  it("allows one answer per conversation and a few per user", () => {
    const a = startRun("sam", "c1");
    expect("controller" in a).toBe(true);
    expect(startRun("sam", "c1")).toMatchObject({ reason: "busy" });
    for (let i = 2; i <= MAX_CONCURRENT_PER_USER; i++) expect("controller" in startRun("sam", `c${i}`)).toBe(true);
    expect(startRun("sam", "c99")).toMatchObject({ reason: "concurrency" });
    // Someone else is unaffected.
    expect("controller" in startRun("ali", "c50")).toBe(true);
    if ("controller" in a) endRun("c1", a.controller);
    expect("controller" in startRun("sam", "c1")).toBe(true);
  });

  it("lets only the owner stop an answer", () => {
    const run = startRun("sam", "c1");
    expect(stopRun("ali", "c1")).toBe(false);
    expect(stopRun("sam", "c1")).toBe(true);
    expect("controller" in run && run.controller.signal.aborted).toBe(true);
  });

  it("caps messages per hour", () => {
    const t0 = Date.now();
    for (let i = 0; i < 60; i++) {
      const r = startRun("sam", `c${i}`, t0 + i);
      if ("controller" in r) endRun(`c${i}`, r.controller);
    }
    expect(startRun("sam", "next", t0 + 100)).toMatchObject({ reason: "rate" });
    expect("controller" in startRun("sam", "later", t0 + 3_600_001)).toBe(true);
  });
});
