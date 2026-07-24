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
  /** Provider-documented ceiling on output tokens for THIS model. */
  maxOutputTokens: number;
  /** One short factual line for the picker. No marketing copy. */
  note?: string;
}

export interface AiProviderDescriptor {
  key: string;
  label: string;
  /** OpenAI-compatible chat/completions URL. */
  endpoint: string;
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
    { id: "gemini-3.1-pro-preview", vision: true, maxOutputTokens: 64000, note: "Verified default for planning and whole-file rewrites." },
    { id: "gemini-3.5-flash", vision: true, maxOutputTokens: 64000, note: "Cheap and fast; the verified default for image vetting." },
    { id: "gemini-2.5-pro", vision: true, maxOutputTokens: 64000 },
    { id: "gemini-2.5-flash", vision: true, maxOutputTokens: 64000 },
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
    { id: "deepseek-chat", vision: false, maxOutputTokens: 8192, note: "Text only. Good at strict JSON; too small to rewrite a whole page." },
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
    { id: "moonshot-v1-128k", vision: false, maxOutputTokens: 32000, note: "Text only. Large enough to return a whole page." },
    { id: "kimi-k2-0711-preview", vision: false, maxOutputTokens: 32000, note: "Text only." },
    { id: "moonshot-v1-32k", vision: false, maxOutputTokens: 32000, note: "Text only." },
    { id: "moonshot-v1-auto", vision: false, maxOutputTokens: 32000, note: "Text only. Moonshot picks the context size." },
  ],
  credentialFields: [{ key: "api_key", label: "API key", type: "password" }],
  capabilities: { vision: false, longOutput: true, maxOutputTokens: 32000 },
  docsUrl: "https://platform.moonshot.ai/docs/api/chat",
  envKey: "KIMI_API_KEY",
};

/**
 * MiniMax. Grounded in the vendor's own OpenAI-SDK page
 * (platform.minimax.io/docs/api-reference/text-openai-api), read 2026-07-20:
 * base_url `https://api.minimax.io/v1`, Bearer key, and the model ids below are
 * the ones that page lists. That page also states that image (and video) input
 * on chat/completions is supported for `MiniMax-M3` — so M3 is the ONLY model
 * here flagged vision, and pointing the image task at any other MiniMax model
 * is refused rather than silently mis-run.
 *
 * The official OpenAI-compat page does NOT publish a max output-token ceiling,
 * so `maxOutputTokens` is a deliberately conservative 32000 rather than an
 * invented number — `callWithProvider` only ever sends min(requested, this).
 */
const minimax: AiProviderDescriptor = {
  key: "minimax",
  label: "MiniMax",
  endpoint: "https://api.minimax.io/v1/chat/completions",
  models: [
    { id: "MiniMax-M3", vision: true, maxOutputTokens: 32000, note: "The only MiniMax model documented to accept image input." },
    { id: "MiniMax-M2.7", vision: false, maxOutputTokens: 32000, note: "Text only." },
    { id: "MiniMax-M2.5", vision: false, maxOutputTokens: 32000, note: "Text only." },
    { id: "MiniMax-M2.1", vision: false, maxOutputTokens: 32000, note: "Text only." },
    { id: "MiniMax-M2", vision: false, maxOutputTokens: 32000, note: "Text only." },
  ],
  credentialFields: [{ key: "api_key", label: "API key", type: "password" }],
  capabilities: { vision: true, longOutput: true, maxOutputTokens: 32000 },
  docsUrl: "https://platform.minimax.io/docs/api-reference/text-openai-api",
  envKey: "MINIMAX_API_KEY",
};

export const AI_PROVIDER_REGISTRY: AiProviderDescriptor[] = [gemini, deepseek, webcraft, minimax];

export function getProvider(key: string): AiProviderDescriptor | undefined {
  return AI_PROVIDER_REGISTRY.find((p) => p.key === key);
}

export function getModel(providerKey: string, modelId: string): AiModelDescriptor | undefined {
  return getProvider(providerKey)?.models.find((m) => m.id === modelId);
}

/* ----------------------------------------------------------------- tasks */

export type AiTaskKey = "content_plan" | "file_regen" | "image_vision" | "legacy_v1" | "template_compile";

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

export const AI_TASK_REGISTRY: AiTaskDescriptor[] = [contentPlan, fileRegen, imageVision, legacyV1, templateCompile];

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
