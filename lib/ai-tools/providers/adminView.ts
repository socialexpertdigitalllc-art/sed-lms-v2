import {
  AI_PROVIDER_REGISTRY,
  AI_TASK_REGISTRY,
  MIN_OUTPUT_TOKENS,
  capableModelsForTask,
  clampOutputTokens,
  defaultOutputTokens,
  getModel,
  getProvider,
  type AiCredentialField,
  type AiModelDescriptor,
} from "./registry";
import { getAiProviderStatuses, getAiTaskAssignments } from "./config";
import { gateSnapshots, type GateSnapshot } from "./gate";
import { DEFAULT_RATE_BUDGETS, resolveBudget, type RateBudget, type RateBudgetOverride } from "./limits";

/**
 * The one client-safe projection of the AI routing settings.
 *
 * SERVER ONLY. The admin page renders from this, so the page and the API can
 * never drift — and neither can leak a credential, because this shape has no
 * field that could carry one. `configured` + `hint` is all the client ever
 * learns about what is stored.
 */

export interface AiProviderSetting {
  key: string;
  label: string;
  endpoint: string;
  docsUrl: string;
  credentialFields: AiCredentialField[];
  models: AiModelDescriptor[];
  capabilities: { vision: boolean; longOutput: boolean; maxOutputTokens: number };
  enabled: boolean;
  configured: boolean;
  /** The last 4 of an API key. Never the secret. */
  hint: string | null;
  /** The shipped default budget for this provider — shown as placeholder text
   *  so the operator can see what they are overriding. */
  defaultRateBudget: RateBudget;
  /** The operator's stored override, or null when they have set none. */
  rateLimits: RateBudgetOverride | null;
  /** The budget actually in force. */
  effectiveRateBudget: RateBudget;
  /** Live gate state, or null when this provider has not been called yet this
   *  process. An adaptive limiter the operator cannot observe is a black box
   *  the moment it misbehaves. */
  gate: GateSnapshot | null;
  updatedAt: string | null;
}

export interface AiTaskSetting {
  key: string;
  label: string;
  description: string;
  where: string;
  requires: { vision: boolean; minOutputTokens: number };
  routable: boolean;
  defaultProvider: string;
  defaultModel: string;
  defaultLabel: string;
  /** The stored assignment, or null when the task runs its default. */
  assignedProvider: string | null;
  assignedModel: string | null;
  /** Operator's stored output budget, or null when the model's default runs. */
  assignedMaxOutputTokens: number | null;
  /** The budget the next run will actually request, and the range the
   *  operator may choose within for the EFFECTIVE model. */
  effectiveMaxOutputTokens: number;
  outputTokenRange: { min: number; max: number; recommended: number } | null;
  /** What will actually serve the task on the next run. */
  effectiveProvider: string;
  effectiveModel: string;
  effectiveLabel: string;
  /** Why the effective pick is not the assigned one (unconfigured/disabled). */
  effectiveNote: string | null;
  /** Only pairings this task may legally use — the UI offers nothing else. */
  options: { providerKey: string; providerLabel: string; model: string; note?: string; usable: boolean }[];
  updatedAt: string | null;
}

export interface AiRoutingSettings {
  providers: AiProviderSetting[];
  tasks: AiTaskSetting[];
}

function providerLabel(key: string): string {
  return getProvider(key)?.label ?? key;
}

/** Every provider and task with its stored state, ready to render. */
export async function listAiRoutingSettings(): Promise<AiRoutingSettings> {
  const [statuses, assignments] = await Promise.all([
    getAiProviderStatuses().catch(() => []),
    getAiTaskAssignments().catch(() => []),
  ]);
  const statusByKey = new Map(statuses.map((s) => [s.key, s]));
  // Read once for the whole projection rather than per provider: each snapshot
  // banks elapsed quiet-period recovery as it is taken, so one pass keeps every
  // row on the same instant. A provider with no entry has simply not been
  // called in this process yet — the gate is created lazily on first use.
  const gatesByKey = new Map(gateSnapshots().map((g) => [g.key, g]));

  const providers: AiProviderSetting[] = AI_PROVIDER_REGISTRY.map((d) => {
    const s = statusByKey.get(d.key);
    const rateLimits = s?.rateLimits ?? null;
    return {
      key: d.key,
      label: d.label,
      endpoint: d.endpoint,
      docsUrl: d.docsUrl,
      credentialFields: d.credentialFields,
      models: d.models,
      capabilities: d.capabilities,
      enabled: s?.enabled ?? false,
      configured: s?.configured ?? false,
      hint: s?.hint ?? null,
      // Copied, not aliased: DEFAULT_RATE_BUDGETS is process-wide module state
      // and handing a caller the live object would let a stray edit change what
      // every future call is paced against.
      defaultRateBudget: { ...(DEFAULT_RATE_BUDGETS[d.key] ?? {}) },
      rateLimits,
      // The SAME function the call path resolves with, so the number rendered
      // in settings is the number the gate will be given.
      effectiveRateBudget: resolveBudget(d.key, rateLimits),
      gate: gatesByKey.get(d.key) ?? null,
      updatedAt: s?.updatedAt ?? null,
    };
  });

  /** Usable = enabled AND credentials stored. Mirrors resolveTaskModel exactly. */
  const usable = (key: string) => {
    const s = statusByKey.get(key);
    return Boolean(s?.enabled && s?.configured);
  };

  const tasks: AiTaskSetting[] = AI_TASK_REGISTRY.map((t) => {
    const assignment = t.routable ? assignments.find((a) => a.taskKey === t.key) : undefined;
    const assignedUsable = assignment !== undefined && usable(assignment.providerKey);

    const effectiveProvider = assignedUsable ? assignment!.providerKey : t.defaultProvider;
    const effectiveModel = assignedUsable ? assignment!.model : t.defaultModel;
    const effectiveModelDescriptor = getModel(effectiveProvider, effectiveModel);
    const effectiveNote = !assignment
      ? null
      : assignedUsable
        ? null
        : `${providerLabel(assignment.providerKey)} is disabled or has no stored key, so this task is running the default.`;

    return {
      key: t.key,
      label: t.label,
      description: t.description,
      where: t.where,
      requires: t.requires,
      routable: t.routable,
      defaultProvider: t.defaultProvider,
      defaultModel: t.defaultModel,
      defaultLabel: `${providerLabel(t.defaultProvider)} · ${t.defaultModel}`,
      assignedProvider: assignment?.providerKey ?? null,
      assignedModel: assignment?.model ?? null,
      assignedMaxOutputTokens: assignment?.maxOutputTokens ?? null,
      // Budget + range describe the EFFECTIVE model — what will really run —
      // so the number the operator sees is the number that will be sent, even
      // when their assignment is falling back.
      effectiveMaxOutputTokens: effectiveModelDescriptor
        ? clampOutputTokens(effectiveModelDescriptor, assignedUsable ? assignment?.maxOutputTokens : null)
        : 0,
      outputTokenRange: effectiveModelDescriptor
        ? {
            min: Math.min(MIN_OUTPUT_TOKENS, effectiveModelDescriptor.maxOutputTokens),
            max: effectiveModelDescriptor.maxOutputTokens,
            recommended: defaultOutputTokens(effectiveModelDescriptor),
          }
        : null,
      effectiveProvider,
      effectiveModel,
      effectiveLabel: `${providerLabel(effectiveProvider)} · ${effectiveModel}`,
      effectiveNote,
      // Capability-filtered at the source: an impossible pairing is never
      // offered, so the 422 the API would return is a backstop, not the UX.
      options: capableModelsForTask(t.key).map(({ provider, model }) => ({
        providerKey: provider.key,
        providerLabel: provider.label,
        model: model.id,
        note: model.note,
        usable: usable(provider.key),
      })),
      updatedAt: assignment?.updatedAt ?? null,
    };
  });

  return { providers, tasks };
}
