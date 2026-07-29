import { createAdminClient } from "@/lib/supabase/admin";
import { decryptSecret, encryptSecret } from "@/lib/mail/crypto";
import type { ProviderSpec } from "@/lib/ai-tools/run";
import { resolveBudget, type RateBudgetOverride } from "./limits";
import {
  AI_PROVIDER_REGISTRY,
  AI_TASK_REGISTRY,
  apiKeyFrom,
  assignmentError,
  clampOutputTokens,
  defaultOutputTokens,
  getModel,
  getProvider,
  getTask,
  hasCompleteCredentials,
  maskCredentialHint,
  type AiProviderDescriptor,
  type AiTaskKey,
} from "./registry";

/**
 * Operator-managed AI provider credentials and per-task model routing.
 * SERVER ONLY (service role).
 *
 * The DB is authoritative. Environment variables (GEMINI_API_KEY,
 * DEEPSEEK_API_KEY, KIMI_API_KEY, MINIMAX_API_KEY) are only ever a ONE-TIME
 * SEED: on the first read, a provider with no row but with an env key gets a
 * row created from it, `on conflict do nothing`, so today's deployment keeps
 * working untouched. After that the row wins.
 *
 * Credentials are AES-256-GCM encrypted with the same key/helpers as mailboxes.
 * `getAiProviderConfigs()` decrypts and is for server callers only;
 * `getAiProviderStatuses()` is the ONLY shape that may reach a client.
 */

export interface AiProviderConfigEntry {
  key: string;
  enabled: boolean;
  /** Decrypted. NEVER serialise this into an HTTP response. */
  credentials: Record<string, string> | null;
  /**
   * The operator's stored rate-budget override, or null for "shipped defaults
   * only". Unlike `credentials` this holds no secret — it is four numbers the
   * vendor publishes — so it is safe to project to a client, and
   * `AiProviderStatus` does exactly that.
   */
  rateLimits: RateBudgetOverride | null;
}

/** Client-safe projection: says whether a credential exists, never what it is. */
export interface AiProviderStatus {
  key: string;
  enabled: boolean;
  configured: boolean;
  /** The last 4 of an API key. Never the secret. */
  hint: string | null;
  /** Operator override, or null for "shipped defaults only". Not a secret. */
  rateLimits: RateBudgetOverride | null;
  updatedAt: string | null;
}

export interface AiTaskAssignment {
  taskKey: string;
  providerKey: string;
  model: string;
  /**
   * Operator's output-token budget for this task, or null to use the model's
   * vendor-recommended default. Always re-clamped to the model's allowed
   * range at resolve time, so a value saved against a different model can
   * never produce an out-of-range request.
   */
  maxOutputTokens: number | null;
  updatedAt: string | null;
}

type ProviderRow = {
  provider_key: string;
  enabled: boolean;
  encrypted_credentials: string | null;
  /** Optional: absent until 0062 is applied — see `readProviderRows`. */
  rate_limits?: RateBudgetOverride | null;
  updated_at: string | null;
};

type AssignmentRow = {
  task_key: string;
  provider_key: string;
  model: string;
  /** Optional: absent until 0059 is applied — see `readAssignmentRows`. */
  max_output_tokens?: number | null;
  updated_at: string | null;
};

const PROVIDER_TABLE = "ai_providers";
const ASSIGNMENT_TABLE = "ai_task_assignments";

/* --------------------------------------------------------------- helpers */

/** Credentials the descriptor's env var describes, or null when absent. */
export function credentialsFromEnv(
  descriptor: AiProviderDescriptor,
  env: Record<string, string | undefined> = process.env,
): Record<string, string> | null {
  const value = (env[descriptor.envKey] ?? "").trim();
  if (!value) return null;
  const field = descriptor.credentialFields.find((f) => f.type === "password") ?? descriptor.credentialFields[0];
  if (!field) return null;
  return { [field.key]: value };
}

function decodeCredentials(payload: string | null): Record<string, string> | null {
  if (!payload) return null;
  try {
    const parsed = JSON.parse(decryptSecret(payload)) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return null;
    const out: Record<string, string> = {};
    for (const [k, v] of Object.entries(parsed as Record<string, unknown>)) {
      if (typeof v === "string") out[k] = v;
    }
    return out;
  } catch {
    // A key rotation or a corrupt row must not take routing down — the
    // provider simply reads as unconfigured and the task falls back.
    return null;
  }
}

function encodeCredentials(credentials: Record<string, string>): string {
  return encryptSecret(JSON.stringify(credentials));
}

/**
 * Create rows for providers that have an env key but no row yet. Idempotent
 * and concurrency-safe: inserts ignore duplicates, so two cold starts racing
 * each other still end up with exactly one row.
 */
export async function seedAiProvidersFromEnv(existingKeys: Set<string>): Promise<boolean> {
  const rows = AI_PROVIDER_REGISTRY.filter((d) => !existingKeys.has(d.key))
    .map((d) => ({ descriptor: d, credentials: credentialsFromEnv(d) }))
    .filter((x): x is { descriptor: AiProviderDescriptor; credentials: Record<string, string> } => x.credentials !== null)
    .map((x) => ({
      provider_key: x.descriptor.key,
      enabled: true,
      encrypted_credentials: encodeCredentials(x.credentials),
      updated_at: new Date().toISOString(),
    }));

  if (!rows.length) return false;
  try {
    const admin = createAdminClient();
    // ignoreDuplicates → "on conflict do nothing": never clobber an edited row.
    await admin.from(PROVIDER_TABLE).upsert(rows, { onConflict: "provider_key", ignoreDuplicates: true });
    return true;
  } catch {
    return false;
  }
}

async function readProviderRows(): Promise<ProviderRow[]> {
  try {
    const admin = createAdminClient();
    // `*` ON PURPOSE, not a column list — the same hazard `readAssignmentRows`
    // already documents, and here it is worse. A column list breaks the moment
    // the code knows about a column the DB has not been migrated to yet: the
    // query errors, the catch below swallows it, and EVERY provider reads as
    // unconfigured — taking ALL AI routing down until the migration lands.
    // With `*`, a column the DB lacks simply reads as undefined.
    const { data } = await admin.from(PROVIDER_TABLE).select("*");
    return (data ?? []) as ProviderRow[];
  } catch {
    return [];
  }
}

/**
 * A stored override, or null when the column is absent (pre-0062) or holds
 * something that is not a JSON object. The 0062 check constraint already
 * enforces "object or null", so this is belt-and-braces for a row written
 * before it — but a cheap one: `resolveBudget` uses the `in` operator, which
 * THROWS on a scalar, and that throw would surface as a failed generation.
 */
function asRateLimits(value: unknown): RateBudgetOverride | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return value as RateBudgetOverride;
}

async function readAssignmentRows(): Promise<AssignmentRow[]> {
  try {
    const admin = createAdminClient();
    // `*` ON PURPOSE, not a column list. This table holds no secrets (task,
    // provider, model, who/when), and a column list breaks the moment the
    // code knows about a column the DB has not been migrated to yet: the
    // query errors, the catch below swallows it, and EVERY assignment
    // silently vanishes into "use the default". With `*`, a column the DB
    // lacks simply reads as undefined and routing keeps working.
    const { data } = await admin.from(ASSIGNMENT_TABLE).select("*");
    return (data ?? []) as AssignmentRow[];
  } catch {
    return [];
  }
}

/* -------------------------------------------------------------- providers */

/** Every configured provider, decrypted. Unknown keys are dropped. */
export async function getAiProviderConfigs(): Promise<AiProviderConfigEntry[]> {
  let rows = await readProviderRows();
  const seeded = await seedAiProvidersFromEnv(new Set(rows.map((r) => r.provider_key)));
  if (seeded) rows = await readProviderRows();

  return rows
    .filter((r) => getProvider(r.provider_key) !== undefined)
    .map((r) => ({
      key: r.provider_key,
      enabled: r.enabled !== false,
      credentials: decodeCredentials(r.encrypted_credentials),
      rateLimits: asRateLimits(r.rate_limits),
    }));
}

/** One entry per REGISTRY provider (even unconfigured ones), client-safe. */
export async function getAiProviderStatuses(): Promise<AiProviderStatus[]> {
  let rows = await readProviderRows();
  const seeded = await seedAiProvidersFromEnv(new Set(rows.map((r) => r.provider_key)));
  if (seeded) rows = await readProviderRows();
  const byKey = new Map(rows.map((r) => [r.provider_key, r]));

  return AI_PROVIDER_REGISTRY.map((d) => {
    const row = byKey.get(d.key);
    const creds = decodeCredentials(row?.encrypted_credentials ?? null);
    return {
      key: d.key,
      enabled: row ? row.enabled !== false : false,
      configured: hasCompleteCredentials(d, creds),
      hint: maskCredentialHint(d, creds),
      rateLimits: asRateLimits(row?.rate_limits),
      updatedAt: row?.updated_at ?? null,
    };
  });
}

export interface SaveAiProviderInput {
  enabled?: boolean;
  /** Omit to keep the stored credentials; `null` clears them. */
  credentials?: Record<string, string> | null;
  /** Omit to keep what is stored; null resets to the shipped defaults. */
  rateLimits?: RateBudgetOverride | null;
  updatedBy?: string | null;
}

/** Upsert one provider. Returns the client-safe status; plaintext never leaves. */
export async function saveAiProvider(key: string, input: SaveAiProviderInput): Promise<AiProviderStatus | null> {
  const descriptor = getProvider(key);
  if (!descriptor) return null;

  const admin = createAdminClient();
  // `*`, for the reason `readProviderRows` documents, plus a second one: this
  // read is what "omit to keep what is stored" is built on, so any column left
  // off the list would be read as undefined and then written back as null —
  // silently wiping the operator's rate budget every time they toggled
  // `enabled` or re-entered a key.
  const { data: existing } = await admin
    .from(PROVIDER_TABLE)
    .select("*")
    .eq("provider_key", key)
    .maybeSingle();
  const row = (existing ?? null) as ProviderRow | null;

  let encrypted = row?.encrypted_credentials ?? null;
  if (input.credentials === null) encrypted = null;
  else if (input.credentials !== undefined) {
    const trimmed: Record<string, string> = {};
    for (const field of descriptor.credentialFields) {
      const v = (input.credentials[field.key] ?? "").trim();
      if (v) trimmed[field.key] = v;
    }
    encrypted = Object.keys(trimmed).length ? encodeCredentials(trimmed) : null;
  }

  const rateLimits = input.rateLimits === undefined ? asRateLimits(row?.rate_limits) : input.rateLimits;

  const patch = {
    provider_key: key,
    enabled: input.enabled ?? (row ? row.enabled !== false : true),
    encrypted_credentials: encrypted,
    rate_limits: rateLimits,
    updated_by: input.updatedBy ?? null,
    updated_at: new Date().toISOString(),
  };

  const { error } = await admin.from(PROVIDER_TABLE).upsert(patch, { onConflict: "provider_key" });
  if (error) throw new Error(error.message);

  const creds = decodeCredentials(encrypted);
  return {
    key,
    enabled: patch.enabled,
    configured: hasCompleteCredentials(descriptor, creds),
    hint: maskCredentialHint(descriptor, creds),
    rateLimits,
    updatedAt: patch.updated_at,
  };
}

/* ------------------------------------------------------------ assignments */

/**
 * Stored task→model assignments, with invalid ones dropped. A row can only be
 * invalid if the registry changed under it (a model retired, a task's
 * requirement tightened) — the API refuses to write one — and when that happens
 * the task must fall back to its default, not run on an impossible pairing.
 */
export async function getAiTaskAssignments(): Promise<AiTaskAssignment[]> {
  const rows = await readAssignmentRows();
  return rows
    .filter((r) => getTask(r.task_key) !== undefined && assignmentError(r.task_key, r.provider_key, r.model) === null)
    .map((r) => ({
      taskKey: r.task_key,
      providerKey: r.provider_key,
      model: r.model,
      maxOutputTokens: typeof r.max_output_tokens === "number" ? r.max_output_tokens : null,
      updatedAt: r.updated_at,
    }));
}

/**
 * Write one assignment. Returns null when the task/pairing is not valid.
 *
 * `maxOutputTokens` is CLAMPED to the chosen model's allowed range before it
 * is stored, so the DB can never hold a budget the vendor would reject;
 * passing null (or omitting it) stores null, meaning "use the model's
 * recommended default".
 */
export async function saveAiTaskAssignment(
  taskKey: string,
  providerKey: string,
  model: string,
  updatedBy?: string | null,
  maxOutputTokens?: number | null,
): Promise<AiTaskAssignment | null> {
  if (assignmentError(taskKey, providerKey, model) !== null) return null;
  const descriptor = getModel(providerKey, model);
  const clamped =
    typeof maxOutputTokens === "number" && descriptor ? clampOutputTokens(descriptor, maxOutputTokens) : null;

  const admin = createAdminClient();
  const patch = {
    task_key: taskKey,
    provider_key: providerKey,
    model,
    max_output_tokens: clamped,
    updated_by: updatedBy ?? null,
    updated_at: new Date().toISOString(),
  };
  const { error } = await admin.from(ASSIGNMENT_TABLE).upsert(patch, { onConflict: "task_key" });
  if (error) throw new Error(error.message);
  return { taskKey, providerKey, model, maxOutputTokens: clamped, updatedAt: patch.updated_at };
}

/** Drop an assignment so the task goes back to its registry default. */
export async function clearAiTaskAssignment(taskKey: string): Promise<boolean> {
  if (!getTask(taskKey)) return false;
  const admin = createAdminClient();
  const { error } = await admin.from(ASSIGNMENT_TABLE).delete().eq("task_key", taskKey);
  if (error) throw new Error(error.message);
  return true;
}

/* --------------------------------------------------------------- routing */

export interface ResolvedTaskModel {
  providerKey: string;
  model: string;
  /** Carries a live API key. Never log or serialise. */
  spec: ProviderSpec;
  /**
   * The output budget a `"model-max"` caller actually gets: the operator's
   * per-task override when they set one, else the model's vendor-recommended
   * figure — always clamped into the model's allowed range, so this is safe
   * to send as-is. `spec.maxOutputTokens` remains the HARD ceiling and still
   * bounds every request independently.
   */
  outputTokens: number;
  /** True when the registry default is running because the assignment could not. */
  usedFallback: boolean;
  /** Human reason the assignment was skipped, when it was. */
  fallbackReason: string | null;
}

/** Build a callable spec for a (provider, model), or null when unusable.
 *  `overrideTokens` is the operator's per-task budget, if they set one. */
function specFor(
  providerKey: string,
  modelId: string,
  configs: AiProviderConfigEntry[],
  overrideTokens?: number | null,
): { spec: ProviderSpec; outputTokens: number; reason: null } | { spec: null; reason: string } {
  const descriptor = getProvider(providerKey);
  if (!descriptor) return { spec: null, reason: `provider "${providerKey}" is not in the registry` };
  const model = getModel(providerKey, modelId);
  if (!model) return { spec: null, reason: `${descriptor.label} no longer offers "${modelId}"` };
  const config = configs.find((c) => c.key === providerKey);
  if (config && !config.enabled) return { spec: null, reason: `${descriptor.label} is disabled` };
  const apiKey = apiKeyFrom(descriptor, config?.credentials);
  if (!apiKey) return { spec: null, reason: `${descriptor.label} has no stored credentials` };
  return {
    spec: {
      label: `${descriptor.label} ${model.id}`,
      endpoint: descriptor.endpoint,
      apiKey,
      maxOutputTokens: model.maxOutputTokens,
      outputTokenParam: descriptor.outputTokenParam,
      // The bucket is the PROVIDER, never the model: a vendor pools its quota
      // across every model and modality on the account.
      providerKey: descriptor.key,
      rateBudget: resolveBudget(descriptor.key, config?.rateLimits ?? null),
    },
    outputTokens: clampOutputTokens(model, overrideTokens),
    reason: null,
  };
}

/**
 * Which model serves this task right now.
 *
 * SAFE BY CONSTRUCTION: a routing misconfiguration must never break website
 * generation, so the assignment is used only when it is valid AND its provider
 * is enabled AND configured. Anything else silently (but loudly logged) falls
 * back to the task's registry default — today's Gemini behaviour. Only when the
 * DEFAULT is also unusable does this throw, and it throws the same
 * "not configured" error the hardcoded path threw before.
 */
export async function resolveTaskModel(taskKey: AiTaskKey): Promise<ResolvedTaskModel> {
  const task = getTask(taskKey);
  if (!task) throw new Error(`Unknown AI task "${taskKey}"`);

  const [configs, assignments] = await Promise.all([
    getAiProviderConfigs().catch(() => [] as AiProviderConfigEntry[]),
    getAiTaskAssignments().catch(() => [] as AiTaskAssignment[]),
  ]);

  const assignment = task.routable ? assignments.find((a) => a.taskKey === taskKey) : undefined;
  let fallbackReason: string | null = null;

  if (assignment) {
    const attempt = specFor(assignment.providerKey, assignment.model, configs, assignment.maxOutputTokens);
    if (attempt.spec) {
      return {
        providerKey: assignment.providerKey,
        model: assignment.model,
        spec: attempt.spec,
        outputTokens: attempt.outputTokens,
        usedFallback: false,
        fallbackReason: null,
      };
    }
    fallbackReason = attempt.reason;
    console.warn(`[ai-routing] ${taskKey}: ${attempt.reason} — falling back to ${task.defaultProvider} ${task.defaultModel}`);
  }

  // The override belongs to the ASSIGNED model, not the fallback one — a
  // budget chosen for a 512K-output model must not follow the task onto an
  // 8K one. The fallback runs on its own model's default.
  const fallback = specFor(task.defaultProvider, task.defaultModel, configs);
  if (fallback.spec) {
    return {
      providerKey: task.defaultProvider,
      model: task.defaultModel,
      spec: fallback.spec,
      outputTokens: fallback.outputTokens,
      usedFallback: assignment !== undefined,
      fallbackReason,
    };
  }

  // Last resort: the default provider's env key, read directly. This is the
  // pre-routing behaviour verbatim, so a DB outage cannot stop a generation
  // that would have run yesterday.
  const descriptor = getProvider(task.defaultProvider);
  const model = descriptor ? getModel(task.defaultProvider, task.defaultModel) : undefined;
  const envKey = descriptor ? (process.env[descriptor.envKey] ?? "").trim() : "";
  if (descriptor && model && envKey) {
    return {
      providerKey: descriptor.key,
      model: model.id,
      spec: {
        label: `${descriptor.label} ${model.id}`,
        endpoint: descriptor.endpoint,
        apiKey: envKey,
        maxOutputTokens: model.maxOutputTokens,
        outputTokenParam: descriptor.outputTokenParam,
        // Same bucket as the DB-configured path above — this branch runs when
        // the DB is unreadable, which must not double the vendor's rate.
        providerKey: descriptor.key,
        rateBudget: resolveBudget(descriptor.key, null),
      },
      outputTokens: defaultOutputTokens(model),
      usedFallback: assignment !== undefined,
      fallbackReason,
    };
  }
  throw new Error(`${descriptor?.label ?? task.defaultProvider} is not configured (missing ${descriptor?.envKey ?? "API key"}).`);
}

/** The registry default spec for a task, or null when it too is unusable. */
export async function defaultSpecForTask(taskKey: AiTaskKey): Promise<ResolvedTaskModel | null> {
  const task = getTask(taskKey);
  if (!task) return null;
  const configs = await getAiProviderConfigs().catch(() => [] as AiProviderConfigEntry[]);
  const attempt = specFor(task.defaultProvider, task.defaultModel, configs);
  if (attempt.spec) {
    return {
      providerKey: task.defaultProvider,
      model: task.defaultModel,
      spec: attempt.spec,
      outputTokens: attempt.outputTokens,
      usedFallback: true,
      fallbackReason: null,
    };
  }
  const descriptor = getProvider(task.defaultProvider);
  const envKey = descriptor ? (process.env[descriptor.envKey] ?? "").trim() : "";
  const model = descriptor ? getModel(task.defaultProvider, task.defaultModel) : undefined;
  if (!descriptor || !model || !envKey) return null;
  return {
    outputTokens: defaultOutputTokens(model),
    providerKey: descriptor.key,
    model: model.id,
    spec: {
      label: `${descriptor.label} ${model.id}`,
      endpoint: descriptor.endpoint,
      apiKey: envKey,
      maxOutputTokens: model.maxOutputTokens,
      outputTokenParam: descriptor.outputTokenParam,
      // See the identical branch in `resolveTaskModel`.
      providerKey: descriptor.key,
      rateBudget: resolveBudget(descriptor.key, null),
    },
    usedFallback: true,
    fallbackReason: null,
  };
}

/** Registry task keys, for callers that want to enumerate without importing both modules. */
export const AI_TASK_KEYS = AI_TASK_REGISTRY.map((t) => t.key);
