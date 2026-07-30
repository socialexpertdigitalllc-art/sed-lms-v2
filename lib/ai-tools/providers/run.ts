import { callWithProvider, type ProviderCallOptions } from "@/lib/ai-tools/run";
import { isAbortedError } from "@/lib/ai-tools/abort";
import { isRetryableError } from "./errors";
import { defaultSpecForTask, resolveTaskModel, type ResolvedTaskModel } from "./config";
import type { AiTaskKey } from "./registry";

/**
 * The one entry point the template engine uses to talk to a model.
 *
 * It resolves the task's assigned provider/model (falling back to the registry
 * default when the assignment is unusable — see resolveTaskModel), makes the
 * call, and if the ASSIGNED provider fails TERMINALLY, retries once on the
 * default before giving up. Together those two levels mean a bad routing choice
 * degrades to today's Gemini behaviour instead of failing a generation.
 *
 * The caller's own retry loop (regenerate's 3 attempts, vision's 2) sits ABOVE
 * this and is unchanged. BELOW it, `callWithProvider` now retries a retryable
 * failure itself with backoff, up to MAX_ATTEMPTS (4) requests. So the fallback
 * no longer costs "one extra call": a failure that reaches the catch below is
 * terminal and cost exactly one request, but the fallback call it triggers can
 * spend a full retry budget of its own — at most 1 + MAX_ATTEMPTS requests per
 * callForTask.
 */

// Resolution hits the DB. A single generation regenerates N files and vets many
// image batches, and the routing table changes about once a month, so a short
// memo keeps a run from issuing dozens of identical config reads. Short enough
// that an operator's change takes effect while they are still on the page.
const RESOLVE_TTL_MS = 30000;

const cache = new Map<string, { at: number; value: ResolvedTaskModel }>();

/** Drop the memo — used by tests and by the settings API after a write. */
export function clearTaskModelCache(): void {
  cache.clear();
}

export async function resolveTaskModelCached(task: AiTaskKey): Promise<ResolvedTaskModel> {
  const hit = cache.get(task);
  if (hit && Date.now() - hit.at < RESOLVE_TTL_MS) return hit.value;
  const value = await resolveTaskModel(task);
  cache.set(task, { at: Date.now(), value });
  return value;
}

export interface TaskCallOptions {
  /**
   * A token budget, or `"model-max"` to ask the resolved model for everything
   * it can emit. The whole-file rewrite uses the latter: its ceiling is a
   * property of the model, not a constant, and a page must come back WHOLE.
   */
  maxTokens: number | "model-max";
  temperature: number;
  images?: string[];
  timeoutMs?: number;
  /**
   * Per-generation stop signal. Passed straight through to the provider call,
   * which combines it with its own timeout; an abort surfaces as
   * `AiCallAborted` and is never retried here or by the caller's own loop.
   */
  signal?: AbortSignal;
  /**
   * Attempts, inclusive of the first (default MAX_ATTEMPTS). Pass 1 when the
   * caller's LATENCY budget, not its success rate, is the binding constraint —
   * an interactive check or a best-effort pass whose answer is worthless late.
   * Passed straight through to `callWithProvider`.
   */
  maxAttempts?: number;
  /** When present, the call streams: each content delta is emitted here as it
   *  arrives, and the reply is accumulated from the stream. Absent → the
   *  request is the exact non-streaming call it always was. Passed straight
   *  through to `callWithProvider` (see ProviderCallOptions.onChunk). */
  onChunk?: (delta: string) => void;
  /** Streaming only: abort when NO data has arrived for this long (the
   *  provider layer defaults it to 90s). Passed straight through. */
  idleTimeoutMs?: number;
}

function budget(opts: TaskCallOptions, resolved: ResolvedTaskModel): ProviderCallOptions {
  // `resolved.outputTokens`, NOT `spec.maxOutputTokens`: the former is the
  // operator's per-task budget (or the vendor's recommended figure), already
  // clamped; the latter is the hard ceiling, which on providers that bill
  // input+output against one budget cannot be satisfied alongside a real
  // prompt. `callWithProvider` still min()s against the ceiling regardless.
  return { ...opts, maxTokens: opts.maxTokens === "model-max" ? resolved.outputTokens : opts.maxTokens };
}

export interface TaskCallResult {
  text: string;
  tokens: number;
  /** What actually answered, for logs and progress detail. Never a credential. */
  providerKey: string;
  model: string;
}

export async function callForTask(
  task: AiTaskKey,
  systemPrompt: string,
  userPrompt: string,
  opts: TaskCallOptions,
): Promise<TaskCallResult> {
  const resolved = await resolveTaskModelCached(task);
  try {
    const out = await callWithProvider(resolved.spec, resolved.model, systemPrompt, userPrompt, budget(opts, resolved));
    return { ...out, providerKey: resolved.providerKey, model: resolved.model };
  } catch (e) {
    // The operator pressed Stop. There is no "safer provider" for that — a
    // fallback call here would be a second paid request against a run that is
    // already over. Rethrow before any retry reasoning runs.
    if (isAbortedError(e)) throw e;
    // A RETRYABLE failure has already had its full retry budget inside
    // callWithProvider. Falling back now would move the operator's chosen model
    // onto a different one because the first was momentarily busy — silently
    // changing which model wrote a customer's site, with nothing in the run to
    // say it happened. Fallback exists for CONFIGURATION failures (bad key,
    // disabled provider, retired model), which are terminal, and those still
    // fall through to the block below.
    if (isRetryableError(e)) throw e;
    // Already on the default? Nothing safer to try — let the caller's retry
    // loop and error handling do their job exactly as before.
    if (!resolved.usedFallback) {
      const fallback = await defaultSpecForTask(task).catch(() => null);
      if (fallback && fallback.providerKey === resolved.providerKey && fallback.model === resolved.model) throw e;
      if (fallback) {
        console.warn(
          `[ai-routing] ${task}: ${resolved.providerKey} ${resolved.model} failed (${e instanceof Error ? e.message : String(e)})` +
            ` — retrying once on ${fallback.providerKey} ${fallback.model}`,
        );
        // Poison the memo so the rest of this run does not keep hitting the
        // broken provider first.
        cache.set(task, { at: Date.now(), value: { ...fallback, usedFallback: true, fallbackReason: "the assigned provider failed" } });
        const out = await callWithProvider(fallback.spec, fallback.model, systemPrompt, userPrompt, budget(opts, fallback));
        return { ...out, providerKey: fallback.providerKey, model: fallback.model };
      }
    }
    throw e;
  }
}
