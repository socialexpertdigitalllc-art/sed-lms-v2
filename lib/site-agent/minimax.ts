// lib/site-agent/minimax.ts
/**
 * The AI developer's MiniMax engine: a tool-calling agent that edits the
 * run's scratch copy of a site through a handful of file tools, driven by
 * MiniMax's chat-completions API. It runs on the LMS server, so it needs
 * neither the office worker box nor any Antigravity quota.
 *
 * It plugs into the SAME engine as Antigravity (lib/site-agent/worker.ts) by
 * speaking the AgyDriver contract: it gets the workspace folder and the task
 * prompt, emits AgyEvents for the progress tail, and returns an
 * AgyRunOutcome. Everything around it — claim, keepalive, discard, harvest,
 * the review screen, deploy — is shared, so a MiniMax result is reviewed and
 * deployed exactly like an Antigravity one.
 *
 * The tools carry agy's own names (grep_search, view_file,
 * replace_file_content, …) so the task prompt's guidance and the tail's
 * plain-language narration fit both engines. There is no shell: the model can
 * only list, search, read, edit, write and delete files inside the workspace.
 */
import { mkdir, readdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { dirname, join, resolve, sep } from "node:path";
import { providerSpecFor } from "@/lib/ai-tools/providers/config";
import { getModel } from "@/lib/ai-tools/providers/registry";
import { isAbortedError } from "@/lib/ai-tools/abort";
import { isRetryableError } from "@/lib/ai-tools/providers/errors";
import type { ProviderSpec } from "@/lib/ai-tools/run";
import { estimateMessageTokens, streamChat, type ToolDefinition, type WireMessage } from "@/lib/assistant/llm";
import type { AgyDriver, AgyEvent, AgyRunOptions, AgyRunOutcome } from "./agy";
import { DEFAULT_MINIMAX_MODEL, MINIMAX_DEFAULT_MAX_TOKENS, type MinimaxSettings } from "./options";

/** Stored as a MiniMax run's conversation_id after its first round. */
export const MINIMAX_CONVERSATION = "minimax";

/* ------------------------------------------------------------ workspace */

/** Extensions read as text without sniffing. */
const TEXT_EXT = /\.(html?|css|js|mjs|cjs|json|txt|xml|svg|md|php|map|webmanifest|csv|ya?ml|ts|tsx|jsx|htaccess|ini|conf|ics|vcf)$/i;
const MAX_READ_LINES = 600;
const DEFAULT_READ_LINES = 400;
const MAX_TOOL_CHARS = 60_000;
const MAX_GREP_MATCHES = 80;
const MAX_GREP_FILE_BYTES = 2 * 1024 * 1024;
const MAX_WRITE_BYTES = 2 * 1024 * 1024;
const MAX_LIST_FILES = 400;

/** A site-relative path from the model, made safe: forward slashes, no root,
 *  no `..`. Null when it tries to leave the site. */
export function cleanRelPath(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  let p = raw.trim().replace(/\\/g, "/");
  p = p.replace(/^\.\/+/, "").replace(/^\/+/, "");
  if (/^[a-z]:/i.test(p)) return null;
  const parts = p.split("/").filter((x) => x !== "" && x !== ".");
  if (parts.some((x) => x === "..")) return null;
  return parts.join("/");
}

function inside(root: string, rel: string): string | null {
  const target = resolve(root, rel);
  return target === root || target.startsWith(root + sep) ? target : null;
}

async function walk(root: string, dir: string, out: { path: string; bytes: number }[]): Promise<void> {
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    if (entry.isSymbolicLink()) continue;
    const full = join(dir, entry.name);
    if (entry.isDirectory()) await walk(root, full, out);
    else out.push({ path: full.slice(root.length + 1).split(sep).join("/"), bytes: (await stat(full)).size });
  }
}

function isText(path: string, bytes: Uint8Array): boolean {
  if (TEXT_EXT.test(path)) return true;
  const head = bytes.subarray(0, 8192);
  return !head.includes(0);
}

const kb = (n: number) => (n < 1024 ? `${n} B` : `${(n / 1024).toFixed(1)} KB`);
const clip = (s: string, n = MAX_TOOL_CHARS) => (s.length > n ? `${s.slice(0, n)}\n… [cut at ${n} characters]` : s);

/** The file tools, bound to one workspace folder. Every result is a string
 *  for the model; a mistake is reported, never thrown, so it can correct. */
export function siteTools(rootDir: string) {
  const root = resolve(rootDir);

  const resolvePath = (raw: unknown): { rel: string; abs: string } | string => {
    const rel = cleanRelPath(raw ?? "");
    if (rel === null) return "Error: that path is outside the site. Use paths relative to the site's root, like \"index.html\" or \"css/style.css\".";
    const abs = inside(root, rel);
    if (!abs) return "Error: that path is outside the site.";
    return { rel, abs };
  };

  const readText = async (raw: unknown): Promise<{ rel: string; abs: string; text: string } | string> => {
    const r = resolvePath(raw);
    if (typeof r === "string") return r;
    if (!r.rel) return "Error: give a file path.";
    let bytes: Uint8Array;
    try {
      bytes = new Uint8Array(await readFile(r.abs));
    } catch {
      return `Error: ${r.rel} does not exist. Use list_dir or grep_search to find the right file.`;
    }
    if (!isText(r.rel, bytes)) return `Error: ${r.rel} is a binary file (${kb(bytes.byteLength)}) — it can't be read or edited as text.`;
    return { ...r, text: new TextDecoder().decode(bytes) };
  };

  return {
    async list_dir(args: { path?: unknown; recursive?: unknown }): Promise<string> {
      const r = resolvePath(args.path ?? "");
      if (typeof r === "string") return r;
      if (args.recursive === true) {
        const files: { path: string; bytes: number }[] = [];
        try {
          await walk(root, r.abs, files);
        } catch {
          return `Error: ${r.rel || "/"} is not a folder.`;
        }
        files.sort((a, b) => a.path.localeCompare(b.path));
        const shown = files.slice(0, MAX_LIST_FILES).map((f) => `${f.path} (${kb(f.bytes)})`);
        return `${files.length} file(s)${r.rel ? ` under ${r.rel}/` : ""}:\n${shown.join("\n")}${files.length > shown.length ? `\n… and ${files.length - shown.length} more` : ""}`;
      }
      try {
        const entries = await readdir(r.abs, { withFileTypes: true });
        const lines: string[] = [];
        for (const e of entries.sort((a, b) => a.name.localeCompare(b.name))) {
          if (e.isSymbolicLink()) continue;
          if (e.isDirectory()) lines.push(`${e.name}/`);
          else lines.push(`${e.name} (${kb((await stat(join(r.abs, e.name))).size)})`);
        }
        return `${r.rel || "(site root)"}:\n${lines.join("\n") || "(empty)"}`;
      } catch {
        return `Error: ${r.rel || "/"} is not a folder.`;
      }
    },

    async view_file(args: { path?: unknown; start_line?: unknown; end_line?: unknown }): Promise<string> {
      const f = await readText(args.path);
      if (typeof f === "string") return f;
      const lines = f.text.split("\n");
      const total = lines.length;
      const start = Math.max(1, Math.floor(Number(args.start_line) || 1));
      const askedEnd = Math.floor(Number(args.end_line) || 0);
      const end = Math.min(total, askedEnd >= start ? askedEnd : start + DEFAULT_READ_LINES - 1, start + MAX_READ_LINES - 1);
      if (start > total) return `${f.rel} has only ${total} lines.`;
      const width = String(end).length;
      const body = lines
        .slice(start - 1, end)
        .map((l, i) => `${String(start + i).padStart(width)}| ${l}`)
        .join("\n");
      const more = end < total ? `\n[lines ${start}–${end} of ${total}; ask for start_line ${end + 1} to read on]` : "";
      return clip(`${f.rel} — lines ${start}–${end} of ${total}:\n${body}${more}`);
    },

    async grep_search(args: { query?: unknown; is_regex?: unknown; case_sensitive?: unknown; path?: unknown }): Promise<string> {
      const query = typeof args.query === "string" ? args.query : "";
      if (!query) return "Error: give the text to search for.";
      let re: RegExp;
      try {
        const flags = args.case_sensitive === true ? "" : "i";
        re = args.is_regex === true ? new RegExp(query, flags) : new RegExp(query.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), flags);
      } catch {
        return "Error: that is not a valid regular expression. Search for plain text instead (is_regex false).";
      }
      const r = resolvePath(args.path ?? "");
      if (typeof r === "string") return r;
      const files: { path: string; bytes: number }[] = [];
      try {
        const st = await stat(r.abs);
        if (st.isDirectory()) await walk(root, r.abs, files);
        else files.push({ path: r.rel, bytes: st.size });
      } catch {
        return `Error: ${r.rel} does not exist.`;
      }
      const hits: string[] = [];
      let total = 0;
      for (const file of files.sort((a, b) => a.path.localeCompare(b.path))) {
        if (file.bytes > MAX_GREP_FILE_BYTES) continue;
        const bytes = new Uint8Array(await readFile(join(root, file.path)));
        if (!isText(file.path, bytes)) continue;
        const lines = new TextDecoder().decode(bytes).split("\n");
        for (let i = 0; i < lines.length; i++) {
          if (!re.test(lines[i])) continue;
          total++;
          if (hits.length < MAX_GREP_MATCHES) {
            const text = lines[i].trim();
            hits.push(`${file.path}:${i + 1}: ${text.length > 240 ? `${text.slice(0, 240)}…` : text}`);
          }
        }
      }
      if (!total) return `No matches for ${JSON.stringify(query)}.`;
      return clip(`${total} match(es)${total > hits.length ? ` (first ${hits.length} shown)` : ""}:\n${hits.join("\n")}`);
    },

    async replace_file_content(args: { path?: unknown; old_text?: unknown; new_text?: unknown; replace_all?: unknown }): Promise<string> {
      const f = await readText(args.path);
      if (typeof f === "string") return f;
      const oldText = typeof args.old_text === "string" ? args.old_text : "";
      const newText = typeof args.new_text === "string" ? args.new_text : null;
      if (!oldText) return "Error: old_text is required — copy the exact text to replace from view_file (without the line numbers).";
      if (newText === null) return "Error: new_text is required (use an empty string to remove the text).";
      if (oldText === newText) return "Error: old_text and new_text are the same — nothing would change.";
      const count = f.text.split(oldText).length - 1;
      if (count === 0) {
        return `Error: old_text was not found in ${f.rel}. It must match the file exactly, including spaces and line breaks — view the lines again and copy them without the line-number prefix.`;
      }
      if (count > 1 && args.replace_all !== true) {
        const lines: number[] = [];
        let from = 0;
        for (let n = 0; n < count && lines.length < 10; n++) {
          const at = f.text.indexOf(oldText, from);
          lines.push(f.text.slice(0, at).split("\n").length);
          from = at + oldText.length;
        }
        return `Error: old_text appears ${count} times in ${f.rel} (lines ${lines.join(", ")}). Include more surrounding text so it is unique, or set replace_all to true to change every one.`;
      }
      const next = args.replace_all === true ? f.text.split(oldText).join(newText) : f.text.replace(oldText, () => newText);
      await writeFile(f.abs, next);
      return `Edited ${f.rel}: ${args.replace_all === true ? count : 1} replacement(s).`;
    },

    async write_to_file(args: { path?: unknown; content?: unknown }): Promise<string> {
      const r = resolvePath(args.path);
      if (typeof r === "string") return r;
      if (!r.rel) return "Error: give a file path.";
      if (typeof args.content !== "string") return "Error: content is required.";
      const bytes = new TextEncoder().encode(args.content);
      if (bytes.byteLength > MAX_WRITE_BYTES) return `Error: that file would be ${kb(bytes.byteLength)} — too large for one write.`;
      let existed = true;
      try {
        await stat(r.abs);
      } catch {
        existed = false;
      }
      await mkdir(dirname(r.abs), { recursive: true });
      await writeFile(r.abs, bytes);
      return `${existed ? "Rewrote" : "Created"} ${r.rel} (${kb(bytes.byteLength)}).`;
    },

    async delete_file(args: { path?: unknown }): Promise<string> {
      const r = resolvePath(args.path);
      if (typeof r === "string") return r;
      if (!r.rel) return "Error: give a file path.";
      if (r.rel.toLowerCase() === "index.html") return "Error: index.html must stay — the site would not be deployable without it.";
      try {
        const st = await stat(r.abs);
        if (st.isDirectory()) return `Error: ${r.rel} is a folder; delete the files in it one by one.`;
      } catch {
        return `Error: ${r.rel} does not exist.`;
      }
      await rm(r.abs, { force: true });
      return `Deleted ${r.rel}.`;
    },
  };
}

export type SiteTools = ReturnType<typeof siteTools>;

/* ---------------------------------------------------------------- tools */

const str = (description: string) => ({ type: "string", description });

export const MINIMAX_TOOLS: ToolDefinition[] = [
  {
    type: "function",
    function: {
      name: "list_dir",
      description: "List a folder of the site. Paths are relative to the site root; omit path for the root. recursive=true lists every file below it.",
      parameters: {
        type: "object",
        properties: { path: str("Folder, relative to the site root. Omit for the root."), recursive: { type: "boolean" } },
      },
    },
  },
  {
    type: "function",
    function: {
      name: "grep_search",
      description: "Find text in the site's files. Returns file:line: text for each matching line. Plain text by default; case-insensitive by default.",
      parameters: {
        type: "object",
        properties: {
          query: str("The text (or regular expression) to find."),
          is_regex: { type: "boolean", description: "Treat query as a regular expression." },
          case_sensitive: { type: "boolean" },
          path: str("Limit the search to this file or folder."),
        },
        required: ["query"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "view_file",
      description: `Read a text file with line numbers. Read only the lines you need: pass start_line and end_line (at most ${MAX_READ_LINES} lines per call).`,
      parameters: {
        type: "object",
        properties: { path: str("File, relative to the site root."), start_line: { type: "integer" }, end_line: { type: "integer" } },
        required: ["path"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "replace_file_content",
      description:
        "Edit a file: replace old_text (copied EXACTLY from the file, without line numbers) with new_text. old_text must be unique in the file unless replace_all is true. This is how every edit is made.",
      parameters: {
        type: "object",
        properties: {
          path: str("File, relative to the site root."),
          old_text: str("The exact current text."),
          new_text: str("The replacement text (empty string to delete)."),
          replace_all: { type: "boolean", description: "Replace every occurrence." },
        },
        required: ["path", "old_text", "new_text"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "write_to_file",
      description: "Create a new file, or replace a file's entire contents. Use only for NEW files — edit existing ones with replace_file_content.",
      parameters: {
        type: "object",
        properties: { path: str("File, relative to the site root."), content: str("The complete file contents.") },
        required: ["path", "content"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "delete_file",
      description: "Delete a file — only when the task asks for it. index.html can never be deleted.",
      parameters: { type: "object", properties: { path: str("File, relative to the site root.") }, required: ["path"] },
    },
  },
  {
    type: "function",
    function: {
      name: "finish",
      description: "Call once the task is complete, with a short plain-text summary of exactly what you changed and in which files.",
      parameters: { type: "object", properties: { summary: str("What you changed, and where.") }, required: ["summary"] },
    },
  },
];

const SYSTEM_PROMPT = [
  "You are a careful web developer editing a client's static website through file tools.",
  "You can only list, search, read, edit, create and delete files in the site — there is no shell, browser or internet.",
  "Make the smallest change that does what the task asks, keep the site's existing style and structure, and never break index.html.",
  "Work in as few steps as you can: search for what the task names, read just those lines, edit them, then call finish with your summary.",
].join(" ");

/* -------------------------------------------------------------- the loop */

/** One line for the tail, from a tool call's arguments. */
function paramsDigest(args: Record<string, unknown>): string | null {
  const v = args.path ?? args.query;
  if (typeof v !== "string" || !v.trim()) return null;
  const t = v.replace(/\s+/g, " ").trim();
  return t.length > 80 ? `${t.slice(0, 80)}…` : t;
}

/** Older tool results are replaced by a stub once the conversation nears
 *  the model's window; the most recent ones are always kept whole. */
function compact(messages: WireMessage[], keepRecent = 6): boolean {
  const toolIdx = messages.map((m, i) => (m.role === "tool" ? i : -1)).filter((i) => i >= 0);
  let changed = false;
  for (const i of toolIdx.slice(0, Math.max(0, toolIdx.length - keepRecent))) {
    const m = messages[i] as { role: "tool"; content: string };
    if (m.content.length > 200) {
      m.content = "[earlier tool output removed to save space — call the tool again if you still need it]";
      changed = true;
    }
  }
  return changed;
}

/** MiniMax's API parameters for one call, from the run's settings. Only what
 *  the chosen model accepts is sent (thinking "disabled" is a 400 on M3.1;
 *  reasoning_effort is honoured by M3.1 alone). */
export function minimaxRequestExtras(model: string, s: MinimaxSettings): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  const m31 = /^MiniMax-M3\.1/i.test(model);
  if (s.top_p !== undefined) out.top_p = s.top_p;
  if (s.thinking && !(m31 && s.thinking === "disabled")) out.thinking = { type: s.thinking };
  if (m31 && s.reasoning_effort) out.reasoning_effort = s.reasoning_effort;
  if (s.service_tier) out.service_tier = s.service_tier;
  return out;
}

export interface MinimaxDriverDeps {
  resolveSpec?: (model: string) => Promise<{ spec: ProviderSpec; reason: null } | { spec: null; reason: string }>;
  chat?: typeof streamChat;
}

const errorOutcome = (message: string, permanent: boolean): AgyRunOutcome => ({
  exitCode: null,
  conversationId: null,
  killed: false,
  permanent,
  result: { kind: "result", status: "ERROR", response: "", error: message, usage: null, numTurns: null, durationSeconds: null },
});

/** The MiniMax driver. `opts.cwd` is the run's scratch copy of the site. */
export function createMinimaxDriver(deps: MinimaxDriverDeps = {}): AgyDriver {
  const resolveSpec = deps.resolveSpec ?? ((model: string) => providerSpecFor("minimax", model));
  const chat = deps.chat ?? streamChat;

  return async (opts: AgyRunOptions, onEvent: (e: AgyEvent) => void): Promise<AgyRunOutcome> => {
    const startedAt = Date.now();
    const deadline = startedAt + Math.max(0, opts.timeoutMs);
    const model = opts.model || DEFAULT_MINIMAX_MODEL;
    const settings: MinimaxSettings & { max_steps: number } = opts.minimax ?? { max_steps: 50 };
    const descriptor = getModel("minimax", model);
    if (!descriptor) return errorOutcome(`MiniMax does not offer the model "${model}". Pick another one and try again.`, true);
    const resolved = await resolveSpec(model);
    if (!resolved.spec) {
      return errorOutcome(`MiniMax is not set up (${resolved.reason}). Add the MiniMax API key under Admin → AI providers.`, true);
    }
    const spec = resolved.spec;
    const contextWindow = descriptor.contextWindow ?? 204_800;
    const tools = siteTools(opts.cwd);

    // Stop on the dashboard's discard and at the time limit, mid-stream too.
    const controller = new AbortController();
    let timedOut = false;
    const watch = setInterval(() => {
      if (opts.shouldCancel?.()) controller.abort();
      if (Date.now() >= deadline) {
        timedOut = true;
        controller.abort();
      }
    }, 1000);

    const messages: WireMessage[] = [
      { role: "system", content: SYSTEM_PROMPT },
      { role: "user", content: opts.prompt },
    ];
    let inputTokens = 0;
    let outputTokens = 0;
    let steps = 0;
    let summary: string | null = null;
    let lastText = "";
    const killed = (): AgyRunOutcome => ({ exitCode: null, result: null, conversationId: null, killed: true });

    onEvent({ kind: "init", conversationId: "", permissionMode: null });
    try {
      while (summary === null && steps < settings.max_steps) {
        if (controller.signal.aborted || opts.shouldCancel?.() || Date.now() >= deadline) return killed();
        steps++;

        let estimate = estimateMessageTokens(messages, MINIMAX_TOOLS);
        if (estimate > contextWindow * 0.6 && compact(messages)) estimate = estimateMessageTokens(messages, MINIMAX_TOOLS);
        const room = contextWindow - estimate - 2048;
        const wanted = settings.max_tokens ?? Math.min(MINIMAX_DEFAULT_MAX_TOKENS, descriptor.recommendedOutputTokens ?? MINIMAX_DEFAULT_MAX_TOKENS);
        const maxTokens = Math.max(1024, Math.min(wanted, descriptor.maxOutputTokens, room));

        const res = await chat(spec, model, messages, {
          tools: MINIMAX_TOOLS,
          maxTokens,
          temperature: settings.temperature ?? 1,
          signal: controller.signal,
          timeoutMs: Math.max(30_000, deadline - Date.now()),
          extraBody: minimaxRequestExtras(model, settings),
        });
        inputTokens += res.usage?.prompt_tokens ?? 0;
        outputTokens += res.usage?.completion_tokens ?? 0;
        messages.push(res.message);

        const text = res.text.trim();
        if (text) {
          lastText = text;
          onEvent({ kind: "step", stepType: "agent_response", state: "DONE", index: steps, toolName: null, toolParams: null, textDelta: text });
        }
        if (!res.toolCalls.length) {
          // A reply with no tool call is the model saying it is done.
          summary = text || "Done.";
          break;
        }
        for (const call of res.toolCalls) {
          let args: Record<string, unknown> = {};
          let parseError = false;
          try {
            const parsed = JSON.parse(call.function.arguments || "{}") as unknown;
            if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) args = parsed as Record<string, unknown>;
          } catch {
            parseError = true;
          }
          const name = call.function.name;
          let content: string;
          if (parseError) {
            content = "Error: the arguments were not valid JSON. Send the call again with valid JSON arguments.";
          } else if (name === "finish") {
            summary = typeof args.summary === "string" && args.summary.trim() ? args.summary.trim() : lastText || "Done.";
            content = "OK";
          } else if (name in tools && name !== "finish") {
            onEvent({ kind: "step", stepType: "tool", state: "ACTIVE", index: steps, toolName: name, toolParams: paramsDigest(args), textDelta: null });
            try {
              content = await (tools as unknown as Record<string, (a: Record<string, unknown>) => Promise<string>>)[name](args);
            } catch (e) {
              content = `Error: ${e instanceof Error ? e.message : "the tool failed"}`;
            }
          } else {
            content = `Error: there is no tool called "${name}". Use list_dir, grep_search, view_file, replace_file_content, write_to_file, delete_file or finish.`;
          }
          messages.push({ role: "tool", tool_call_id: call.id, name, content });
        }
      }
    } catch (e) {
      if (isAbortedError(e) || controller.signal.aborted) return killed();
      const message = e instanceof Error ? e.message : "MiniMax call failed";
      // A bad key, an empty balance or a refused request will fail the same
      // way on another try; a dropped connection or a 5xx may not.
      return errorOutcome(message, !isRetryableError(e));
    } finally {
      clearInterval(watch);
    }
    if (timedOut) return killed();

    const response =
      summary ??
      `${lastText ? `${lastText}\n\n` : ""}(Stopped at the ${settings.max_steps}-step limit — check what was done before deploying, or raise "Max steps".)`;
    const result: Extract<AgyEvent, { kind: "result" }> = {
      kind: "result",
      status: "SUCCESS",
      response,
      error: null,
      usage: { input_tokens: inputTokens, output_tokens: outputTokens, steps },
      numTurns: steps,
      durationSeconds: Math.round((Date.now() - startedAt) / 1000),
    };
    onEvent(result);
    // The marker makes a "Request changes" round start from THIS result (the
    // worker seeds a revise from result.zip whenever a conversation is set);
    // MiniMax keeps no server-side conversation, the files carry the context.
    return { exitCode: 0, result, conversationId: MINIMAX_CONVERSATION, killed: false };
  };
}
