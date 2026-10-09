/**
 * The pure half of the assistant's streaming chat call: SSE framing, reading
 * one OpenAI-style chunk, accumulating streamed tool calls, and splitting a
 * model's visible "thinking" out of its reply.
 *
 * No I/O — `llm.ts` drives these over a live response body; the tests drive
 * them over fixtures. Everything here is about NOT LOSING BYTES the vendor
 * needs back: MiniMax requires the whole assistant message (its `<think>`
 * block included) to be sent back while a tool-call chain is in progress, and
 * Gemini 3 rejects the next request outright if a tool call comes back without
 * the thought signature it was issued with.
 */

import type { TokenUsage } from "@/lib/ai-tools/providers/gate";

/* ----------------------------------------------------------- tool calls */

/** One tool call exactly as the vendor sent it — extras and all. */
export interface RawToolCall {
  id: string;
  type: "function";
  function: { name: string; arguments: string };
  /**
   * Vendor extras ride along VERBATIM. Gemini 3 puts the thought signature it
   * requires on the next request at `extra_content.google.thought_signature`;
   * dropping it is a 400, not a degradation.
   */
  [extra: string]: unknown;
}

interface PartialCall {
  index: number;
  id: string;
  type: string;
  name: string;
  args: string;
  extras: Record<string, unknown>;
}

const isPlainObject = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" && v !== null && !Array.isArray(v);

function isCompleteJson(s: string): boolean {
  if (!s.trim()) return false;
  try {
    JSON.parse(s);
    return true;
  } catch {
    return false;
  }
}

/**
 * Join a streamed string slice onto what came before. Most vendors stream the
 * NEXT slice; a few re-send the whole value so far on every chunk. A piece
 * that strictly extends the accumulated value can only be the cumulative
 * form — an incremental slice of valid JSON never repeats everything before it.
 */
function joinPiece(prev: string, piece: string): string {
  if (!prev) return piece;
  if (piece.length > prev.length && piece.startsWith(prev)) return piece;
  return prev + piece;
}

/** Objects merge key by key; anything else is last-non-empty-wins. */
function mergeExtra(prev: unknown, next: unknown): unknown {
  if (isPlainObject(prev) && isPlainObject(next)) {
    const out: Record<string, unknown> = { ...prev };
    for (const [k, v] of Object.entries(next)) out[k] = mergeExtra(out[k], v);
    return out;
  }
  if (next === undefined || next === null || next === "") return prev ?? next;
  return next;
}

/**
 * Accumulates `choices[0].delta.tool_calls` fragments into whole calls.
 *
 * OpenAI streams a call as an `index`ed first fragment (id, name) followed by
 * slices of `arguments`. Gemini's compat layer sends each call whole, with its
 * signature in `extra_content`. Some compat layers omit `index`; there a new
 * `id` starts a new call and anything else continues the last one.
 */
export class ToolCallAccumulator {
  private readonly calls: PartialCall[] = [];

  add(fragments: unknown): void {
    if (!Array.isArray(fragments)) return;
    for (const raw of fragments) {
      if (!isPlainObject(raw)) continue;
      const slot = this.slotFor(raw);
      for (const [key, value] of Object.entries(raw)) {
        if (key === "index") continue;
        if (key === "id") {
          if (typeof value === "string" && value && !slot.id) slot.id = value;
          continue;
        }
        if (key === "type") {
          if (typeof value === "string" && value) slot.type = value;
          continue;
        }
        if (key === "function") {
          if (!isPlainObject(value)) continue;
          const name = value.name;
          if (typeof name === "string" && name && name !== slot.name) slot.name = joinPiece(slot.name, name);
          const args = value.arguments;
          if (args !== undefined && args !== null) {
            slot.args = joinPiece(slot.args, typeof args === "string" ? args : JSON.stringify(args));
          }
          continue;
        }
        slot.extras[key] = mergeExtra(slot.extras[key], value);
      }
    }
  }

  private slotFor(fragment: Record<string, unknown>): PartialCall {
    const fresh = (index: number): PartialCall => {
      const slot = { index, id: "", type: "function", name: "", args: "", extras: {} };
      this.calls.push(slot);
      return slot;
    };
    if (typeof fragment.index === "number") {
      return this.calls.find((c) => c.index === fragment.index) ?? fresh(fragment.index);
    }

    // No index. Gemini's compat layer has been seen sending parallel calls
    // whole, with neither `index` nor a usable `id`, so "is this the next
    // call or more of the last one?" has to be read from the fragment itself.
    const last = this.calls[this.calls.length - 1];
    const next = () => fresh(this.calls.reduce((max, c) => Math.max(max, c.index + 1), 0));
    if (!last) return next();

    const id = typeof fragment.id === "string" ? fragment.id : "";
    if (id) return !last.id || last.id === id ? last : next();

    const fn = isPlainObject(fragment.function) ? fragment.function : null;
    const name = fn && typeof fn.name === "string" ? fn.name : "";
    if (name && last.name) {
      if (name !== last.name && !name.startsWith(last.name)) return next();
      // Same function again: a continuation only if it extends the arguments
      // so far; a complete call followed by another named fragment is a second
      // call to the same tool.
      const args = fn && typeof fn.arguments === "string" ? fn.arguments : "";
      const extends_ = args.length > last.args.length && args.startsWith(last.args);
      if (!extends_ && isCompleteJson(last.args)) return next();
    }
    return last;
  }

  get size(): number {
    return this.calls.length;
  }

  /**
   * Whole calls in index order. A fragment set with no function name is not a
   * call (a vendor that sent an empty delta) and is dropped. A missing id is
   * synthesised: the tool result must reference SOME id, and the very same one
   * goes back on the assistant message, so the pair still matches.
   */
  result(): RawToolCall[] {
    return [...this.calls]
      .sort((a, b) => a.index - b.index)
      .filter((c) => c.name)
      .map((c, i) => ({
        ...c.extras,
        id: c.id || `call_${i}_${c.name}`,
        type: "function" as const,
        function: { name: c.name, arguments: c.args || "{}" },
      }));
  }
}

/* -------------------------------------------------------------- thinking */

const OPEN = "<think>";
const CLOSE = "</think>";

/** Length of the longest suffix of `s` that is a proper prefix of `tag`. */
function partialTagSuffix(s: string, tag: string): number {
  for (let n = Math.min(tag.length - 1, s.length); n > 0; n--) {
    if (s.endsWith(tag.slice(0, n))) return n;
  }
  return 0;
}

/**
 * Splits a streamed reply into what the user should read and the model's
 * `<think>…</think>` reasoning (MiniMax emits its thinking inline, wrapped in
 * those tags). Tags may arrive split across chunks, so a tail that could be
 * the start of a tag is held back until the next chunk settles it.
 *
 * Leading whitespace before the first visible character is dropped — the
 * answer after a think block usually opens with a blank line.
 */
export class ThinkSplitter {
  private inThink = false;
  private pending = "";
  private sawVisible = false;

  push(chunk: string): { text: string; reasoning: string } {
    let s = this.pending + chunk;
    this.pending = "";
    let text = "";
    let reasoning = "";
    while (s.length > 0) {
      const tag = this.inThink ? CLOSE : OPEN;
      const at = s.indexOf(tag);
      if (at === -1) {
        const keep = partialTagSuffix(s, tag);
        const emit = s.slice(0, s.length - keep);
        this.pending = s.slice(s.length - keep);
        if (this.inThink) reasoning += emit;
        else text += emit;
        break;
      }
      if (this.inThink) reasoning += s.slice(0, at);
      else text += s.slice(0, at);
      s = s.slice(at + tag.length);
      this.inThink = !this.inThink;
    }
    return { text: this.visible(text), reasoning };
  }

  /** End of stream: whatever was held back is released as-is. */
  flush(): { text: string; reasoning: string } {
    const rest = this.pending;
    this.pending = "";
    return this.inThink ? { text: "", reasoning: rest } : { text: this.visible(rest), reasoning: "" };
  }

  private visible(t: string): string {
    if (this.sawVisible || !t) return t;
    const trimmed = t.replace(/^\s+/, "");
    if (trimmed) this.sawVisible = true;
    return trimmed;
  }
}

/** One-shot form of the splitter, for a reply that arrived whole. */
export function splitThinking(full: string): { text: string; reasoning: string } {
  const splitter = new ThinkSplitter();
  const a = splitter.push(full);
  const b = splitter.flush();
  return { text: a.text + b.text, reasoning: a.reasoning + b.reasoning };
}

/* ------------------------------------------------------------ SSE frames */

/** Collects complete lines out of arbitrarily-chunked text. */
export class LineBuffer {
  private buffer = "";

  push(chunk: string): string[] {
    this.buffer += chunk;
    const lines: string[] = [];
    let nl = this.buffer.indexOf("\n");
    while (nl !== -1) {
      lines.push(this.buffer.slice(0, nl));
      this.buffer = this.buffer.slice(nl + 1);
      nl = this.buffer.indexOf("\n");
    }
    return lines;
  }

  /** A final frame without a trailing newline still counts. */
  flush(): string[] {
    const rest = this.buffer;
    this.buffer = "";
    return rest.trim() ? [rest] : [];
  }
}

/**
 * One SSE line → its JSON payload, `"done"` for the `[DONE]` terminator, or
 * null for anything that is not a data line (comments, `event:` fields, keep-
 * alives) or does not parse. A mangled frame is skipped, never fatal.
 */
export function parseSseLine(line: string): unknown | "done" | null {
  const trimmed = line.trim();
  if (!trimmed.startsWith("data:")) return null;
  const payload = trimmed.slice(5).trim();
  if (!payload) return null;
  if (payload === "[DONE]") return "done";
  try {
    return JSON.parse(payload) as unknown;
  } catch {
    return null;
  }
}

/* ------------------------------------------------------------ one chunk */

/** A vendor-reported failure that arrived as a body, not an HTTP status. */
export interface InBandError {
  message: string;
  /** The HTTP status this failure is equivalent to, for retry decisions. */
  status: number;
}

export interface ChunkView {
  content: string;
  /** Reasoning delivered in a dedicated field rather than inline `<think>`. */
  reasoning: string;
  toolCalls: unknown[] | null;
  finishReason: string | null;
  usage: TokenUsage | null;
  error: InBandError | null;
}

/**
 * MiniMax reports some failures as HTTP 200 with a non-zero
 * `base_resp.status_code`. Mapped to the HTTP status they behave like, so the
 * shared retry classification applies: rate limits wait, server faults retry,
 * a bad key or an empty balance stops at once.
 */
export function minimaxStatusToHttp(code: number): number {
  switch (code) {
    case 1002: // rate limit
    case 1039: // token-per-minute limit
      return 429;
    case 1004: // authentication failed
    case 2049: // invalid API key
      return 401;
    case 1008: // insufficient balance
      return 402;
    case 1026: // input flagged
    case 1027: // output flagged
    case 2013: // invalid parameters
      return 400;
    default:
      // Unknown server-side codes (1000 unknown, 1001 timeout, 1013 internal…)
      // behave like a 5xx: retried, but only within the bounded budget.
      return 502;
  }
}

function errorOf(j: Record<string, unknown>): InBandError | null {
  const base = j.base_resp;
  if (isPlainObject(base) && typeof base.status_code === "number" && base.status_code !== 0) {
    const msg = typeof base.status_msg === "string" && base.status_msg ? base.status_msg : `MiniMax error ${base.status_code}`;
    return { message: msg, status: minimaxStatusToHttp(base.status_code) };
  }
  const err = j.error;
  if (isPlainObject(err)) {
    const message = typeof err.message === "string" && err.message ? err.message : "The model returned an error.";
    const code = typeof err.code === "number" ? err.code : typeof err.status === "number" ? err.status : 502;
    return { message, status: code >= 400 && code < 600 ? code : 502 };
  }
  if (typeof err === "string" && err) return { message: err, status: 502 };
  return null;
}

/** Reasoning text from whichever field this vendor uses for it. */
function reasoningOf(delta: Record<string, unknown>): string {
  if (typeof delta.reasoning_content === "string") return delta.reasoning_content;
  if (typeof delta.reasoning === "string") return delta.reasoning;
  const details = delta.reasoning_details;
  if (Array.isArray(details)) {
    return details
      .map((d) => (isPlainObject(d) && typeof d.text === "string" ? d.text : ""))
      .join("");
  }
  return "";
}

/**
 * Read one parsed chunk — a streaming `delta` or, for a vendor that ignored
 * `stream: true`, a whole `message`. Unknown shapes read as empty.
 */
export function readChunk(json: unknown): ChunkView {
  const view: ChunkView = { content: "", reasoning: "", toolCalls: null, finishReason: null, usage: null, error: null };
  if (!isPlainObject(json)) return view;
  view.error = errorOf(json);
  if (isPlainObject(json.usage)) view.usage = json.usage as TokenUsage;
  const choices = json.choices;
  if (!Array.isArray(choices) || !isPlainObject(choices[0])) return view;
  const choice = choices[0];
  if (typeof choice.finish_reason === "string") view.finishReason = choice.finish_reason;
  const body = isPlainObject(choice.delta) ? choice.delta : isPlainObject(choice.message) ? choice.message : null;
  if (!body) return view;
  if (typeof body.content === "string") view.content = body.content;
  view.reasoning = reasoningOf(body);
  if (Array.isArray(body.tool_calls)) view.toolCalls = body.tool_calls;
  return view;
}
