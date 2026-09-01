// tests/siteAgentAgyParse.test.ts
// @vitest-environment node
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { EventEmitter } from "node:events";
import type { spawn } from "node:child_process";
import {
  parseAgyEventLine, summarizeEventForTail, parseModelsOutput, buildAgyArgs, listAgyModels,
} from "@/lib/site-agent/agy";

const lines = (f: string) =>
  readFileSync(`tests/fixtures/agy/${f}`, "utf8").split(/\r?\n/).filter(Boolean);

/** Build a step event through the real parser (keeps tests honest about shape). */
const step = (s: Record<string, unknown>) =>
  parseAgyEventLine(JSON.stringify({ event: "step_update", step_update: s }))!;

describe("parseAgyEventLine", () => {
  it("parses every line of the REAL error-run capture without throwing", () => {
    const evs = lines("error-run.ndjson").map(parseAgyEventLine);
    expect(evs.every((e) => e !== null)).toBe(true);
    const kinds = evs.map((e) => e!.kind);
    expect(kinds[0]).toBe("init");
    expect(kinds[kinds.length - 1]).toBe("result");
  });

  it("extracts conversation_id and result fields from the success fixture", () => {
    // Values pinned from the REAL capture (agy 1.1.22, consumer sign-in,
    // 2026-09-01: the Phase-0 phone-number edit run end-to-end).
    const evs = lines("success-run.ndjson").map(parseAgyEventLine);
    const init = evs.find((e) => e?.kind === "init");
    expect(init && init.kind === "init" && init.conversationId).toBe("555a257f-16ca-48cd-9a18-15991c59acb3");
    const result = evs.find((e) => e?.kind === "result");
    expect(result && result.kind === "result" && result.status).toBe("SUCCESS");
    expect(result && result.kind === "result" && result.usage?.total_tokens).toBe(128158);
  });

  it("the real error run yields status ERROR with the error text", () => {
    const evs = lines("error-run.ndjson").map(parseAgyEventLine);
    const result = evs.find((e) => e?.kind === "result");
    expect(result && result.kind === "result" && result.status).toBe("ERROR");
    expect(result && result.kind === "result" && result.error).toMatch(/terminated/i);
  });

  it("unknown event kinds degrade to 'other', not null, not a throw", () => {
    const e = parseAgyEventLine('{"event":"totally_new_thing","x":1}');
    expect(e).toMatchObject({ kind: "other" });
  });

  it("garbage lines return null", () => {
    expect(parseAgyEventLine("not json")).toBeNull();
    expect(parseAgyEventLine("")).toBeNull();
  });
});

describe("parseAgyEventLine — 1.1.23 capture (tool_name / tool_info / text_delta)", () => {
  const evs = lines("success-run-1123.ndjson").map(parseAgyEventLine);

  it("parses every line of the REAL 1.1.23 capture without throwing", () => {
    expect(evs.length).toBe(81);
    expect(evs.every((e) => e !== null)).toBe(true);
    expect(evs[0]!.kind).toBe("init");
    expect(evs[evs.length - 1]!.kind).toBe("result");
  });

  it("agent_response steps carry the agent's actual text as textDelta", () => {
    const deltas = evs.filter((e) => e?.kind === "step" && e.textDelta !== null);
    expect(deltas.length).toBeGreaterThan(0);
    const texts = deltas.map((e) => e!.kind === "step" && e!.textDelta).join("");
    expect(texts).toContain('changed the word "hi" to "hello"');
  });

  it("a tool ACTIVE step yields toolName and a human-readable params string", () => {
    // First tool step of the capture: find_by_name over *index.html*.
    const active = evs.find((e) => e?.kind === "step" && e.state === "ACTIVE" && e.stepType === "tool");
    expect(active && active.kind === "step" && active.toolName).toBe("find_by_name");
    expect(active && active.kind === "step" && active.toolParams).toBe("*index.html*, C:\\Users\\pc");
  });

  it("legacy 1.1.22 bare steps parse with the new fields as null", () => {
    const evsOld = lines("error-run.ndjson").map(parseAgyEventLine);
    const steps = evsOld.filter((e) => e?.kind === "step");
    expect(steps.length).toBeGreaterThan(0);
    for (const s of steps) {
      expect(s!.kind === "step" && s!.toolName).toBeNull();
      expect(s!.kind === "step" && s!.textDelta).toBeNull();
    }
  });

  it("param strings are truncated: ~60ch per value, ~120ch overall, non-strings skipped", () => {
    const long = "x".repeat(100);
    const e = step({
      step_type: "tool", state: "ACTIVE", step_index: 1, tool_name: "run_command",
      tool_info: { name: "run_command", parameters: { A: long, B: long, C: 42, D: true } },
    });
    expect(e.kind === "step" && e.toolParams).toBeTruthy();
    const p = e.kind === "step" ? e.toolParams! : "";
    expect(p.length).toBeLessThanOrEqual(121); // 120 + ellipsis
    expect(p).toContain("xxxx");
    expect(p).not.toContain("42");
    expect(p).not.toContain("true");
  });

  it("multi-line param values are flattened to a single line", () => {
    // The narration invariant is one line per event; a param carrying
    // newlines/tabs (file content, scripts) must not break it.
    const e = step({
      step_type: "tool", state: "ACTIVE", step_index: 1, tool_name: "write_to_file",
      tool_info: { name: "write_to_file", parameters: { Content: "line one\n  line two\t\tend" } },
    });
    expect(e.kind === "step" && e.toolParams).toBe("line one line two end");
  });

  it("a tool step with no string params yields toolParams null", () => {
    const e = step({
      step_type: "tool", state: "ACTIVE", step_index: 1, tool_name: "wait_5_seconds",
      tool_info: { name: "wait_5_seconds", parameters: {} },
    });
    expect(e.kind === "step" && e.toolParams).toBeNull();
    const e2 = step({ step_type: "tool", state: "ACTIVE", step_index: 1, tool_name: "finish" });
    expect(e2.kind === "step" && e2.toolParams).toBeNull();
  });
});

describe("summarizeEventForTail", () => {
  it("narrates the 1.1.23 capture: tool lines with params, real agent text, and NO bracket labels of any kind", () => {
    const evs = lines("success-run-1123.ndjson").map(parseAgyEventLine);
    const tails = evs.map((e) => (e ? summarizeEventForTail(e) : null)).filter(Boolean) as string[];
    const joined = tails.join("\n");
    expect(joined).toContain("▸ find_by_name (*index.html*, C:\\Users\\pc)");
    expect(joined).toContain('I have changed the word "hi" to "hello"');
    expect(joined).not.toContain("[tool]");
    expect(joined).not.toContain("[agent_response]");
    expect(joined).not.toContain("[user_input]");
    expect(joined).not.toContain("[system_message]");
  });

  it("narrates the 1.1.22 success capture the same way (it carries tool_name too)", () => {
    // The 2026-09-01 success capture already has tool_name/text_delta — only
    // error-run.ndjson is the truly bare shape. Its tool steps therefore render
    // as ▸ lines now, not [tool] labels, and the final text still passes through.
    const evs = lines("success-run.ndjson").map(parseAgyEventLine);
    const tails = evs.map((e) => (e ? summarizeEventForTail(e) : null)).filter(Boolean) as string[];
    const joined = tails.join("\n");
    expect(joined).toContain("▸ run_command (Get-Location)");
    expect(joined).toMatch(/987-6543/);
    expect(joined).not.toContain("[tool]");
    expect(joined).not.toContain("[agent_response]");
  });

  it("pins the exact tail for the bare-shaped error run (labels minus noise)", () => {
    // v1 also emitted [user_input] and [agent_response]; those are noise now.
    const evs = lines("error-run.ndjson").map(parseAgyEventLine);
    const tails = evs.map((e) => (e ? summarizeEventForTail(e) : null)).filter(Boolean);
    expect(tails).toEqual([
      "[agent started]",
      "[error_message]",
      "[error] Agent execution terminated due to error.",
    ]);
  });

  it("tool ACTIVE with toolName renders ▸ name (params); without params just ▸ name", () => {
    const withParams = step({
      step_type: "tool", state: "ACTIVE", step_index: 2, tool_name: "view_file",
      tool_info: { name: "view_file", parameters: { AbsolutePath: "C:\\site\\index.html" } },
    });
    expect(summarizeEventForTail(withParams)).toBe("▸ view_file (C:\\site\\index.html)");
    const bare = step({ step_type: "tool", state: "ACTIVE", step_index: 2, tool_name: "finish" });
    expect(summarizeEventForTail(bare)).toBe("▸ finish");
  });

  it("tool DONE (or ERROR) with toolName is silent — the ACTIVE line already showed it", () => {
    const done = step({ step_type: "tool", state: "DONE", step_index: 2, tool_name: "view_file" });
    expect(summarizeEventForTail(done)).toBeNull();
    const err = step({ step_type: "tool", state: "ERROR", step_index: 2, tool_name: "view_file" });
    expect(summarizeEventForTail(err)).toBeNull();
  });

  it("legacy 1.1.22-shaped steps (no toolName) keep their v1 [stepType] label on DONE — except pure noise types", () => {
    const legacyTool = step({ step_type: "tool", state: "DONE", step_index: 1 });
    expect(summarizeEventForTail(legacyTool)).toBe("[tool]");
    const legacyCall = step({ step_type: "tool_call", state: "DONE", step_index: 1 });
    expect(summarizeEventForTail(legacyCall)).toBe("[tool_call]");
    const legacyActive = step({ step_type: "tool", state: "ACTIVE", step_index: 1 });
    expect(summarizeEventForTail(legacyActive)).toBeNull();
    // system_message and user_input are noise in every shape ("system lines
    // minimal" per the v2 spec) — silent even on bare DONE steps.
    const sys = step({ step_type: "system_message", state: "DONE", step_index: 5 });
    expect(summarizeEventForTail(sys)).toBeNull();
    const user = step({ step_type: "user_input", state: "DONE", step_index: 0 });
    expect(summarizeEventForTail(user)).toBeNull();
  });

  it("agent_response text passes through trimmed; empty/absent is silent; user_input is silent", () => {
    const text = step({ step_type: "agent_response", state: "DONE", step_index: 3, text_delta: "  Done editing.\n" });
    expect(summarizeEventForTail(text)).toBe("Done editing.");
    const active = step({ step_type: "agent_response", state: "ACTIVE", step_index: 3, text_delta: "Half a sen" });
    expect(summarizeEventForTail(active)).toBe("Half a sen");
    const empty = step({ step_type: "agent_response", state: "DONE", step_index: 3, text_delta: "  \n" });
    expect(summarizeEventForTail(empty)).toBeNull();
    const none = step({ step_type: "agent_response", state: "DONE", step_index: 3 });
    expect(summarizeEventForTail(none)).toBeNull();
    const user = step({ step_type: "user_input", state: "DONE", step_index: 0 });
    expect(summarizeEventForTail(user)).toBeNull();
  });

  it("init and result summaries are unchanged from v1", () => {
    expect(summarizeEventForTail({ kind: "init", conversationId: "c", permissionMode: null })).toBe("[agent started]");
    expect(summarizeEventForTail({
      kind: "result", status: "SUCCESS", response: "All set.", error: null, usage: null, numTurns: 1, durationSeconds: 2,
    })).toBe("All set.");
    expect(summarizeEventForTail({
      kind: "result", status: "ERROR", response: "", error: "boom", usage: null, numTurns: null, durationSeconds: null,
    })).toBe("[error] boom");
  });
});

describe("buildAgyArgs", () => {
  const base = { cwd: "C:\\work", prompt: "do the thing", timeoutMs: 15 * 60_000 };

  it("builds the v1 flag set with the timeout in ceil'd minutes", () => {
    expect(buildAgyArgs(base)).toEqual([
      "-p", "do the thing",
      "--output-format", "stream-json",
      "--dangerously-skip-permissions",
      "--print-timeout", "15m",
    ]);
    expect(buildAgyArgs({ ...base, timeoutMs: 90_000 })).toContain("2m");
  });

  it("adds --model <id> only when a model is set", () => {
    const args = buildAgyArgs({ ...base, model: "claude-sonnet-4-6" });
    expect(args.slice(args.indexOf("--model"), args.indexOf("--model") + 2)).toEqual(["--model", "claude-sonnet-4-6"]);
    expect(buildAgyArgs(base)).not.toContain("--model");
    expect(buildAgyArgs({ ...base, model: null })).not.toContain("--model");
  });

  it("adds --conversation only when resuming", () => {
    const args = buildAgyArgs({ ...base, conversationId: "abc-123" });
    expect(args.slice(-2)).toEqual(["--conversation", "abc-123"]);
    expect(buildAgyArgs(base)).not.toContain("--conversation");
    expect(buildAgyArgs({ ...base, conversationId: null })).not.toContain("--conversation");
  });
});

describe("parseModelsOutput", () => {
  it("parses agy models TSV, skipping the fetching banner and blanks", () => {
    const out = parseModelsOutput(
      "Fetching available models...\n" +
      "gemini-3-flash\tGemini 3 Flash (High effort)\n" +
      "claude-sonnet-4-6\tClaude Sonnet 4.6\n" +
      "\n" +
      "gpt-oss-120b-medium\tGPT OSS 120B (Medium effort)\n",
    );
    expect(out).toEqual([
      { id: "gemini-3-flash", label: "Gemini 3 Flash (High effort)" },
      { id: "claude-sonnet-4-6", label: "Claude Sonnet 4.6" },
      { id: "gpt-oss-120b-medium", label: "GPT OSS 120B (Medium effort)" },
    ]);
  });

  it("requires a tab: lines without one are ignored", () => {
    expect(parseModelsOutput("gemini-3-flash Gemini 3 Flash\nplain text\n")).toEqual([]);
  });

  it("empty / banner-only / malformed input yields []", () => {
    expect(parseModelsOutput("")).toEqual([]);
    expect(parseModelsOutput("Fetching available models...\n")).toEqual([]);
    expect(parseModelsOutput("\t\n\tno-id\nno-label\t\n")).toEqual([]);
  });

  it("handles CRLF output from a Windows shell", () => {
    expect(parseModelsOutput("Fetching available models...\r\nm1\tModel One\r\n")).toEqual([
      { id: "m1", label: "Model One" },
    ]);
  });
});

describe("listAgyModels", () => {
  /** A stand-in child: enough surface for listAgyModels (stdout/stderr
   *  emitters, kill, pid) driven by a per-test script. */
  class FakeChild extends EventEmitter {
    stdout = new EventEmitter();
    stderr = new EventEmitter();
    pid = 4242;
    kill() { return true; }
  }
  const spawnScript = (script: (c: FakeChild) => void): typeof spawn =>
    ((() => {
      const c = new FakeChild();
      setImmediate(() => script(c));
      return c;
    }) as unknown as typeof spawn);

  it("collects chunked TSV stdout and parses it", async () => {
    const models = await listAgyModels("agy", spawnScript((c) => {
      c.stdout.emit("data", Buffer.from("Fetching available models...\n"));
      c.stdout.emit("data", Buffer.from("m1\tModel One\nm2\tModel"));
      c.stdout.emit("data", Buffer.from(" Two\n")); // a chunk boundary mid-line
      c.emit("close", 0);
    }));
    expect(models).toEqual([
      { id: "m1", label: "Model One" },
      { id: "m2", label: "Model Two" },
    ]);
  });

  it("a spawn error yields [] and never rejects — even when close fires afterwards", async () => {
    const models = await listAgyModels("agy", spawnScript((c) => {
      c.emit("error", new Error("spawn agy ENOENT"));
      c.emit("close", null); // modern Node fires both; must not double-settle
    }));
    expect(models).toEqual([]);
  });

  it("a nonzero exit with garbage stdout yields []", async () => {
    const models = await listAgyModels("agy", spawnScript((c) => {
      c.stdout.emit("data", Buffer.from("agy: unexpected error\nstack trace here\n"));
      c.stderr.emit("data", Buffer.from("boom\n"));
      c.emit("close", 1);
    }));
    expect(models).toEqual([]);
  });
});
