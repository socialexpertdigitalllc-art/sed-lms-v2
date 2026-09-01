// lib/site-agent/agy.ts
/**
 * Driver for the `agy` CLI (Antigravity) in headless print mode.
 *
 * The NDJSON event schema below was pinned from a REAL 1.1.22 run
 * (tests/fixtures/agy/error-run.ndjson — Phase 0 spike, 2026-09-01). The
 * parser is deliberately tolerant: agy is preview-cadence software, so any
 * unrecognized event kind degrades to {kind:"other"} and only unparseable
 * lines are dropped. The worker's behaviour depends ONLY on `init` (grab the
 * conversation id) and `result` (status/usage); everything else just feeds
 * the progress tail.
 *
 * runAgy spawns the CLI — Windows-box worker only; never imported by prod
 * routes (they touch neither child_process nor this module).
 */
import { spawn } from "node:child_process";
import { createInterface } from "node:readline";

export type AgyEvent =
  | { kind: "init"; conversationId: string; permissionMode: string | null }
  | { kind: "step"; stepType: string; state: string; index: number }
  | {
      kind: "result"; status: "SUCCESS" | "ERROR"; response: string; error: string | null;
      usage: Record<string, number> | null; numTurns: number | null; durationSeconds: number | null;
    }
  | { kind: "other"; raw: string };

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
    return {
      kind: "step",
      stepType: typeof s.step_type === "string" ? s.step_type : "unknown",
      state: typeof s.state === "string" ? s.state : "unknown",
      index: typeof s.step_index === "number" ? s.step_index : -1,
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

/** One short line per event for the progress tail (or null to skip). */
export function summarizeEventForTail(e: AgyEvent): string | null {
  switch (e.kind) {
    case "init": return "[agent started]";
    case "step": return e.state === "DONE" ? `[${e.stepType}]` : null;
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
  /** Poll this between events; when it returns true the child is killed. */
  shouldCancel?: () => boolean;
  agyBin?: string; // default "agy" on PATH
}

/** The worker's injection seam: tests supply a fake that replays fixtures. */
export type AgyDriver = (opts: AgyRunOptions, onEvent: (e: AgyEvent) => void) => Promise<AgyRunOutcome>;

export const runAgy: AgyDriver = (opts, onEvent) =>
  new Promise((resolve) => {
    const args = [
      "-p", opts.prompt,
      "--output-format", "stream-json",
      "--dangerously-skip-permissions",
      "--print-timeout", `${Math.ceil(opts.timeoutMs / 60_000)}m`,
    ];
    if (opts.conversationId) args.push("--conversation", opts.conversationId);

    const child = spawn(opts.agyBin ?? process.env.AGY_BIN ?? "agy", args, {
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
