/**
 * AI provider + task registry — the single description of every model we can
 * route an AI task to, and of every task that can be routed.
 *
 * It drives BOTH the runtime router (endpoint, credentials, output ceiling) and
 * the admin UI (which credential fields to render, which models a given task is
 * even *allowed* to be pointed at).
 *
 * PURE: no I/O, no environment access, no secrets. Adding a provider here is a
 * one-descriptor job — every provider we support is an OpenAI-compatible
 * `chat/completions` endpoint with a Bearer key, so `callWithProvider()` in
 * lib/ai-tools/run.ts already speaks to all of them.
 *
 * CAPABILITIES ARE PER MODEL, NOT PER PROVIDER. A provider almost never has a
 * uniform capability set (MiniMax ships one vision model and several text-only
 * ones; Moonshot the same), and a text-only model pointed at the image task
 * fails *silently* — it answers, it just answers about nothing. The provider
 * `capabilities` rollup below is the best any of its models can do, and exists
 * only so the UI can grey out a whole provider at a glance; every real decision
 * goes through `isValidAssignment()`, which reads the MODEL.
 */

export interface AiCredentialField {
  key: string;
  label: string;
  type: "text" | "password";
  placeholder?: string;
}

export interface AiModelDescriptor {
  id: string;
  /** Accepts `image_url` content parts on the chat/completions endpoint. */
  vision: boolean;
  /**
   * Accepts `tools` and answers with `tool_calls` on the chat/completions
   * endpoint (OpenAI-style function calling). Opt-in: absent means "not
   * verified", and a task that needs it refuses the model — a model that
   * cannot call tools does not fail, it just makes the numbers up.
   */
  toolCalling?: boolean;
  /**
   * Provider-documented HARD ceiling on output tokens for THIS model — the
   * largest value the vendor will accept, not a house preference. An operator
   * may dial a task DOWN from here (see `ai_task_assignments.max_output_tokens`
   * and `clampOutputTokens`), never up: above it the vendor rejects the call.
   */
  maxOutputTokens: number;
  /**
   * What the vendor recommends for normal use, when they publish a figure
   * distinct from the hard ceiling. This is what `"model-max"` actually asks
   * for — see `defaultOutputTokens`. Absent means "the ceiling is the
   * recommendation".
   */
  recommendedOutputTokens?: number;
  /** Total input+output budget, where the vendor publishes one. Display only. */
  contextWindow?: number;
  /** One short factual line for the picker. No marketing copy. */
  note?: string;
}

export interface AiProviderDescriptor {
  key: string;
  label: string;
  /** OpenAI-compatible chat/completions URL. */
  endpoint: string;
  /**
   * Which field carries the output budget on the wire. `max_tokens` is the
   * universally-understood default; a provider that has deprecated it in
   * favour of OpenAI's newer `max_completion_tokens` (MiniMax) says so here.
   * Per-provider ON PURPOSE — sending the newer field to a provider that only
   * knows the older one silently loses the budget (or 400s), which is exactly
   * the class of bug this whole file exists to prevent.
   */
  outputTokenParam?: "max_tokens" | "max_completion_tokens";
  models: AiModelDescriptor[];
  credentialFields: AiCredentialField[];
  /** Best-case rollup across `models` — for display only. See file header. */
  capabilities: { vision: boolean; longOutput: boolean; maxOutputTokens: number };
  docsUrl: string;
  /** Env var we accept as a ONE-TIME SEED for the DB row (never a fallback). */
  envKey: string;
}

/**
 * A model counts as "long output" at or above this ceiling. Chosen from the
 * real workload: a large template page (index.html ~78KB) has to come back
 * WHOLE, and a model that physically cannot emit it will truncate — which in v1
 * read as a successful no-op edit.
 */
export const LONG_OUTPUT_TOKENS = 32000;

/**
 * What the DEFAULT (text-batch) personalisation path actually needs per call.
 * It sends only the translatable strings of a page — never the markup — in
 * batches capped at ~60 items / ~4000 chars, so a single response is ~2k
 * tokens. The old whole-file path needed LONG_OUTPUT_TOKENS; requiring that
 * here now only excludes small models that do the job perfectly well.
 */
export const TEXT_BATCH_TOKENS = 8000;

/* ------------------------------------------------------------- providers */

const gemini: AiProviderDescriptor = {
  key: "gemini",
  label: "Google Gemini",
  // OpenAI-compatible surface, so one call path serves every provider here.
  endpoint: "https://generativelanguage.googleapis.com/v1beta/openai/chat/completions",
  models: [
    { id: "gemini-3.1-pro-preview", vision: true, toolCalling: true, maxOutputTokens: 64000, note: "Verified default for planning and whole-file rewrites." },
    { id: "gemini-3.5-flash", vision: true, toolCalling: true, maxOutputTokens: 64000, note: "Cheap and fast; the verified default for image vetting." },
    { id: "gemini-2.5-pro", vision: true, toolCalling: true, maxOutputTokens: 64000 },
    { id: "gemini-2.5-flash", vision: true, toolCalling: true, maxOutputTokens: 64000 },
  ],
  credentialFields: [{ key: "api_key", label: "API key", type: "password" }],
  capabilities: { vision: true, longOutput: true, maxOutputTokens: 64000 },
  docsUrl: "https://ai.google.dev/gemini-api/docs/openai",
  envKey: "GEMINI_API_KEY",
};

const deepseek: AiProviderDescriptor = {
  key: "deepseek",
  label: "DeepSeek",
  endpoint: "https://api.deepseek.com/chat/completions",
  models: [
    { id: "deepseek-chat", vision: false, toolCalling: true, maxOutputTokens: 8192, note: "Text only. Good at strict JSON; too small to rewrite a whole page." },
    { id: "deepseek-reasoner", vision: false, maxOutputTokens: 8192, note: "Text only. Slower, stronger reasoning." },
  ],
  credentialFields: [{ key: "api_key", label: "API key", type: "password" }],
  capabilities: { vision: false, longOutput: false, maxOutputTokens: 8192 },
  docsUrl: "https://api-docs.deepseek.com/",
  envKey: "DEEPSEEK_API_KEY",
};

const webcraft: AiProviderDescriptor = {
  key: "webcraft",
  label: "Kimi (Moonshot)",
  endpoint: "https://api.moonshot.ai/v1/chat/completions",
  models: [
    { id: "moonshot-v1-128k", vision: false, toolCalling: true, maxOutputTokens: 32000, note: "Text only. Large enough to return a whole page." },
    { id: "kimi-k2-0711-preview", vision: false, toolCalling: true, maxOutputTokens: 32000, note: "Text only." },
    { id: "moonshot-v1-32k", vision: false, toolCalling: true, maxOutputTokens: 32000, note: "Text only." },
    { id: "moonshot-v1-auto", vision: false, toolCalling: true, maxOutputTokens: 32000, note: "Text only. Moonshot picks the context size." },
  ],
  credentialFields: [{ key: "api_key", label: "API key", type: "password" }],
  capabilities: { vision: false, longOutput: true, maxOutputTokens: 32000 },
  docsUrl: "https://platform.moonshot.ai/docs/api/chat",
  envKey: "KIMI_API_KEY",
};

/**
 * MiniMax. Grounded in the vendor's own docs, re-read 2026-07-28:
 *  - base_url + model ids: platform.minimax.io/docs/api-reference/text-openai-api
 *  - output ceilings: platform.minimax.io/docs/api-reference/text-chat-openai,
 *    which documents `max_completion_tokens` (and deprecates `max_tokens`) as
 *    max 524288 / recommended 131072 for MiniMax-M3, and max 204800 /
 *    recommended 65536 for the M2.x models.
 *  - context windows: 1,000,000 for M3, 204,800 for M2.x.
 * Image (and video) input on chat/completions is documented for `MiniMax-M3`
 * only, so M3 is the ONLY model here flagged vision, and pointing the image
 * task at any other MiniMax model is refused rather than silently mis-run.
 *
 * WHY RECOMMENDED ≠ CEILING HERE. The ceiling is what the vendor will ACCEPT;
 * it is not free to ask for. MiniMax counts input and output against ONE
 * budget, so on an M2.x model (204,800 context AND 204,800 max output) asking
 * for the full ceiling alongside any prompt at all cannot be satisfied. The
 * recommended figure is therefore what `"model-max"` requests by default, and
 * the ceiling is the top of the range an operator may dial a task up to.
 *
 * These numbers replace a placeholder 32000 that predated the vendor
 * publishing any figure. That placeholder was silently truncating whole-page
 * rewrites on M3 — the page came back cut off mid-file.
 */
const minimax: AiProviderDescriptor = {
  key: "minimax",
  label: "MiniMax",
  endpoint: "https://api.minimax.io/v1/chat/completions",
  // The vendor's chat-completions page marks `max_tokens` deprecated and
  // documents its published ceilings against `max_completion_tokens`.
  outputTokenParam: "max_completion_tokens",
  models: [
    {
      id: "MiniMax-M3",
      vision: true,
      toolCalling: true,
      maxOutputTokens: 524288,
      recommendedOutputTokens: 131072,
      contextWindow: 1000000,
      note: "1M context, up to 512K output. The only MiniMax model documented to accept image input.",
    },
    { id: "MiniMax-M2.7", vision: false, toolCalling: true, maxOutputTokens: 204800, recommendedOutputTokens: 65536, contextWindow: 204800, note: "Text only. 200K context." },
    { id: "MiniMax-M2.5", vision: false, toolCalling: true, maxOutputTokens: 204800, recommendedOutputTokens: 65536, contextWindow: 204800, note: "Text only. 200K context." },
    { id: "MiniMax-M2.1", vision: false, toolCalling: true, maxOutputTokens: 204800, recommendedOutputTokens: 65536, contextWindow: 204800, note: "Text only. 200K context." },
    { id: "MiniMax-M2", vision: false, toolCalling: true, maxOutputTokens: 204800, recommendedOutputTokens: 65536, contextWindow: 204800, note: "Text only. 200K context." },
  ],
  credentialFields: [{ key: "api_key", label: "API key", type: "password" }],
  capabilities: { vision: true, longOutput: true, maxOutputTokens: 524288 },
  docsUrl: "https://platform.minimax.io/docs/api-reference/text-chat-openai",
  envKey: "MINIMAX_API_KEY",
};

export const AI_PROVIDER_REGISTRY: AiProviderDescriptor[] = [gemini, deepseek, webcraft, minimax];

export function getProvider(key: string): AiProviderDescriptor | undefined {
  return AI_PROVIDER_REGISTRY.find((p) => p.key === key);
}

export function getModel(providerKey: string, modelId: string): AiModelDescriptor | undefined {
  return getProvider(providerKey)?.models.find((m) => m.id === modelId);
}

/* ------------------------------------------------------- output budgeting */

/**
 * The smallest output budget worth offering. Below this nothing this app asks
 * for — not a page, not a JSON plan — can come back whole, so an operator
 * typing a smaller number is asking for guaranteed truncation.
 */
export const MIN_OUTPUT_TOKENS = 1000;

/**
 * What to request when a caller says `"model-max"`: the vendor's RECOMMENDED
 * figure where they publish one distinct from the ceiling, else the ceiling.
 *
 * Not the ceiling by default, because on providers that bill one budget for
 * input+output (MiniMax) the ceiling cannot be satisfied alongside a real
 * prompt — see the MiniMax descriptor's note.
 */
export function defaultOutputTokens(model: AiModelDescriptor): number {
  return model.recommendedOutputTokens ?? model.maxOutputTokens;
}

/**
 * Hold an operator-chosen output budget inside what the model actually
 * allows. Anything unusable (absent, non-finite, ≤ 0) means "no override" and
 * yields the default; a number is clamped into
 * [MIN_OUTPUT_TOKENS, model.maxOutputTokens] rather than rejected, so a stale
 * override saved against a different model can never fail a generation.
 */
export function clampOutputTokens(model: AiModelDescriptor, requested: number | null | undefined): number {
  if (typeof requested !== "number" || !Number.isFinite(requested) || requested <= 0) {
    return defaultOutputTokens(model);
  }
  const floor = Math.min(MIN_OUTPUT_TOKENS, model.maxOutputTokens);
  return Math.min(Math.max(Math.floor(requested), floor), model.maxOutputTokens);
}

/* ----------------------------------------------------------------- tasks */

export type AiTaskKey =
  | "content_plan"
  | "file_regen"
  | "image_vision"
  | "legacy_v1"
  | "template_compile"
  | "content_write"
  | "site_build"
  | "image_rank"
  | "assistant_chat";

export interface AiTaskDescriptor {
  key: AiTaskKey;
  label: string;
  /** What the task actually demands of a model — shown next to the pickers. */
  description: string;
  /** Where it runs, for the operator's orientation. */
  where: string;
  requires: {
    /** Hard requirement: the model must accept `image_url` parts. */
    vision: boolean;
    /** Hard requirement: the model must be able to emit at least this much. */
    minOutputTokens: number;
    /** Hard requirement: the model must support function calling. */
    toolCalling?: boolean;
  };
  /** Fallback, and what a fresh install runs. */
  defaultProvider: string;
  defaultModel: string;
  /**
   * False when the model is chosen per request rather than by this router
   * (the legacy WGE path reads tool/model off the generation row), so the UI
   * shows it read-only instead of offering an assignment that would be ignored.
   */
  routable: boolean;
}

const contentPlan: AiTaskDescriptor = {
  key: "content_plan",
  label: "Content plan",
  description:
    "One call per site. Must follow a long instruction list exactly and return a single strict JSON object — a model that drifts into prose fails the schema and stops the generation.",
  where: "lib/template-engine/plan.ts",
  // 8k is what the planner's JSON actually needs; the call asks for 32k of
  // headroom but a smaller ceiling still produces a complete content model.
  requires: { vision: false, minOutputTokens: 8000 },
  defaultProvider: "gemini",
  defaultModel: "gemini-3.1-pro-preview",
  routable: true,
};

const fileRegen: AiTaskDescriptor = {
  key: "file_regen",
  label: "Page text rewrite",
  description:
    "The dominant cost: the copy of every content file, plus repair rounds. Only the page's text is sent — never its markup — in small batches, so structure cannot be damaged and a modest output budget is enough.",
  where: "lib/template-engine/personalize.ts",
  requires: { vision: false, minOutputTokens: TEXT_BATCH_TOKENS },
  defaultProvider: "gemini",
  defaultModel: "gemini-3.1-pro-preview",
  routable: true,
};

const imageVision: AiTaskDescriptor = {
  key: "image_vision",
  label: "Image vetting",
  description:
    "Looks at each candidate stock photo and judges people/relevance/quality. MULTIMODAL IS MANDATORY — a text-only model answers confidently about images it never saw. Cheap and batched, so a fast model is the right pick.",
  where: "lib/template-engine/vision.ts",
  // The vision call budgets 8000 tokens because gemini-3.5-flash spends
  // ~1,800 hidden thinking tokens; anything smaller truncates the verdicts.
  requires: { vision: true, minOutputTokens: 8000 },
  defaultProvider: "gemini",
  defaultModel: "gemini-3.5-flash",
  routable: true,
};

const legacyV1: AiTaskDescriptor = {
  key: "legacy_v1",
  label: "Legacy generator (WGE)",
  description:
    "The original single-shot website generator. Its provider and model are chosen per generation when the job is queued, so this router does not override them.",
  where: "lib/template-engine/runner.ts",
  requires: { vision: false, minOutputTokens: 8000 },
  defaultProvider: "gemini",
  defaultModel: "gemini-3.1-pro-preview",
  routable: false,
};

const templateCompile: AiTaskDescriptor = {
  key: "template_compile",
  label: "Template compile (Site Studio)",
  description:
    "One or two short calls per template upload: finds residual demo identity (person names, addresses, places) the deterministic pass cannot, and labels pages/slots semantically. Strict JSON out; a model that drifts into prose is rejected and the template simply stays un-enriched.",
  where: "lib/site-studio/compiler/ai/*",
  requires: { vision: false, minOutputTokens: 8000 },
  defaultProvider: "gemini",
  defaultModel: "gemini-3.1-pro-preview",
  routable: true,
};

const contentWrite: AiTaskDescriptor = {
  key: "content_write",
  label: "Website copy (Site Studio)",
  description:
    "One (or, for a large page, several parallel batch) call(s) per page — every page written in parallel, and a page with too many slots for one reply is itself split into batches. Returns strict JSON of plain strings only — no markup, no URLs, no tokens — and is never shown identity fields (name, phone, email, logo, map), which are injected deterministically instead.",
  where: "lib/site-studio/run/writer.ts",
  // 8000 was sized for 6-slot test fixtures, not a real commercial template —
  // a measured production page with 183 text slots truncated mid-JSON at
  // that ceiling every time. Writing now batches a page's slots (see
  // DEFAULT_WRITE_BATCH_SIZE in writer.ts), but a single batch — or an
  // atomic repeat too big to split across batches — must still comfortably
  // clear real model output, including a verbose model's hidden reasoning
  // tokens (see image_vision's own note on gemini-3.5-flash's ~1,800). Rebased
  // on LONG_OUTPUT_TOKENS, the same "long output" bar file_regen's whole-page
  // rewrite already uses, rather than a second invented number.
  requires: { vision: false, minOutputTokens: LONG_OUTPUT_TOKENS },
  defaultProvider: "gemini",
  defaultModel: "gemini-3.1-pro-preview",
  routable: true,
};

const siteBuild: AiTaskDescriptor = {
  key: "site_build",
  label: "Page rewrite (Site Builder)",
  description:
    "One call per page, every page of the site rewritten in parallel. Sent the page's FULL HTML and returns the FULL rewritten HTML — a real template page is ~110KB (~30k tokens) and must come back whole, or the reply is truncated and refused.",
  where: "lib/site-builder/generate.ts",
  // Same bar as content_write: a whole page must clear real model output,
  // not a JSON-batch-sized one. Site Builder sends and returns markup
  // directly (see docs/superpowers/plans/2026-07-28-site-builder.md), so
  // there is no smaller "just the text" path to size this down to.
  requires: { vision: false, minOutputTokens: LONG_OUTPUT_TOKENS },
  defaultProvider: "gemini",
  defaultModel: "gemini-3.1-pro-preview",
  routable: true,
};

const imageRank: AiTaskDescriptor = {
  key: "image_rank",
  label: "Image ranking (Site Builder)",
  description:
    "Looks at each auto-sourced candidate photo for the Hero and Service image rows and reports which show visible people. Used only to ORDER candidates — people-free ones first — never to discard any; ranking never blocks or fails sourcing, a bad or unconfigured pairing just leaves the original order untouched. MULTIMODAL IS MANDATORY — a text-only model would answer about images it never saw.",
  where: "lib/site-builder/imageRank.ts",
  requires: { vision: true, minOutputTokens: 4000 },
  defaultProvider: "minimax",
  defaultModel: "MiniMax-M3",
  routable: true,
};

const assistantChat: AiTaskDescriptor = {
  key: "assistant_chat",
  label: "AI Assistant",
  description:
    "The chat assistant every user talks to from their own dashboard. It answers by CALLING TOOLS that read that user's data — leads, follow-ups, tickets, team stats — so FUNCTION CALLING IS MANDATORY: a model that cannot call tools does not fail, it answers with numbers it made up. Multi-turn, streamed to the user as it is written.",
  where: "lib/assistant/engine.ts",
  // A reply is prose plus a table or a chart spec — but MiniMax counts its
  // visible thinking against the same output budget, and a deep analysis can
  // think for several thousand tokens before the first word of the answer.
  requires: { vision: false, minOutputTokens: 8000, toolCalling: true },
  defaultProvider: "minimax",
  defaultModel: "MiniMax-M3",
  routable: true,
};

export const AI_TASK_REGISTRY: AiTaskDescriptor[] = [
  contentPlan,
  fileRegen,
  imageVision,
  legacyV1,
  templateCompile,
  contentWrite,
  siteBuild,
  imageRank,
  assistantChat,
];

export function getTask(key: string): AiTaskDescriptor | undefined {
  return AI_TASK_REGISTRY.find((t) => t.key === key);
}

export function isAiTaskKey(key: string): key is AiTaskKey {
  return AI_TASK_REGISTRY.some((t) => t.key === key);
}

/* -------------------------------------------------- capability validation */

/**
 * Why this pairing is impossible, in words an operator can act on — or null
 * when it is fine. THE reason this module exists: a text-only model on the
 * image task does not error, it just answers about nothing, which is
 * indistinguishable from the image bug that cost us a day.
 */
export function assignmentError(taskKey: string, providerKey: string, modelId: string): string | null {
  const task = getTask(taskKey);
  if (!task) return `Unknown task "${taskKey}".`;
  const provider = getProvider(providerKey);
  if (!provider) return `Unknown provider "${providerKey}".`;
  const model = getModel(providerKey, modelId);
  if (!model) return `${provider.label} does not offer a model called "${modelId}".`;

  if (task.requires.vision && !model.vision) {
    return `${task.label} sends images, and ${provider.label} ${model.id} cannot read them. It would answer about images it never saw instead of failing, so this pairing is refused.`;
  }
  if (task.requires.toolCalling && !model.toolCalling) {
    return `${task.label} looks data up by calling tools, and ${provider.label} ${model.id} is not known to support tool calling. It would answer with numbers it made up instead of failing, so this pairing is refused.`;
  }
  if (model.maxOutputTokens < task.requires.minOutputTokens) {
    return `${task.label} needs to emit up to ${task.requires.minOutputTokens.toLocaleString("en-US")} tokens, but ${provider.label} ${model.id} caps out at ${model.maxOutputTokens.toLocaleString("en-US")}. Its output would be truncated.`;
  }
  return null;
}

export function isValidAssignment(taskKey: string, providerKey: string, modelId: string): boolean {
  return assignmentError(taskKey, providerKey, modelId) === null;
}

/** Every (provider, model) pair this task may legally be pointed at. */
export function capableModelsForTask(taskKey: string): { provider: AiProviderDescriptor; model: AiModelDescriptor }[] {
  const out: { provider: AiProviderDescriptor; model: AiModelDescriptor }[] = [];
  for (const provider of AI_PROVIDER_REGISTRY) {
    for (const model of provider.models) {
      if (isValidAssignment(taskKey, provider.key, model.id)) out.push({ provider, model });
    }
  }
  return out;
}

/* ------------------------------------------------------------ credentials */

/** Every required credential field present and non-blank. */
export function hasCompleteCredentials(
  descriptor: AiProviderDescriptor,
  credentials: Record<string, string> | null | undefined,
): boolean {
  if (!credentials) return false;
  return descriptor.credentialFields.every((f) => (credentials[f.key] ?? "").trim().length > 0);
}

/**
 * A safe, human-recognisable echo of what is stored — never the secret itself.
 * A `text` field shows verbatim; a `password` field shows only its last 4.
 */
export function maskCredentialHint(
  descriptor: AiProviderDescriptor,
  credentials: Record<string, string> | null | undefined,
): string | null {
  if (!hasCompleteCredentials(descriptor, credentials)) return null;
  const creds = credentials as Record<string, string>;
  const text = descriptor.credentialFields.find((f) => f.type === "text");
  if (text) return creds[text.key].trim();
  const secret = descriptor.credentialFields.find((f) => f.type === "password");
  if (!secret) return null;
  const v = creds[secret.key].trim();
  return v.length <= 4 ? "••••" : `••••${v.slice(-4)}`;
}

/** The single API key a Bearer-auth provider needs, or null. */
export function apiKeyFrom(
  descriptor: AiProviderDescriptor,
  credentials: Record<string, string> | null | undefined,
): string | null {
  if (!hasCompleteCredentials(descriptor, credentials)) return null;
  const field = descriptor.credentialFields.find((f) => f.type === "password") ?? descriptor.credentialFields[0];
  return field ? ((credentials as Record<string, string>)[field.key] ?? "").trim() || null : null;
}
