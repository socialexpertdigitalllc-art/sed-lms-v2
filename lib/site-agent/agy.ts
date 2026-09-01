// lib/site-agent/agy.ts
/**
 * Driver for the `agy` CLI (Antigravity) in headless print mode.
 *
 * The NDJSON event schema below was pinned from REAL runs
 * (tests/fixtures/agy/*.ndjson — Phase 0 spike 2026-09-01 on 1.1.22, v2 spike
 * 2026-09-02 on 1.1.23). 1.1.23 step_updates carry `tool_name`,
 * `tool_info.parameters`, and — on agent_response steps — `text_delta` with
 * the agent's actual words; older bare step_updates (error-run.ndjson) parse
 * with those fields null. The parser is deliberately tolerant: agy is
 * preview-cadence software, so any unrecognized event kind degrades to
 * {kind:"other"} and only unparseable lines are dropped. The worker's
 * behaviour depends ONLY on `init` (grab the conversation id) and `result`
 * (status/usage); everything else just feeds the progress tail.
 *
 * runAgy/listAgyModels spawn the CLI — Windows-box worker only; never
 * imported by prod routes (they touch neither child_process nor this module).
 */
import { spawn } from "node:child_process";
import { createInterface } from "node:readline";
import type { AgyModel } from "./types";

export type AgyEvent =
  | { kind: "init"; conversationId: string; permissionMode: string | null }
  | {
      kind: "step"; stepType: string; state: string; index: number;
      /** 1.1.23: which tool this step runs (null on bare 1.1.22 shapes). */
      toolName: string | null;
      /** Human-readable digest of tool_info.parameters (null when none). */
      toolParams: string | null;
      /** The agent's actual text on agent_response steps (null elsewhere). */
      textDelta: string | null;
    }
  | {
      kind: "result"; status: "SUCCESS" | "ERROR"; response: string; error: string | null;
      usage: Record<string, number> | null; numTurns: number | null; durationSeconds: number | null;
    }
  | { kind: "other"; raw: string };

const PARAM_VALUE_MAX = 60;
const PARAMS_MAX = 120;

/** tool_info.parameters → "value1, value2" (string values only, truncated). */
function formatToolParams(params: unknown): string | null {
  if (!params || typeof params !== "object") return null;
  const vals = Object.values(params as Record<string, unknown>)
    .filter((v): v is string => typeof v === "string" && v.trim().length > 0)
    .map((v) => (v.length > PARAM_VALUE_MAX ? `${v.slice(0, PARAM_VALUE_MAX)}…` : v));
  if (vals.length === 0) return null;
  const joined = vals.join(", ");
  return joined.length > PARAMS_MAX ? `${joined.slice(0, PARAMS_MAX)}…` : joined;
}

export function parseAgyEventLine(line: string): AgyEvent | null {
  const t = line.trim();
  if (!t.startsWith("{")) return null;
  let obj: Record<string, unknown>;
  try { obj = JSON.parse(t) as Record<string, unknown>; } catch { return null; }
  const ev = obj.event;
  if (ev === "init" && obj.init && typeof obj.init === "object") {
    const init = obj.init as Record<string, unknown>;
    return {
      kind: "init",
      conversationId: String(obj.conversation_id ?? ""),
      permissionMode: typeof init.permission_mode === "string" ? init.permission_mode : null,
    };
  }
  if (ev === "step_update" && obj.step_update && typeof obj.step_update === "object") {
    const s = obj.step_update as Record<string, unknown>;
    const toolInfo = s.tool_info && typeof s.tool_info === "object" ? (s.tool_info as Record<string, unknown>) : null;
    return {
      kind: "step",
      stepType: typeof s.step_type === "string" ? s.step_type : "unknown",
      state: typeof s.state === "string" ? s.state : "unknown",
      index: typeof s.step_index === "number" ? s.step_index : -1,
      toolName: typeof s.tool_name === "string" && s.tool_name ? s.tool_name : null,
      toolParams: formatToolParams(toolInfo?.parameters),
      textDelta: typeof s.text_delta === "string" && s.text_delta ? s.text_delta : null,
    };
  }
  if (ev === "result" && obj.result && typeof obj.result === "object") {
    const r = obj.result as Record<string, unknown>;
    return {
      kind: "result",
      status: r.status === "SUCCESS" ? "SUCCESS" : "ERROR",
      response: typeof r.response === "string" ? r.response : "",
      error: typeof r.error === "string" && r.error ? r.error : null,
      usage: r.usage && typeof r.usage === "object" ? (r.usage as Record<string, number>) : null,
      numTurns: typeof r.num_turns === "number" ? r.num_turns : null,
      durationSeconds: typeof r.duration_seconds === "number" ? r.duration_seconds : null,
    };
  }
  return { kind: "other", raw: t.slice(0, 200) };
}

/**
 * One line of narration per event for the progress tail (or null to skip).
 * Pure and stateless: agent_response text passes through verbatim (trimmed);
 * tools announce once on ACTIVE as `▸ name (params)` and stay silent on
 * DONE/ERROR (the ACTIVE line already showed them). Bare 1.1.22-shaped steps
 * (no tool_name — error-run.ndjson) keep their v1 `[stepType]` label on DONE,
 * except user_input and textless agent_response which were always noise.
 */
export function summarizeEventForTail(e: AgyEvent): string | null {
  switch (e.kind) {
    case "init": return "[agent started]";
    case "step": {
      if (e.stepType === "agent_response") {
        const text = e.textDelta?.trim();
        return text ? text : null;
      }
      if (e.stepType === "user_input") return null;
      if (e.toolName) {
        return e.state === "ACTIVE" ? `▸ ${e.toolName}${e.toolParams ? ` (${e.toolParams})` : ""}` : null;
      }
      return e.state === "DONE" ? `[${e.stepType}]` : null; // legacy bare shape
    }
    case "result": return e.status === "SUCCESS" ? e.response : `[error] ${e.error ?? "unknown"}`;
    case "other": return null;
  }
}

export interface AgyRunOutcome {
  exitCode: number | null;
  result: Extract<AgyEvent, { kind: "result" }> | null;
  conversationId: string | null;
  /** true when we killed it (timeout or cancellation), so callers don't
   *  misread the exit code as an agent failure. */
  killed: boolean;
  /** The spawn-level failure (ENOENT: binary not found OR cwd missing), when
   *  the child never ran at all. Without this, a launch failure is
   *  indistinguishable from "agy ran and printed nothing" — which cost a
   *  live debugging session on 2026-09-01. */
  spawnError?: string;
}

export interface AgyRunOptions {
  cwd: string;
  prompt: string;
  conversationId?: string | null;
  timeoutMs: number;
  /** agy model id (`agy models`); omitted/null = Antigravity default. */
  model?: string | null;
  /** Poll this between events; when it returns true the child is killed. */
  shouldCancel?: () => boolean;
  agyBin?: string; // default "agy" on PATH
}

/** Pure arg construction for runAgy — split out so tests never spawn. */
export function buildAgyArgs(opts: Pick<AgyRunOptions, "prompt" | "timeoutMs" | "model" | "conversationId">): string[] {
  const args = [
    "-p", opts.prompt,
    "--output-format", "stream-json",
    "--dangerously-skip-permissions",
    "--print-timeout", `${Math.ceil(opts.timeoutMs / 60_000)}m`,
  ];
  if (opts.model) args.push("--model", opts.model);
  if (opts.conversationId) args.push("--conversation", opts.conversationId);
  return args;
}

/** The worker's injection seam: tests supply a fake that replays fixtures. */
export type AgyDriver = (opts: AgyRunOptions, onEvent: (e: AgyEvent) => void) => Promise<AgyRunOutcome>;

export const runAgy: AgyDriver = (opts, onEvent) =>
  new Promise((resolve) => {
    const child = spawn(opts.agyBin ?? process.env.AGY_BIN ?? "agy", buildAgyArgs(opts), {
      cwd: opts.cwd, windowsHide: true, stdio: ["ignore", "pipe", "pipe"],
    });

    let conversationId: string | null = opts.conversationId ?? null;
    let result: Extract<AgyEvent, { kind: "result" }> | null = null;
    let killed = false;
    const kill = () => {
      killed = true;
      try {
        // agy can have its own children (browser tooling); on Windows,
        // child.kill() would orphan them — take the whole tree down.
        if (process.platform === "win32" && child.pid) {
          spawn("taskkill", ["/pid", String(child.pid), "/t", "/f"], { windowsHide: true, stdio: "ignore" })
            .on("error", () => { /* best-effort cleanup; the child's own close still resolves */ });
        } else {
          child.kill();
        }
      } catch { /* already gone */ }
    };
    const timer = setTimeout(kill, opts.timeoutMs);
    const cancelPoll = opts.shouldCancel
      ? setInterval(() => { if (opts.shouldCancel!()) kill(); }, 5_000)
      : null;

    const rl = createInterface({ input: child.stdout });
    rl.on("line", (line) => {
      const e = parseAgyEventLine(line);
      if (!e) return;
      if (e.kind === "init" && e.conversationId) conversationId = e.conversationId;
      if (e.kind === "result") result = e;
      onEvent(e);
    });
    child.stderr.on("data", () => { /* agy logs to its own file; stderr is noise */ });

    child.on("close", (code) => {
      clearTimeout(timer);
      if (cancelPoll) clearInterval(cancelPoll);
      resolve({ exitCode: code, result, conversationId, killed });
    });
    child.on("error", (e) => {
      clearTimeout(timer);
      if (cancelPoll) clearInterval(cancelPoll);
      resolve({ exitCode: null, result: null, conversationId, killed, spawnError: e.message });
    });
  });

/** `agy models` stdout → parsed list. Skips the "Fetching available
 *  models..." banner (no tab) and any line that isn't `id\tlabel`. */
export function parseModelsOutput(text: string): AgyModel[] {
  const models: AgyModel[] = [];
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || !line.includes("\t")) continue;
    const tab = line.indexOf("\t");
    const id = line.slice(0, tab).trim();
    const label = line.slice(tab + 1).trim();
    if (!id || !label) continue;
    models.push({ id, label });
  }
  return models;
}

/**
 * Live model catalogue via `agy models` (worker box only). Returns [] on any
 * failure — spawn error, timeout, or unparseable output — so a broken agy
 * degrades to "Antigravity default" in the dialog instead of crashing a poll.
 */
export function listAgyModels(agyBin?: string): Promise<AgyModel[]> {
  return new Promise((resolve) => {
    let child: ReturnType<typeof spawn>;
    try {
      child = spawn(agyBin ?? process.env.AGY_BIN ?? "agy", ["models"], {
        windowsHide: true, stdio: ["ignore", "pipe", "pipe"],
      });
    } catch { resolve([]); return; }

    let out = "";
    let settled = false;
    const finish = (models: AgyModel[]) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(models);
    };
    const timer = setTimeout(() => {
      try { child.kill(); } catch { /* already gone */ }
      finish([]);
    }, 60_000);

    child.stdout?.on("data", (d: Buffer) => { out += d.toString("utf8"); });
    child.stderr?.on("data", () => { /* drained; banner may land here */ });
    child.on("error", () => finish([]));
    child.on("close", () => finish(parseModelsOutput(out)));
  });
}
