import type { WireMessage } from "./llm";
import type { RawToolCall } from "./stream";
import type { AssistantMessageRow } from "./types";

/**
 * Stored rows → the message list a model is sent.
 *
 * Three jobs, in order of how badly they fail when skipped:
 *
 *  1. VALIDITY. Every OpenAI-compatible provider rejects an assistant turn
 *     whose tool_calls are not each answered by a tool message. A turn cut
 *     short (Stop pressed between a call and its result, a crash) leaves
 *     exactly that, so unanswered calls are dropped — and with them any tool
 *     result whose call is gone.
 *  2. BUDGET. Long chats are trimmed from the oldest TURN (a user message and
 *     everything answering it travel together), and old tool results are cut
 *     down: they were for answers already given.
 *  3. PORTABILITY. A vendor's tool-call extras (Gemini's thought signatures)
 *     go back only to the provider that issued them.
 *
 * The CURRENT turn's in-flight tool chain is never rebuilt from here — the
 * engine appends the provider's raw messages to this list, byte-exact, as the
 * vendors require.
 */

export interface HistoryOptions {
  /** Rough character budget for the whole history (≈ 4 chars per token). */
  maxChars: number;
  /** Tool results in earlier turns are cut to this many characters. */
  oldToolChars: number;
  /** The provider about to be called; extras from another provider are dropped. */
  provider: string;
}

export const DEFAULT_HISTORY: Omit<HistoryOptions, "provider"> = {
  // ≈ 60k tokens: generous for a conversation, far inside every assistant
  // model's window (MiniMax M2.x is the smallest at 204,800 for input+output).
  maxChars: 240_000,
  oldToolChars: 4_000,
};

function cleanCalls(calls: unknown, keepExtras: boolean): RawToolCall[] {
  if (!Array.isArray(calls)) return [];
  return calls
    .filter((c): c is RawToolCall => !!c && typeof c === "object" && typeof (c as RawToolCall).id === "string" && !!(c as RawToolCall).function?.name)
    .map((c) =>
      keepExtras
        ? c
        : { id: c.id, type: "function" as const, function: { name: c.function.name, arguments: c.function.arguments ?? "{}" } },
    );
}

const clip = (s: string, n: number) => (s.length > n ? `${s.slice(0, n)}… [cut: earlier result]` : s);

/** Group rows into turns, each opened by its user message. */
function turnsOf(rows: AssistantMessageRow[]): AssistantMessageRow[][] {
  const turns: AssistantMessageRow[][] = [];
  for (const row of rows) {
    if (row.role === "user" || !turns.length) turns.push([row]);
    else turns[turns.length - 1].push(row);
  }
  return turns;
}

/** One turn → valid wire messages. */
function turnMessages(turn: AssistantMessageRow[], opts: HistoryOptions, isLatest: boolean): WireMessage[] {
  const answered = new Set(turn.filter((r) => r.role === "tool" && r.tool_call_id).map((r) => r.tool_call_id!));
  const out: WireMessage[] = [];
  const kept = new Set<string>();
  for (const row of turn) {
    if (row.role === "user") {
      if (row.content.trim()) out.push({ role: "user", content: row.content });
      continue;
    }
    if (row.role === "assistant") {
      const calls = cleanCalls(row.tool_calls, !row.provider || row.provider === opts.provider).filter((c) => answered.has(c.id));
      const content = row.status === "error" ? "" : row.content;
      if (!calls.length && !content.trim()) continue;
      for (const c of calls) kept.add(c.id);
      out.push(calls.length ? { role: "assistant", content: content || null, tool_calls: calls } : { role: "assistant", content });
      continue;
    }
    // A tool result: only when its call made it in, and only after it.
    if (!row.tool_call_id || !kept.has(row.tool_call_id)) continue;
    out.push({
      role: "tool",
      tool_call_id: row.tool_call_id,
      ...(row.tool_name ? { name: row.tool_name } : {}),
      content: isLatest ? row.content : clip(row.content, opts.oldToolChars),
    });
  }
  return out;
}

const sizeOf = (msgs: WireMessage[]) =>
  msgs.reduce((s, m) => s + (m.content?.length ?? 0) + (m.role === "assistant" && m.tool_calls ? JSON.stringify(m.tool_calls).length : 0), 0);

/**
 * The history to send, newest turns kept first until the budget runs out. The
 * latest turn (normally the user's new message) is always kept.
 */
export function buildHistory(rows: AssistantMessageRow[], opts: HistoryOptions): WireMessage[] {
  const turns = turnsOf(rows);
  const picked: WireMessage[][] = [];
  let used = 0;
  for (let i = turns.length - 1; i >= 0; i--) {
    const msgs = turnMessages(turns[i], opts, i === turns.length - 1);
    const size = sizeOf(msgs);
    if (picked.length && used + size > opts.maxChars) break;
    picked.unshift(msgs);
    used += size;
  }
  const flat = picked.flat();
  // History must open with the user; and back-to-back user messages (a turn
  // whose answer failed) are merged, which every provider accepts.
  while (flat.length && flat[0].role !== "user") flat.shift();
  const merged: WireMessage[] = [];
  for (const m of flat) {
    const prev = merged[merged.length - 1];
    if (prev && prev.role === "user" && m.role === "user") prev.content = `${prev.content}\n\n${m.content}`;
    else merged.push({ ...m });
  }
  return merged;
}
