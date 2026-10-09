import { AiCallAborted, combineAbortSignals, isAbortedError } from "@/lib/ai-tools/abort";
import { backoffDelayMs, GATE_MAX_WAIT_MS, type ProviderSpec } from "@/lib/ai-tools/run";
import { CHARS_PER_TOKEN, getGate, sleep, type TokenUsage } from "@/lib/ai-tools/providers/gate";
import {
  callTimedOutMessage,
  isRateLimitError,
  isRetryableError,
  parseRetryAfter,
  ProviderHttpError,
  rateLimitHeadersFrom,
} from "@/lib/ai-tools/providers/errors";
import { LineBuffer, parseSseLine, readChunk, ThinkSplitter, ToolCallAccumulator, type RawToolCall } from "./stream";

/**
 * The assistant's model call: a MULTI-TURN, TOOL-CALLING, streamed
 * chat/completions request against any OpenAI-compatible provider in the
 * registry (MiniMax first, Gemini as the alternative).
 *
 * `callWithProvider` in lib/ai-tools/run.ts speaks exactly one system + one
 * user message and returns text; a conversation that looks data up needs the
 * whole message list, `tools`, and `tool_calls` back. It shares everything
 * else with that path on purpose — the same provider rate gate (so chats and
 * website generation draw from ONE vendor quota), the same backoff, the same
 * error classification.
 *
 * ROUND-TRIP FIDELITY is the contract. `result.message` is the assistant turn
 * to append before sending tool results back, and it carries exactly what the
 * vendor sent: MiniMax's inline `<think>` block (it requires the complete
 * message back during a tool chain) and every tool call's extras (Gemini 3
 * puts a thought signature there and 400s the next request without it).
 */

export interface WireAssistantMessage {
  role: "assistant";
  content: string | null;
  tool_calls?: RawToolCall[];
  /** Echoed only when the vendor itself sent reasoning in this field. */
  reasoning_content?: string;
}

export type WireMessage =
  | { role: "system"; content: string }
  | { role: "user"; content: string }
  | WireAssistantMessage
  | { role: "tool"; tool_call_id: string; name?: string; content: string };

export interface ToolDefinition {
  type: "function";
  function: { name: string; description: string; parameters: Record<string, unknown> };
}

export interface ChatOptions {
  tools?: ToolDefinition[];
  /** "none" asks for a final answer without further lookups. */
  toolChoice?: "auto" | "none";
  maxTokens: number;
  temperature: number;
  /** External stop (the user pressed Stop). Never retried. */
  signal?: AbortSignal;
  /** Visible reply text as it streams (thinking already split out). */
  onText?: (delta: string) => void;
  /** The model's visible reasoning as it streams. */
  onReasoning?: (delta: string) => void;
  /**
   * A retryable failure happened mid-stream and the call is starting over:
   * whatever `onText`/`onReasoning` delivered for this call is void.
   */
  onRetry?: (attempt: number, error: unknown) => void;
  /** Abort when NO bytes have arrived for this long. */
  idleTimeoutMs?: number;
  /** Whole-call backstop behind the idle timer. */
  timeoutMs?: number;
  /** Attempts, inclusive of the first. */
  maxAttempts?: number;
}

export interface ChatResult {
  /** What the user reads: the reply with any thinking removed. */
  text: string;
  /** The model's visible reasoning, if it showed any. */
  reasoning: string;
  /** The assistant turn to append VERBATIM to continue a tool chain. */
  message: WireAssistantMessage;
  toolCalls: RawToolCall[];
  finishReason: string | null;
  usage: TokenUsage | null;
}

/** Gemini 3 thinks silently before its first token, sometimes for a minute
 *  on a hard question; the idle window has to clear that. */
export const CHAT_IDLE_TIMEOUT_MS = 150_000;
export const CHAT_CALL_TIMEOUT_MS = 600_000;
export const CHAT_MAX_ATTEMPTS = 3;

/** Rough token count of a message list, for the gate's TPM reservation. */
export function estimateMessageTokens(messages: WireMessage[], tools?: ToolDefinition[]): number {
  let chars = 0;
  for (const m of messages) {
    chars += (m.content ?? "").length + 8;
    if (m.role === "assistant" && m.tool_calls) chars += JSON.stringify(m.tool_calls).length;
  }
  if (tools?.length) chars += JSON.stringify(tools).length;
  return Math.ceil(chars / CHARS_PER_TOKEN);
}

function requestBody(spec: ProviderSpec, model: string, messages: WireMessage[], opts: ChatOptions): string {
  return JSON.stringify({
    model,
    messages,
    [spec.outputTokenParam ?? "max_tokens"]: Math.min(opts.maxTokens, spec.maxOutputTokens),
    temperature: opts.temperature,
    stream: true,
    stream_options: { include_usage: true },
    // `tool_choice` is sent only to FORBID calls: with tools present, "auto"
    // is every OpenAI-compatible vendor's default, so leaving it out is the
    // most portable way to ask for it.
    ...(opts.tools?.length ? { tools: opts.tools, ...(opts.toolChoice === "none" ? { tool_choice: "none" } : {}) } : {}),
  });
}

async function httpError(res: Response): Promise<ProviderHttpError> {
  let msg = `HTTP ${res.status}`;
  try {
    const j = (await res.json()) as { error?: { message?: string }; message?: string; base_resp?: { status_msg?: string } };
    msg = j?.error?.message || j?.message || j?.base_resp?.status_msg || msg;
  } catch {
    /* body was not JSON */
  }
  return new ProviderHttpError(msg, res.status, parseRetryAfter(res.headers.get("retry-after")), rateLimitHeadersFrom(res.headers));
}

/** ONE attempt — no retries, no gating; `streamChat` owns both. */
async function attempt(spec: ProviderSpec, model: string, messages: WireMessage[], opts: ChatOptions): Promise<ChatResult> {
  if (opts.signal?.aborted) throw new AiCallAborted(spec.label, opts.signal.reason);

  const controller = new AbortController();
  const timeoutMs = opts.timeoutMs ?? CHAT_CALL_TIMEOUT_MS;
  const idleTimeoutMs = opts.idleTimeoutMs ?? CHAT_IDLE_TIMEOUT_MS;
  const combined = combineAbortSignals([controller.signal, opts.signal]);
  const backstop = setTimeout(() => controller.abort(), timeoutMs);
  let idleTimer: ReturnType<typeof setTimeout> | undefined;
  let idleFired = false;
  const armIdle = () => {
    if (idleTimer !== undefined) clearTimeout(idleTimer);
    idleTimer = setTimeout(() => {
      idleFired = true;
      controller.abort();
    }, idleTimeoutMs);
  };

  const fail = (e: unknown): never => {
    // Precedence: an external Stop is an abort (never retried); a silent
    // stream and the backstop are timeouts (retryable); the rest as thrown.
    if (opts.signal?.aborted) throw new AiCallAborted(spec.label, opts.signal.reason);
    if (idleFired) throw new Error(callTimedOutMessage(spec.label, idleTimeoutMs));
    if (e instanceof Error && e.name === "AbortError") throw new Error(callTimedOutMessage(spec.label, timeoutMs));
    throw e;
  };

  try {
    armIdle();
    let res: Response;
    try {
      res = await fetch(spec.endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${spec.apiKey}` },
        signal: combined.signal,
        body: requestBody(spec, model, messages, opts),
      });
    } catch (e) {
      return fail(e);
    }
    if (!res.ok) throw await httpError(res);

    const splitter = new ThinkSplitter();
    const calls = new ToolCallAccumulator();
    let rawContent = "";
    let fieldReasoning = "";
    let visible = "";
    let inlineReasoning = "";
    let finishReason: string | null = null;
    let usage: TokenUsage | null = null;

    const take = (json: unknown, whole: boolean) => {
      const view = readChunk(json);
      if (view.error) throw new ProviderHttpError(view.error.message, view.error.status, null, null);
      if (view.content) {
        rawContent += view.content;
        const part = splitter.push(view.content);
        if (part.text) {
          visible += part.text;
          opts.onText?.(part.text);
        }
        if (part.reasoning) {
          inlineReasoning += part.reasoning;
          opts.onReasoning?.(part.reasoning);
        }
      }
      if (view.reasoning) {
        fieldReasoning += view.reasoning;
        opts.onReasoning?.(view.reasoning);
      }
      // A whole (non-streamed) message lists its calls as separate, complete
      // objects — index them so two calls without ids can never merge.
      if (view.toolCalls) {
        calls.add(whole ? view.toolCalls.map((c, index) => (c && typeof c === "object" ? { ...c, index } : c)) : view.toolCalls);
      }
      if (view.finishReason) finishReason = view.finishReason;
      if (view.usage) usage = view.usage;
    };

    const contentType = res.headers.get("content-type") ?? "";
    if (!contentType.includes("text/event-stream") && contentType.includes("json")) {
      // A vendor that ignored `stream: true` and answered with one JSON body.
      let json: unknown;
      try {
        json = await res.json();
      } catch (e) {
        return fail(e);
      }
      take(json, true);
    } else {
      if (!res.body) throw new Error(`${spec.label} returned no body for a streaming request.`);
      const reader = res.body.getReader();
      let onAbort: (() => void) | undefined;
      const aborted = new Promise<never>((_, reject) => {
        const fire = () => reject(Object.assign(new Error("stream read aborted"), { name: "AbortError" }));
        if (combined.signal.aborted) return fire();
        onAbort = fire;
        combined.signal.addEventListener("abort", fire, { once: true });
      });
      aborted.catch(() => {});
      const decoder = new TextDecoder();
      const lines = new LineBuffer();
      let done = false;
      try {
        while (!done) {
          const step = await Promise.race([reader.read(), aborted]);
          armIdle();
          if (step.done) break;
          for (const line of lines.push(decoder.decode(step.value, { stream: true }))) {
            const parsed = parseSseLine(line);
            if (parsed === "done") {
              done = true;
              break;
            }
            if (parsed !== null) take(parsed, false);
          }
        }
        if (!done) {
          for (const line of lines.push(decoder.decode())) {
            const parsed = parseSseLine(line);
            if (parsed !== null && parsed !== "done") take(parsed, false);
          }
          for (const line of lines.flush()) {
            const parsed = parseSseLine(line);
            if (parsed !== null && parsed !== "done") take(parsed, false);
          }
        }
      } catch (e) {
        if (e instanceof ProviderHttpError) throw e;
        return fail(e);
      } finally {
        if (onAbort) combined.signal.removeEventListener("abort", onAbort);
        void reader.cancel().catch(() => {});
      }
    }

    const tail = splitter.flush();
    if (tail.text) {
      visible += tail.text;
      opts.onText?.(tail.text);
    }
    if (tail.reasoning) {
      inlineReasoning += tail.reasoning;
      opts.onReasoning?.(tail.reasoning);
    }

    const toolCalls = calls.result();
    const message: WireAssistantMessage = { role: "assistant", content: rawContent.length ? rawContent : null };
    if (toolCalls.length) message.tool_calls = toolCalls;
    if (fieldReasoning) message.reasoning_content = fieldReasoning;

    return {
      text: visible.trimEnd(),
      reasoning: (inlineReasoning + fieldReasoning).trim(),
      message,
      toolCalls,
      finishReason,
      usage,
    };
  } finally {
    clearTimeout(backstop);
    if (idleTimer !== undefined) clearTimeout(idleTimer);
    combined.cleanup();
  }
}

/**
 * One assistant model round, with the provider gate and retries.
 *
 * A retryable failure (429, 5xx, timeout, dropped connection) is retried with
 * the shared backoff — EVEN mid-stream, because a long reply dying at minute
 * two is exactly what retrying is for. `onRetry` tells the caller to discard
 * the partial output first. A terminal failure (bad key, bad request, no
 * balance) and a user Stop are thrown at once.
 */
export async function streamChat(
  spec: ProviderSpec,
  model: string,
  messages: WireMessage[],
  opts: ChatOptions,
): Promise<ChatResult> {
  const attempts = Math.max(1, opts.maxAttempts ?? CHAT_MAX_ATTEMPTS);
  const gate = getGate(spec.providerKey ?? new URL(spec.endpoint).host, spec.rateBudget);
  const inputTokens = estimateMessageTokens(messages, opts.tools);
  const maxTokens = Math.min(opts.maxTokens, spec.maxOutputTokens);
  let lastError: unknown;
  let throttleCounted = false;

  for (let n = 1; n <= attempts; n++) {
    // Same load-bearing adjacency as callWithProvider: nothing between the
    // acquire and the try, settleError first in the catch — a leaked slot
    // permanently lowers this provider's concurrency.
    const slot = await gate.acquire({ inputTokens, model, maxTokens }, opts.signal, GATE_MAX_WAIT_MS);
    let emitted = false;
    try {
      const out = await attempt(spec, model, messages, {
        ...opts,
        onText: opts.onText
          ? (d) => {
              emitted = true;
              opts.onText!(d);
            }
          : undefined,
        onReasoning: opts.onReasoning
          ? (d) => {
              emitted = true;
              opts.onReasoning!(d);
            }
          : undefined,
      });
      slot.settle(out.usage);
      return out;
    } catch (e) {
      const throttled = isRateLimitError(e);
      slot.settleError(e, { sameCongestionEvent: throttled && throttleCounted });
      if (throttled) throttleCounted = true;
      lastError = e;
      if (isAbortedError(e)) throw e;
      if (!isRetryableError(e) || n === attempts) throw e;
      if (emitted) opts.onRetry?.(n, e);
      await sleep(backoffDelayMs(n, e), opts.signal);
    }
  }
  throw lastError;
}
