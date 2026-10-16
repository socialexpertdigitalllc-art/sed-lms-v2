// @vitest-environment node
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { cleanRelPath, createMinimaxDriver, minimaxRequestExtras, siteTools, MINIMAX_CONVERSATION } from "@/lib/site-agent/minimax";
import { ProviderHttpError } from "@/lib/ai-tools/providers/errors";
import type { ChatResult } from "@/lib/assistant/llm";
import type { AgyEvent } from "@/lib/site-agent/agy";
import {
  composeRunOptions, describeRunOptions, effectiveRunOptions, parseDefaults, parseRunOptions, runEngine,
} from "@/lib/site-agent/options";

/**
 * The AI developer's MiniMax engine. It edits a real scratch folder through
 * file tools and speaks the same driver contract as Antigravity, so these pin
 * the two halves: the tools behave like a careful editor (exact edits, no
 * escaping the site, index.html kept), and the loop turns MiniMax's tool calls
 * into edits, progress lines and a summary — and fails the right way.
 */

let dir = "";
beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "mm-site-"));
  await writeFile(join(dir, "index.html"), "<h1>Old Title</h1>\n<p>Call 555-0100</p>\n<p>Call 555-0100</p>\n");
  await mkdir(join(dir, "css"));
  await writeFile(join(dir, "css", "style.css"), ":root { --brand: #ff0000; }\n");
  await writeFile(join(dir, "logo.png"), new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0, 0, 1]));
});
afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

const read = (p: string) => readFile(join(dir, p), "utf8");

describe("site tools", () => {
  it("keep every path inside the site", () => {
    expect(cleanRelPath("./css/style.css")).toBe("css/style.css");
    expect(cleanRelPath("/index.html")).toBe("index.html");
    expect(cleanRelPath("css\\style.css")).toBe("css/style.css");
    expect(cleanRelPath("../secrets.txt")).toBeNull();
    expect(cleanRelPath("css/../../x")).toBeNull();
    expect(cleanRelPath("C:/Windows/x")).toBeNull();
  });

  it("list, search and read with line numbers", async () => {
    const t = siteTools(dir);
    expect(await t.list_dir({})).toMatch(/css\/[\s\S]*index\.html/);
    expect(await t.list_dir({ recursive: true })).toMatch(/3 file\(s\)/);
    const hits = await t.grep_search({ query: "555-0100" });
    expect(hits).toMatch(/2 match\(es\)/);
    expect(hits).toMatch(/index\.html:2: <p>Call 555-0100<\/p>/);
    expect(await t.view_file({ path: "index.html", start_line: 2, end_line: 2 })).toMatch(/2\| <p>Call 555-0100<\/p>/);
    expect(await t.view_file({ path: "logo.png" })).toMatch(/binary/);
    expect(await t.view_file({ path: "../etc/passwd" })).toMatch(/outside the site/);
  });

  it("edit exactly: unique by default, every match on request, a clear error otherwise", async () => {
    const t = siteTools(dir);
    expect(await t.replace_file_content({ path: "index.html", old_text: "Old Title", new_text: "New Title" })).toMatch(/1 replacement/);
    expect(await read("index.html")).toMatch(/<h1>New Title<\/h1>/);
    expect(await t.replace_file_content({ path: "index.html", old_text: "555-0100", new_text: "555-0199" })).toMatch(/appears 2 times .*lines 2, 3/);
    expect(await t.replace_file_content({ path: "index.html", old_text: "555-0100", new_text: "555-0199", replace_all: true })).toMatch(/2 replacement/);
    expect(await read("index.html")).not.toMatch(/555-0100/);
    expect(await t.replace_file_content({ path: "index.html", old_text: "not there", new_text: "x" })).toMatch(/not found/);
    // "$&" in the new text is literal text, not a regex back-reference.
    await t.replace_file_content({ path: "css/style.css", old_text: "#ff0000", new_text: "$&-ish" });
    expect(await read("css/style.css")).toMatch(/\$&-ish/);
  });

  it("create and delete files, but never delete index.html", async () => {
    const t = siteTools(dir);
    expect(await t.write_to_file({ path: "pages/new.html", content: "<p>hi</p>" })).toMatch(/Created pages\/new\.html/);
    expect(await read("pages/new.html")).toBe("<p>hi</p>");
    expect(await t.delete_file({ path: "index.html" })).toMatch(/must stay/);
    expect(await t.delete_file({ path: "pages/new.html" })).toMatch(/Deleted/);
    expect(await t.write_to_file({ path: "../escape.html", content: "x" })).toMatch(/outside the site/);
  });
});

/* ------------------------------------------------------------------ loop */

const spec = { label: "MiniMax MiniMax-M3", endpoint: "https://api.minimax.io/v1/chat/completions", apiKey: "k", maxOutputTokens: 524288 };
const resolveSpec = async () => ({ spec, reason: null as null });

function turn(text: string, calls: { name: string; args: Record<string, unknown> }[] = []): ChatResult {
  const toolCalls = calls.map((c, i) => ({ id: `call-${i}-${c.name}`, type: "function" as const, function: { name: c.name, arguments: JSON.stringify(c.args) } }));
  return {
    text,
    reasoning: "",
    message: { role: "assistant", content: text || null, ...(toolCalls.length ? { tool_calls: toolCalls } : {}) },
    toolCalls,
    finishReason: toolCalls.length ? "tool_calls" : "stop",
    usage: { prompt_tokens: 1000, completion_tokens: 100 },
  };
}

const runOpts = (over: Record<string, unknown> = {}) => ({
  cwd: dir, prompt: "Change the title to New Title.", timeoutMs: 60_000, model: "MiniMax-M3",
  minimax: { max_steps: 10, temperature: 0.3, top_p: 0.9, service_tier: "priority" as const }, ...over,
});

describe("MiniMax driver", () => {
  it("turns tool calls into edits, progress lines and a summary", async () => {
    const replies = [
      turn("Looking for the title.", [{ name: "grep_search", args: { query: "Old Title" } }]),
      turn("", [{ name: "replace_file_content", args: { path: "index.html", old_text: "Old Title", new_text: "New Title" } }]),
      turn("", [{ name: "finish", args: { summary: "Changed the heading in index.html." } }]),
    ];
    // The driver keeps appending to one message list — snapshot it per call.
    const sent: { model: string; messages: { role: string; tool_call_id?: string; content?: unknown }[]; opts: Record<string, unknown> }[] = [];
    const chat = vi.fn(async (_spec: unknown, model: string, messages: unknown[], opts: Record<string, unknown>) => {
      sent.push({ model, messages: structuredClone(messages) as never, opts });
      return replies[sent.length - 1];
    });
    const events: AgyEvent[] = [];
    const out = await createMinimaxDriver({ resolveSpec, chat: chat as never })(runOpts(), (e) => events.push(e));

    expect(out.killed).toBe(false);
    expect(out.result).toMatchObject({ status: "SUCCESS", response: "Changed the heading in index.html." });
    expect(out.result?.usage).toMatchObject({ input_tokens: 3000, output_tokens: 300, steps: 3 });
    expect(out.conversationId).toBe(MINIMAX_CONVERSATION);
    expect(await read("index.html")).toMatch(/New Title/);
    expect(events.map((e) => (e.kind === "step" ? e.toolName ?? e.textDelta : e.kind))).toEqual([
      "init", "Looking for the title.", "grep_search", "replace_file_content", "result",
    ]);

    // The tool results go back to MiniMax with the call ids, and the run's
    // API settings ride every request.
    const { model, messages, opts } = sent[1];
    expect(model).toBe("MiniMax-M3");
    expect(messages.at(-1)).toMatchObject({ role: "tool", tool_call_id: "call-0-grep_search" });
    expect(String(messages.at(-1)?.content)).toMatch(/index\.html:1/);
    expect(opts).toMatchObject({ temperature: 0.3, extraBody: { top_p: 0.9, service_tier: "priority" } });
    expect((opts.tools as { function: { name: string } }[]).map((t) => t.function.name)).toContain("replace_file_content");
  });

  it("a reply without a tool call is the summary", async () => {
    const chat = vi.fn().mockResolvedValueOnce(turn("Nothing needed changing."));
    const out = await createMinimaxDriver({ resolveSpec, chat })(runOpts(), () => {});
    expect(out.result).toMatchObject({ status: "SUCCESS", response: "Nothing needed changing." });
  });

  it("stops at the step limit and says so", async () => {
    const chat = vi.fn().mockResolvedValue(turn("", [{ name: "list_dir", args: {} }]));
    const out = await createMinimaxDriver({ resolveSpec, chat })(runOpts({ minimax: { max_steps: 3 } }), () => {});
    expect(chat).toHaveBeenCalledTimes(3);
    expect(out.result?.response).toMatch(/3-step limit/);
  });

  it("is permanent when MiniMax is not set up, or refuses the request", async () => {
    const unset = await createMinimaxDriver({ resolveSpec: async () => ({ spec: null, reason: "MiniMax has no stored credentials" }), chat: vi.fn() })(runOpts(), () => {});
    expect(unset).toMatchObject({ permanent: true, result: { status: "ERROR" } });
    expect(unset.result?.error).toMatch(/Admin → AI providers/);

    const refused = await createMinimaxDriver({ resolveSpec, chat: vi.fn().mockRejectedValue(new ProviderHttpError("insufficient balance", 402, null, null)) })(runOpts(), () => {});
    expect(refused).toMatchObject({ permanent: true, result: { error: "insufficient balance" } });

    const busy = await createMinimaxDriver({ resolveSpec, chat: vi.fn().mockRejectedValue(new ProviderHttpError("overloaded", 503, null, null)) })(runOpts(), () => {});
    expect(busy.permanent).toBe(false);

    const unknown = await createMinimaxDriver({ resolveSpec, chat: vi.fn() })(runOpts({ model: "MiniMax-M9" }), () => {});
    expect(unknown).toMatchObject({ permanent: true });
  });

  it("stops when the run is discarded", async () => {
    const chat = vi.fn().mockResolvedValue(turn("", [{ name: "list_dir", args: {} }]));
    let cancel = false;
    chat.mockImplementation(async () => {
      cancel = true;
      return turn("", [{ name: "list_dir", args: {} }]);
    });
    const out = await createMinimaxDriver({ resolveSpec, chat })(runOpts({ shouldCancel: () => cancel }), () => {});
    expect(out.killed).toBe(true);
    expect(chat).toHaveBeenCalledTimes(1);
  });

  it("sends only what the chosen model accepts", () => {
    expect(minimaxRequestExtras("MiniMax-M3", { thinking: "disabled", reasoning_effort: "low", top_p: 0.8 })).toEqual({ thinking: { type: "disabled" }, top_p: 0.8 });
    // M3.1: thinking off is a 400, reasoning effort is its own knob.
    expect(minimaxRequestExtras("MiniMax-M3.1-Flash-Preview", { thinking: "disabled", reasoning_effort: "low" })).toEqual({ reasoning_effort: "low" });
    expect(minimaxRequestExtras("MiniMax-M2.7", {})).toEqual({});
  });
});

describe("engine options", () => {
  it("validate every MiniMax setting against MiniMax's documented ranges", () => {
    expect(parseRunOptions({ engine: "minimax", minimax: { temperature: 0.7, top_p: 0.9, max_tokens: 40000, thinking: "adaptive", reasoning_effort: "high", service_tier: "priority", max_steps: 40 } }))
      .toEqual({ ok: true, value: { engine: "minimax", minimax: { temperature: 0.7, top_p: 0.9, max_tokens: 40000, thinking: "adaptive", reasoning_effort: "high", service_tier: "priority", max_steps: 40 } } });
    for (const bad of [{ temperature: 2.5 }, { top_p: -0.1 }, { max_tokens: 10 }, { thinking: "sometimes" }, { reasoning_effort: "none" }, { service_tier: "vip" }, { max_steps: 1000 }]) {
      expect(parseRunOptions({ engine: "minimax", minimax: bad }).ok).toBe(false);
    }
    expect(parseRunOptions({ engine: "openai" }).ok).toBe(false);
  });

  it("a send writes the engine and its settings onto the run; the sender's settings win over the team's", () => {
    const team = { engine: "minimax" as const, minimax: { temperature: 0.5, service_tier: "priority" as const } };
    expect(composeRunOptions({ minimax: { temperature: 0.2 } }, team)).toMatchObject({ engine: "minimax", minimax: { temperature: 0.2, service_tier: "priority" } });
    // Antigravity sends carry no MiniMax settings, whatever the team keeps ready.
    const agy = composeRunOptions({ engine: "antigravity" }, team);
    expect(agy.engine).toBeUndefined();
    expect(agy.minimax).toBeUndefined();
  });

  it("a stored run without an engine is Antigravity; team defaults never re-route a sent run", () => {
    expect(runEngine(null)).toBe("antigravity");
    expect(runEngine({ engine: "minimax" })).toBe("minimax");
    expect(effectiveRunOptions({ speed: "quick" }, { engine: "minimax" }).engine).toBe("antigravity");
    expect(effectiveRunOptions({ engine: "minimax", speed: "quick" }).minimax.max_steps).toBe(30);
    expect(describeRunOptions({ engine: "minimax", speed: "quick", minimax: { temperature: 0.3, service_tier: "priority" } })).toBe("MiniMax · temp 0.3 · priority tier · Quick");
  });

  it("team defaults accept a MiniMax model only from MiniMax's list", () => {
    expect(parseDefaults({ engine: "minimax", minimax_model: "MiniMax-M2.7-highspeed" })).toMatchObject({ ok: true, value: { engine: "minimax", minimax_model: "MiniMax-M2.7-highspeed" } });
    expect(parseDefaults({ minimax_model: "gpt-5" }).ok).toBe(false);
  });
});
