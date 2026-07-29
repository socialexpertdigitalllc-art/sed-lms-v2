import { createAdminClient } from "@/lib/supabase/admin";
import { TOOLS, isToolId, type ToolId } from "./config";
import { countImages, countWords, parseFiles, type GeneratedFile } from "./parse";
import { getWgeConfig } from "./wge";
import { mapLeadToInput } from "./leadPrefill";
import { buildPrompt, EMPTY_INPUT, type GenInput } from "./prompt";
import { AiCallAborted, combineAbortSignals, isAbortedError } from "./abort";
import {
  callTimedOutMessage,
  isRateLimitError,
  isRetryableError,
  parseRetryAfter,
  ProviderHttpError,
  rateLimitHeadersFrom,
} from "./providers/errors";
import type { RateBudget } from "./providers/limits";
import { estimateInputTokens, getGate, sleep, type TokenUsage } from "./providers/gate";

const BUCKET = "ai-generations";

export interface PersistInput {
  tool: ToolId;
  agentId: string | null;
  leadId?: string | null;
  businessName?: string | null;
  model: string;
  files: GeneratedFile[];
  tokensUsed?: number | null;
  totalTimeMs?: number | null;
  inputTimeMs?: number | null;
  aiTimeMs?: number | null;
  pageTypes?: string[];
  numPages?: number | null;
  status?: "success" | "failed";
  errors?: string | null;
}

// Insert the ai_generations row, upload each file to private Storage, finalise.
export async function persistGeneration(input: PersistInput): Promise<{ id: string; uploaded: string[] }> {
  const cfg = TOOLS[input.tool];
  const admin = createAdminClient();

  const tokens = input.tokensUsed ?? 0;
  const numPages = input.numPages ?? input.files.length;
  const wordCount = countWords(input.files);
  const imageCount = countImages(input.files);
  const cost = Number(((tokens / 1000) * cfg.costPer1kUsd).toFixed(6));
  const complexity = Number((numPages * 10 + imageCount * 2 + tokens / 100).toFixed(2));

  const { data: row, error: insErr } = await admin
    .from("ai_generations")
    .insert({
      tool: input.tool,
      agent_id: input.agentId,
      lead_id: input.leadId ?? null,
      business_name: input.businessName ?? null,
      model: input.model,
      total_time_ms: input.totalTimeMs ?? null,
      input_time_ms: input.inputTimeMs ?? null,
      ai_time_ms: input.aiTimeMs ?? null,
      num_pages: numPages,
      num_files: input.files.length,
      page_types: input.pageTypes ?? input.files.map((f) => f.name),
      tokens_used: tokens,
      cost_usd: cost,
      status: input.status ?? "success",
      word_count: wordCount,
      image_count: imageCount,
      complexity_score: complexity,
      errors: input.errors ?? null,
    })
    .select("id")
    .single();
  if (insErr || !row) throw new Error(insErr?.message ?? "Save failed");

  const uploaded: string[] = [];
  for (const f of input.files) {
    const { error: upErr } = await admin.storage
      .from(BUCKET)
      .upload(`${row.id}/${f.name}`, new Blob([f.code], { type: "text/html" }), {
        contentType: "text/html; charset=utf-8",
        upsert: true,
      });
    if (!upErr) uploaded.push(f.name);
  }

  await admin.from("ai_generations").update({ file_path: `${row.id}/` }).eq("id", row.id);
  return { id: row.id, uploaded };
}

// Non-streamed OpenAI-compatible chat completion. Returns { text, tokens }.
// `opts.images`, when present and non-empty, sends the user turn as a
// multimodal content array (one text part + one image_url part per url) —
// verified against Gemini's OpenAI-compat endpoint for vision ranking
// (lib/template-engine/vision.ts). Every existing caller omits `images`, so
// `userContent` stays the same plain string as before — this is additive only.
// Hard ceiling on any single provider call. A hung/stalled connection (Gemini
// commonly stalls when its vision endpoint is rate-limited) must ABORT, not
// hang forever — a hang can't be retried because it never throws, and it was
// what wedged the image step for 30-40 minutes. Callers may pass a tighter
// `timeoutMs` (vision does); big whole-file regens keep the generous default.
const DEFAULT_CALL_TIMEOUT_MS = 300000; // 5 min

/**
 * Everything a single completion needs beyond the prompts.
 *
 * `signal` is the EXTERNAL cancellation channel (the runner's per-generation
 * stop controller). It is combined with this call's own timeout controller and
 * whichever fires first wins, so a Stop rejects the in-flight fetch within
 * milliseconds instead of waiting out a 5-minute ceiling. An abort that came
 * from `signal` throws `AiCallAborted`, never the "timed out" error, so the
 * caller's retry loop can tell a stop apart from a blip.
 */
export interface ProviderCallOptions {
  maxTokens: number;
  temperature: number;
  images?: string[];
  timeoutMs?: number;
  signal?: AbortSignal;
  /**
   * Attempts, inclusive of the first. Defaults to MAX_ATTEMPTS. Tests pin it
   * to 1 to assert single-shot behaviour without waiting out backoff.
   */
  maxAttempts?: number;
}

export async function callProvider(
  tool: ToolId,
  model: string,
  systemPrompt: string,
  userPrompt: string,
  opts: ProviderCallOptions
): Promise<{ text: string; tokens: number }> {
  const cfg = TOOLS[tool];
  const apiKey = process.env[cfg.envKey];
  if (!apiKey) throw new Error(`${cfg.label} is not configured (missing ${cfg.envKey}).`);
  return callWithProvider(
    {
      label: cfg.label,
      endpoint: cfg.endpoint,
      apiKey,
      maxOutputTokens: cfg.maxOutputTokens,
      // MUST be the same string the routed path uses (the registry descriptor
      // key), or one vendor quota is split across two gates and the vendor sees
      // up to double the intended rate. Every `ToolId` — webcraft, deepseek,
      // gemini — is byte-identical to a registry key and to a
      // DEFAULT_RATE_BUDGETS key, so this is a total mapping, not a coincidence
      // that happens to hold today.
      //
      // NO `rateBudget`, deliberately: this path is DB-free (keys from env), so
      // it knows the provider but not the operator's stored override. It JOINS
      // the bucket without describing it — see `getGate`, which leaves an
      // existing gate's budget alone when a caller supplies none. Stating the
      // shipped default here instead would differ from the routed path's
      // default-plus-override on any tuned provider and reset the learned
      // adaptive state on every alternation.
      providerKey: tool,
    },
    model,
    systemPrompt,
    userPrompt,
    opts
  );
}

/**
 * The provider spec `callWithProvider` needs: everything about WHERE to send a
 * completion and WITH WHAT, resolved by the caller. Env-configured tools get
 * one built from TOOLS above; per-task routing (lib/ai-tools/providers) builds
 * one from the registry descriptor plus the operator's stored credentials.
 *
 * `apiKey` is a live secret — never log this object.
 */
export interface ProviderSpec {
  label: string;
  endpoint: string;
  apiKey: string;
  /** Hard ceiling for this model; the request sends min(maxTokens, this). */
  maxOutputTokens: number;
  /**
   * Wire field for the output budget. Defaults to `max_tokens`, which every
   * OpenAI-compatible provider understands; a provider that has deprecated it
   * (MiniMax → `max_completion_tokens`) sets this from its registry
   * descriptor. See `AiProviderDescriptor.outputTokenParam`.
   */
  outputTokenParam?: "max_tokens" | "max_completion_tokens";
  /**
   * Which rate-budget bucket this call draws from. Every provider pools its
   * quota across models and modalities, so this is the provider, never the
   * model. Absent falls back to the endpoint host, which is the same thing by
   * another name and keeps legacy env-configured tools working.
   */
  providerKey?: string;
  /**
   * The budget in force for that bucket, resolved by the caller. OMIT IT to
   * join the bucket without describing it: a caller that does not know the
   * operator's stored override must not overwrite it with a guess. See
   * `getGate`.
   */
  rateBudget?: RateBudget;
}

/** Attempts per call, inclusive of the first. Four means three retries, which
 *  clears a typical per-minute window without letting one wedged call hold a
 *  gate slot for minutes. */
export const MAX_ATTEMPTS = 4;
/** Ceiling on a vendor-supplied Retry-After. A vendor that asks for ten
 *  minutes must not be able to wedge a generation. */
export const RETRY_AFTER_CAP_MS = 60_000;
const BACKOFF_BASE_MS = 1000;
const BACKOFF_CAP_MS = 30_000;

/**
 * How long to wait before the next attempt.
 *
 * The vendor's own `Retry-After` wins whenever it sends one — it knows when the
 * window resets and we are guessing. Otherwise: exponential from 1s with FULL
 * jitter, which matters more than it looks. Every page of a site is retrying at
 * once; a fixed schedule would have them all wake together and re-throttle each
 * other indefinitely.
 *
 * `random` is injectable purely so the schedule is testable.
 */
export function backoffDelayMs(attempt: number, error: unknown, random: () => number = Math.random): number {
  if (error instanceof ProviderHttpError && error.retryAfterMs !== null) {
    return Math.min(error.retryAfterMs, RETRY_AFTER_CAP_MS);
  }
  const ceiling = Math.min(BACKOFF_BASE_MS * 2 ** (attempt - 1), BACKOFF_CAP_MS);
  return Math.round(ceiling * random());
}

/**
 * ONE attempt at the OpenAI-compatible call — no retries, no gating; those are
 * `callWithProvider`'s job. Identical wire format for every provider we support
 * (Gemini's compat surface, DeepSeek, Moonshot, MiniMax), which is why adding a
 * provider is a descriptor and nothing else.
 */
async function attemptCall(
  cfg: ProviderSpec,
  model: string,
  systemPrompt: string,
  userPrompt: string,
  opts: ProviderCallOptions
): Promise<{ text: string; tokens: number; usage: TokenUsage | null }> {
  // Already stopped before we even dialled — do not spend the call.
  if (opts.signal?.aborted) throw new AiCallAborted(cfg.label, opts.signal.reason);

  const userContent =
    opts.images && opts.images.length > 0
      ? [{ type: "text", text: userPrompt }, ...opts.images.map((url) => ({ type: "image_url", image_url: { url } }))]
      : userPrompt;

  const controller = new AbortController();
  const timeoutMs = opts.timeoutMs ?? DEFAULT_CALL_TIMEOUT_MS;
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  // Timeout OR external stop, whichever comes first.
  const combined = combineAbortSignals([controller.signal, opts.signal]);
  let res: Response;
  try {
    res = await fetch(cfg.endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${cfg.apiKey}` },
      signal: combined.signal,
      body: JSON.stringify({
        model,
        [cfg.outputTokenParam ?? "max_tokens"]: Math.min(opts.maxTokens, cfg.maxOutputTokens),
        temperature: opts.temperature,
        stream: false,
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: userContent },
        ],
      }),
    });
  } catch (e) {
    // Order matters: an external stop is checked FIRST, so a Stop that lands
    // inside the timeout window is reported as an abort (never retried) rather
    // than as a timeout (which callers do retry).
    if (opts.signal?.aborted) throw new AiCallAborted(cfg.label, opts.signal.reason);
    if (e instanceof Error && e.name === "AbortError") {
      throw new Error(callTimedOutMessage(cfg.label, timeoutMs));
    }
    throw e;
  } finally {
    clearTimeout(timer);
    combined.cleanup();
  }
  if (!res.ok) {
    let msg = `HTTP ${res.status}`;
    try {
      const j = await res.json();
      msg = j?.error?.message || j?.message || msg;
    } catch {
      /* ignore */
    }
    // The status is the whole point: a 429 is "wait, then this call would have
    // worked", a 400 is "this call can never work". Flattening both into
    // Error(msg) is what made rate limiting look like permanent failure.
    // The human-readable message is preserved verbatim so no existing error
    // surface regresses.
    throw new ProviderHttpError(
      msg,
      res.status,
      parseRetryAfter(res.headers.get("retry-after")),
      rateLimitHeadersFrom(res.headers),
    );
  }
  const j = await res.json();
  const text: string = j?.choices?.[0]?.message?.content ?? "";
  // The raw usage block, not just the total: the gate's TPM accounting learns
  // an output-to-input ratio from prompt/completion, which the total alone
  // cannot supply.
  const usage = (j?.usage ?? null) as TokenUsage | null;
  const tokens: number = usage?.total_tokens ?? Math.ceil(text.length / 4);
  return { text, tokens, usage };
}

/**
 * Which rate bucket a spec draws from. The endpoint HOST is the fallback and
 * is not a compromise: two specs pointing at the same host really do share one
 * vendor quota, so bucketing by host is correct for every legacy caller that
 * predates `providerKey`.
 */
function gateKeyFor(cfg: ProviderSpec): string {
  if (cfg.providerKey) return cfg.providerKey;
  try {
    return new URL(cfg.endpoint).host;
  } catch {
    return cfg.endpoint;
  }
}

/**
 * The actual OpenAI-compatible call, with retries.
 *
 * A retryable failure (429, transient 5xx, timeout, network fault) is retried
 * with backoff; a terminal one (bad request, bad key) is thrown immediately
 * because retrying it cannot succeed and spends quota a concurrent run needs.
 * An operator abort is never retried.
 */
export async function callWithProvider(
  cfg: ProviderSpec,
  model: string,
  systemPrompt: string,
  userPrompt: string,
  opts: ProviderCallOptions,
): Promise<{ text: string; tokens: number }> {
  const attempts = Math.max(1, opts.maxAttempts ?? MAX_ATTEMPTS);
  // `cfg.rateBudget` is passed THROUGH, not defaulted: an absent budget must
  // stay absent so `getGate` can tell "I do not know this provider's budget"
  // (the legacy env-keyed path) from "this provider has no declared limits".
  // Coercing it to `{}` here would clobber the routed path's budget — see the
  // `getGate` docblock. The routed path (lib/ai-tools/providers/config.ts)
  // always supplies one.
  const gate = getGate(gateKeyFor(cfg), cfg.rateBudget);
  const inputTokens = estimateInputTokens(systemPrompt, userPrompt, opts.images?.length ?? 0);
  const maxTokens = Math.min(opts.maxTokens, cfg.maxOutputTokens);
  let lastError: unknown;
  /** Has a 429 from THIS call already been counted against the budget? Only
   *  then is a later 429 a repeat of a wall the gate has already seen. */
  let throttleCounted = false;

  for (let attempt = 1; attempt <= attempts; attempt++) {
    // Acquired per ATTEMPT, not per call: a retry is a fresh request against
    // the vendor's budget and must queue behind everything else rather than
    // riding in on a slot it reserved a minute ago.
    //
    // No `maxWaitMs`, DELIBERATELY. Time parked here is not covered by this
    // call's timeout, which only starts once the request is on the wire, so an
    // unbounded wait is breakable only by `opts.signal`. That is accepted for
    // now: `tpd` is the sole dimension that can compute a multi-hour wait and
    // no shipped budget declares one, leaving a worst case of about a minute.
    // A deadline should be set once a real paced run shows what it costs.
    //
    // LOAD-BEARING ADJACENCY: the slot is released only by `settle`/
    // `settleError`; no statement may go between this line and the `try`, and
    // `settleError` must stay first in the catch (only the non-throwing
    // computation of its own arguments may precede it). Either edit would leak
    // a slot on the path it interrupts, and a leaked slot permanently lowers
    // this provider's concurrency with nothing to log it.
    const slot = await gate.acquire({ inputTokens, model, maxTokens }, opts.signal);
    try {
      const out = await attemptCall(cfg, model, systemPrompt, userPrompt, opts);
      slot.settle(out.usage);
      return { text: out.text, tokens: out.tokens };
    } catch (e) {
      // A 429 is a repeat only once THIS call has already had one COUNTED —
      // not merely because an earlier attempt failed. "Attempt 2 or later" is
      // the weaker claim and it silently disables backoff: a 503 on attempt 1
      // counts nothing, so flagging the genuine 429 on attempt 2 as a repeat
      // skips the halving entirely, and it still stamps `lastThrottleAt`,
      // suppressing backoff for every concurrent call for a cooldown window.
      // A 5xx-then-429 interleaving is exactly what a provider under load
      // produces, which is the case this exists for.
      //
      // The gate cannot infer this itself: its wall-clock cooldown reads
      // "same event" from proximity, and a vendor `Retry-After` can space
      // these attempts far wider than that (see recordThrottle).
      const throttled = isRateLimitError(e);
      slot.settleError(e, { sameCongestionEvent: throttled && throttleCounted });
      if (throttled) throttleCounted = true;
      lastError = e;
      if (isAbortedError(e)) throw e;
      if (!isRetryableError(e) || attempt === attempts) throw e;
      await sleep(backoffDelayMs(attempt, e), opts.signal);
    }
  }
  throw lastError;
}

// Headlessly generate a lead's website end-to-end. Throws on failure.
export async function runGenerationForLead(
  leadId: string,
  engine: { tool: ToolId; model: string },
  enqueuedBy: string | null
): Promise<{ generationId: string }> {
  if (!isToolId(engine.tool)) throw new Error(`Unknown engine tool: ${engine.tool}`);
  // Service role: this runs headlessly (processor has no user session), so
  // load the lead bypassing RLS.
  const admin = createAdminClient();
  const { data: lead } = await admin.from("leads").select("*").eq("id", leadId).is("deleted_at", null).single();
  if (!lead) throw new Error("Lead not found");

  const config = await getWgeConfig();
  const values: GenInput = { ...EMPTY_INPUT, ...mapLeadToInput(lead, config.variables) };
  const userPrompt = buildPrompt(values, config.prompt_template);

  const start = Date.now();
  const { text, tokens } = await callProvider(engine.tool, engine.model, config.system_prompt, userPrompt, {
    maxTokens: config.settings.max_tokens,
    temperature: config.settings.temperature,
  });
  const aiMs = Date.now() - start;

  const files = parseFiles(text);
  if (!files.length) throw new Error("The model returned no usable HTML.");

  const { id } = await persistGeneration({
    tool: engine.tool,
    agentId: (lead.agent_id as string | null) ?? enqueuedBy,
    leadId,
    businessName: lead.business_name as string,
    model: engine.model,
    files,
    tokensUsed: tokens,
    totalTimeMs: aiMs,
    aiTimeMs: aiMs,
    status: "success",
  });
  return { generationId: id };
}
