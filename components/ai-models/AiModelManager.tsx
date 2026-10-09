"use client";

import { useCallback, useState } from "react";
import {
  CheckCircle2,
  Cpu,
  ExternalLink,
  Eye,
  Gauge,
  Image as ImageIcon,
  KeyRound,
  Loader2,
  Lock,
  Plug,
  RotateCcw,
  Route,
  ShieldCheck,
  Trash2,
  TriangleAlert,
  XCircle,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { Panel, Pill } from "@/components/common/Panel";
import { btnPrimary, btnSecondarySm, btnGhostSm } from "@/components/common/buttons";
import { Field, inputCls } from "@/components/forms/Field";
import { useToast } from "@/components/common/Toast";
import { resolveBudget } from "@/lib/ai-tools/providers/limits";
import type { AiProviderSetting, AiTaskSetting } from "@/lib/ai-tools/providers/adminView";

/**
 * Admin surface for AI providers and per-task model routing.
 *
 * CREDENTIAL RULE: the API never returns a credential and this component never
 * asks for one. Everything shown about what is stored comes from `configured`
 * and the server-side masked `hint`. Credential inputs start empty, live only
 * in local state while the form is open, and are discarded on save.
 *
 * CAPABILITY RULE: the model select for a task is built from `task.options`,
 * which the server already filtered to pairings that CAN do the job. An
 * impossible choice is never offered — the API's 422 is a backstop, not the UX.
 */

const API = "/api/admin/ai-providers";

type ProviderTest = { ok: true; model: string; ms: number; reply: string } | { ok: false; error: string };

function fmtTime(iso: string | null | undefined): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
}

function optionValue(providerKey: string, model: string): string {
  return `${providerKey}::${model}`;
}

/** Token counts read as "128K"/"1M" far faster than 131072/1000000 when the
 *  operator is comparing a range; exact values stay in the input itself. */
function formatTokens(n: number): string {
  if (n >= 1_000_000) return `${Number((n / 1_000_000).toFixed(2))}M`;
  if (n >= 1000) return `${Number((n / 1000).toFixed(n % 1000 === 0 ? 0 : 1))}K`;
  return String(n);
}

/* ------------------------------------------------------------ credentials */

function CredentialForm({ provider, onPatch }: { provider: AiProviderSetting; onPatch: (next: Partial<AiProviderSetting>) => void }) {
  const { toast } = useToast();
  const [open, setOpen] = useState(!provider.configured);
  const [values, setValues] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
  const [clearing, setClearing] = useState(false);

  const complete = provider.credentialFields.every((f) => (values[f.key] ?? "").trim().length > 0);

  async function put(body: Record<string, unknown>): Promise<Record<string, unknown> | null> {
    const res = await fetch(API, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ kind: "provider", provider_key: provider.key, ...body }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      toast({ kind: "error", title: "Could not save", body: typeof data.error === "string" ? data.error : undefined });
      return null;
    }
    return data as Record<string, unknown>;
  }

  async function save(e: React.FormEvent) {
    e.preventDefault();
    if (!complete) return;
    setSaving(true);
    try {
      const data = await put({ credentials: values });
      if (!data) return;
      const p = data.provider as Partial<AiProviderSetting> | null;
      setValues({}); // drop the plaintext the moment the request resolves
      setOpen(false);
      onPatch({ configured: p?.configured ?? true, hint: p?.hint ?? null, enabled: p?.enabled ?? true, updatedAt: p?.updatedAt ?? null });
      toast({ kind: "success", title: `${provider.label} key saved` });
    } finally {
      setSaving(false);
    }
  }

  async function clear() {
    if (!confirm(`Clear the stored ${provider.label} key? Any task assigned to it falls back to its default model.`)) return;
    setClearing(true);
    try {
      const data = await put({ credentials: null });
      if (!data) return;
      setValues({});
      setOpen(true);
      onPatch({ configured: false, hint: null });
      toast({ kind: "success", title: `${provider.label} key cleared` });
    } finally {
      setClearing(false);
    }
  }

  return (
    <div className="rounded-md border border-border-subtle bg-surface-2 p-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex min-w-0 items-center gap-2">
          <KeyRound className="h-4 w-4 shrink-0 text-text-faint" aria-hidden />
          <span className="text-xs font-medium text-text">Credentials</span>
          {provider.configured ? (
            <span className="tabular truncate font-mono text-[11px] text-text-muted" title="A masked echo — the stored key is never sent to the browser">
              {provider.hint ?? "stored"}
            </span>
          ) : (
            <span className="text-[11px] text-text-faint">not set</span>
          )}
        </div>
        {provider.configured ? (
          <div className="flex items-center gap-1">
            <button type="button" onClick={() => setOpen((v) => !v)} className={btnGhostSm}>
              <Eye className="h-4 w-4" /> {open ? "Cancel" : "Replace key"}
            </button>
            <button type="button" onClick={clear} disabled={clearing} className={btnGhostSm}>
              {clearing ? <Loader2 className="h-4 w-4 animate-spin" /> : <Trash2 className="h-4 w-4" />} Clear
            </button>
          </div>
        ) : null}
      </div>

      {open ? (
        <form onSubmit={save} className="mt-3 space-y-3">
          <div className="grid gap-3 sm:grid-cols-2">
            {provider.credentialFields.map((f) => (
              <Field key={f.key} label={f.label} required>
                <input
                  type={f.type === "password" ? "password" : "text"}
                  value={values[f.key] ?? ""}
                  onChange={(e) => setValues((v) => ({ ...v, [f.key]: e.target.value }))}
                  placeholder={f.placeholder ?? ""}
                  autoComplete="off"
                  spellCheck={false}
                  className={cn(inputCls, f.type === "password" && "font-mono")}
                />
              </Field>
            ))}
          </div>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="flex items-center gap-1.5 text-[11px] text-text-faint">
              <Lock className="h-3.5 w-3.5 shrink-0" aria-hidden />
              Encrypted at rest. Never sent back to the browser — only a masked hint is.
            </p>
            <button type="submit" disabled={!complete || saving} className={btnPrimary}>
              {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <CheckCircle2 className="h-4 w-4" />}
              {provider.configured ? "Replace" : "Save"}
            </button>
          </div>
        </form>
      ) : null}
    </div>
  );
}

/* ------------------------------------------------------------ rate limits */

const DIMENSIONS = [
  { key: "concurrency" as const, label: "Concurrent", hint: "Requests in flight at once" },
  { key: "rpm" as const, label: "Requests / min", hint: "RPM" },
  { key: "tpm" as const, label: "Tokens / min", hint: "TPM, input + output" },
  { key: "tpd" as const, label: "Tokens / day", hint: "TPD, blank if unlimited" },
];

type RateBudgetish = AiProviderSetting["effectiveRateBudget"];

/** The four boxes as strings, seeded from whatever override is stored. Written
 *  once and reused after a save so the boxes always show what was ACTUALLY
 *  stored rather than what was typed — see `save`. */
function draftFrom(stored: AiProviderSetting["rateLimits"]): Record<string, string> {
  return Object.fromEntries(
    DIMENSIONS.map((d) => {
      const value = stored?.[d.key];
      return [d.key, value != null ? String(value) : ""];
    }),
  );
}

/** Only the dimensions this provider actually declares — an omitted one is not
 *  "zero", it is a limit the vendor never published and the gate never applies. */
function describeBudget(budget: RateBudgetish): string {
  const parts: string[] = [];
  for (const d of DIMENSIONS) {
    const value = budget[d.key];
    if (value != null) parts.push(`${d.key} ${formatTokens(value)}`);
  }
  return parts.join(" · ");
}

function RateLimitForm({ provider, onPatch }: { provider: AiProviderSetting; onPatch: (next: Partial<AiProviderSetting>) => void }) {
  const { toast } = useToast();
  const [values, setValues] = useState<Record<string, string>>(() => draftFrom(provider.rateLimits));
  const [saving, setSaving] = useState(false);

  async function save(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    try {
      // Blank means "use the shipped default" — send the key OMITTED, not null,
      // since null carries the distinct meaning "this vendor does not limit
      // that dimension" (see limits.ts's RateBudgetOverride).
      const rate_limits: Record<string, number> = {};
      for (const d of DIMENSIONS) {
        const raw = (values[d.key] ?? "").trim();
        if (!raw) continue;
        const n = Number(raw);
        // Deliberately the SAME predicate resolveBudget applies server-side,
        // floor included: a value this drops or rounds must not be left sitting
        // in the box looking accepted.
        if (Number.isFinite(n) && n >= 1) rate_limits[d.key] = Math.floor(n);
      }
      const res = await fetch(API, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ kind: "provider", provider_key: provider.key, rate_limits }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast({ kind: "error", title: "Could not save limits", body: typeof data.error === "string" ? data.error : undefined });
        return;
      }
      // Echo back what the server STORED, exactly as the task-budget field does,
      // and resolve the effective budget with the SAME function the call path
      // uses — so the screen can never claim a ceiling the gate is not given.
      const p = data.provider as Partial<AiProviderSetting> | null;
      const stored = p?.rateLimits ?? rate_limits;
      setValues(draftFrom(stored));
      onPatch({ rateLimits: stored, effectiveRateBudget: resolveBudget(provider.key, stored) });
      toast({ kind: "success", title: `${provider.label} limits saved` });
    } finally {
      setSaving(false);
    }
  }

  const gate = provider.gate;

  return (
    <form onSubmit={save} className="rounded-md border border-border-subtle bg-surface-2 p-3">
      <div className="flex items-center gap-2">
        <Gauge className="h-4 w-4 shrink-0 text-text-faint" aria-hidden />
        <span className="text-xs font-medium text-text">Rate limits</span>
      </div>
      <p className="mt-1.5 text-[11px] leading-relaxed text-text-muted">
        Your account tier&apos;s ceilings. Leave a box blank to use our conservative default, shown greyed. Every AI call in the app
        shares one budget per provider, so a blank box is not &ldquo;unlimited&rdquo; — it is &ldquo;we&apos;ll guess low&rdquo;.
      </p>
      <div className="mt-2 grid grid-cols-2 gap-2 lg:grid-cols-4">
        {DIMENSIONS.map((d) => (
          <label key={d.key} className="block">
            <span className="text-[11px] text-text-muted" title={d.hint}>
              {d.label}
            </span>
            <input
              type="number"
              min={1}
              inputMode="numeric"
              value={values[d.key] ?? ""}
              placeholder={provider.defaultRateBudget[d.key] != null ? String(provider.defaultRateBudget[d.key]) : "none"}
              onChange={(e) => setValues((v) => ({ ...v, [d.key]: e.target.value }))}
              className="tabular mt-1 w-full rounded border border-border bg-surface px-2 py-1 font-mono text-[11px] text-text"
            />
          </label>
        ))}
      </div>
      <p className="tabular mt-2 font-mono text-[11px] text-text-faint">
        In force: {describeBudget(provider.effectiveRateBudget) || "no ceiling declared for this provider"}
      </p>
      <div className="mt-2 flex flex-wrap items-center gap-3">
        <button type="submit" disabled={saving} className={btnSecondarySm}>
          {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : null} Save limits
        </button>
        {gate ? (
          <span className="tabular font-mono text-[11px] text-text-faint">
            {gate.inFlight} in flight · {gate.requestsThisMinute}/min · pacing at {Math.round(gate.scale * 100)}%
            {/* Only when it differs: at full pace the figure above already says it. */}
            {gate.scale < 1 ? ` (${describeBudget(gate.effectiveBudget)} until it recovers)` : ""}
            {gate.throttlesLastHour > 0 ? ` · ${gate.throttlesLastHour} throttled in the last hour` : ""}
          </span>
        ) : (
          <span className="text-[11px] text-text-faint">No calls yet this session.</span>
        )}
      </div>
    </form>
  );
}

/* -------------------------------------------------------------- provider */

function ProviderCard({ provider, onPatch }: { provider: AiProviderSetting; onPatch: (key: string, next: Partial<AiProviderSetting>) => void }) {
  const { toast } = useToast();
  const [toggling, setToggling] = useState(false);
  const [testing, setTesting] = useState(false);
  const [test, setTest] = useState<ProviderTest | null>(null);

  async function toggle() {
    setToggling(true);
    try {
      const res = await fetch(API, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ kind: "provider", provider_key: provider.key, enabled: !provider.enabled }),
      });
      if (!res.ok) {
        toast({ kind: "error", title: "Could not change the provider" });
        return;
      }
      onPatch(provider.key, { enabled: !provider.enabled });
    } finally {
      setToggling(false);
    }
  }

  async function runTest() {
    setTesting(true);
    setTest(null);
    try {
      const res = await fetch(`${API}/${encodeURIComponent(provider.key)}/test`, { method: "POST" });
      const data = await res.json().catch(() => ({}));
      if (data?.ok === true) setTest({ ok: true, model: data.model, ms: data.ms ?? 0, reply: data.reply ?? "" });
      else setTest({ ok: false, error: data?.error ?? "The test could not be completed" });
    } catch {
      setTest({ ok: false, error: "The test request failed" });
    } finally {
      setTesting(false);
    }
  }

  const visionModels = provider.models.filter((m) => m.vision).length;

  return (
    <article className={cn("overflow-hidden rounded-lg border bg-surface transition-colors duration-150", provider.enabled ? "border-border" : "border-border-subtle")}>
      <header className="flex flex-wrap items-start justify-between gap-3 border-b border-border-subtle px-4 py-3">
        <div className="min-w-0">
          <h3 className="flex flex-wrap items-center gap-2 font-display text-sm font-semibold leading-tight text-text">
            <span className="truncate">{provider.label}</span>
            {provider.enabled && provider.configured ? (
              <Pill tone="ready" className="normal-case">
                available
              </Pill>
            ) : (
              <Pill tone="neutral" className="normal-case">
                {!provider.configured ? "no key stored" : "disabled"}
              </Pill>
            )}
          </h3>
          <p className="tabular mt-0.5 font-mono text-[11px] text-text-faint">
            {provider.models.length} models · {visionModels} multimodal · up to {provider.capabilities.maxOutputTokens.toLocaleString("en-US")} output tokens
            {provider.updatedAt ? ` · updated ${fmtTime(provider.updatedAt)}` : ""}
          </p>
        </div>

        <div className="flex shrink-0 items-center gap-2">
          {provider.docsUrl ? (
            <a href={provider.docsUrl} target="_blank" rel="noreferrer" className={btnGhostSm} title={`${provider.label} API documentation`}>
              <ExternalLink className="h-4 w-4" /> Docs
            </a>
          ) : null}
          <button
            type="button"
            role="switch"
            aria-checked={provider.enabled}
            aria-label={`${provider.enabled ? "Disable" : "Enable"} ${provider.label}`}
            onClick={toggle}
            disabled={toggling}
            className={cn(
              "relative inline-flex h-6 w-11 shrink-0 items-center rounded-full transition-colors duration-150",
              "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent disabled:opacity-55",
              provider.enabled ? "bg-accent" : "bg-border",
            )}
          >
            <span className={cn("inline-block h-4 w-4 rounded-full bg-surface transition-transform duration-150", provider.enabled ? "translate-x-6" : "translate-x-1")} />
          </button>
        </div>
      </header>

      <div className="grid gap-3 p-4 lg:grid-cols-2">
        <div className="rounded-md border border-border-subtle bg-surface-2 p-3">
          <div className="flex items-center gap-2">
            <Cpu className="h-4 w-4 shrink-0 text-text-faint" aria-hidden />
            <span className="text-xs font-medium text-text">Models</span>
          </div>
          <ul className="mt-2 space-y-1">
            {provider.models.map((m) => (
              <li key={m.id} className="flex flex-wrap items-center gap-1.5">
                <span className="tabular font-mono text-[11px] text-text">{m.id}</span>
                {m.vision ? (
                  <span className="inline-flex items-center gap-1 text-[11px] text-ready-fg" title="Accepts image input">
                    <ImageIcon className="h-3 w-3" aria-hidden /> vision
                  </span>
                ) : null}
                <span className="tabular font-mono text-[11px] text-text-faint">{m.maxOutputTokens.toLocaleString("en-US")} out</span>
              </li>
            ))}
          </ul>
        </div>

        <div className="rounded-md border border-border-subtle bg-surface-2 p-3">
          <div className="flex items-center gap-2">
            <Plug className="h-4 w-4 shrink-0 text-text-faint" aria-hidden />
            <span className="text-xs font-medium text-text">Connection test</span>
          </div>
          <p className="mt-1.5 text-[11px] leading-relaxed text-text-muted">
            Sends one tiny completion (16 output tokens, temperature 0) to {provider.models[0]?.id ?? "the first model"}. There is no free
            credential-check endpoint for these vendors, so this does spend a few tokens — a fraction of a cent.
          </p>
          <button type="button" onClick={runTest} disabled={testing || !provider.configured} className={cn(btnSecondarySm, "mt-2")}>
            {testing ? <Loader2 className="h-4 w-4 animate-spin" /> : <ShieldCheck className="h-4 w-4" />} Test connection
          </button>

          {test ? (
            test.ok ? (
              <p className="tabular mt-2 flex items-start gap-1.5 font-mono text-[11px] leading-relaxed text-ready-fg">
                <CheckCircle2 className="mt-px h-3.5 w-3.5 shrink-0" aria-hidden />
                <span>
                  Key accepted — {test.model} answered in {test.ms}ms.
                </span>
              </p>
            ) : (
              <p className="mt-2 flex items-start gap-1.5 text-[11px] leading-relaxed text-dropped-fg">
                <XCircle className="mt-px h-3.5 w-3.5 shrink-0" aria-hidden />
                <span>{test.error}</span>
              </p>
            )
          ) : null}
        </div>

        <div className="lg:col-span-2">
          <RateLimitForm provider={provider} onPatch={(next) => onPatch(provider.key, next)} />
        </div>

        <div className="lg:col-span-2">
          <CredentialForm provider={provider} onPatch={(next) => onPatch(provider.key, next)} />
        </div>
      </div>
    </article>
  );
}

/* ------------------------------------------------------------------ tasks */

function TaskRow({ task, onPatch }: { task: AiTaskSetting; onPatch: (key: string, next: Partial<AiTaskSetting>) => void }) {
  const { toast } = useToast();
  const [saving, setSaving] = useState(false);
  const [budgetDraft, setBudgetDraft] = useState(
    task.assignedMaxOutputTokens === null ? "" : String(task.assignedMaxOutputTokens),
  );

  const current = task.assignedProvider && task.assignedModel ? optionValue(task.assignedProvider, task.assignedModel) : "";

  async function put(body: Record<string, unknown>) {
    setSaving(true);
    try {
      const res = await fetch(API, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ kind: "assignment", task_key: task.key, ...body }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast({ kind: "error", title: "Could not change the model", body: typeof data.error === "string" ? data.error : undefined });
        return null;
      }
      return data as {
        assignment: { providerKey: string; model: string; maxOutputTokens: number | null; updatedAt: string } | null;
      };
    } finally {
      setSaving(false);
    }
  }

  /**
   * Save the typed budget against the CURRENTLY assigned model. Sends null
   * for an empty box (= use the vendor's recommended default) and echoes back
   * whatever the server actually stored, which is the clamped value — so a
   * number typed above the model's ceiling visibly snaps down to it rather
   * than appearing to have been accepted verbatim.
   */
  async function commitBudget() {
    if (!task.assignedProvider || !task.assignedModel) return;
    const trimmed = budgetDraft.trim();
    const parsed = trimmed === "" ? null : Number(trimmed);
    if (parsed !== null && (!Number.isFinite(parsed) || parsed <= 0)) {
      setBudgetDraft(task.assignedMaxOutputTokens === null ? "" : String(task.assignedMaxOutputTokens));
      return;
    }
    if (parsed === task.assignedMaxOutputTokens) return;

    const data = await put({
      provider_key: task.assignedProvider,
      model: task.assignedModel,
      max_output_tokens: parsed,
    });
    if (!data) {
      setBudgetDraft(task.assignedMaxOutputTokens === null ? "" : String(task.assignedMaxOutputTokens));
      return;
    }
    const stored = data.assignment?.maxOutputTokens ?? null;
    setBudgetDraft(stored === null ? "" : String(stored));
    onPatch(task.key, {
      assignedMaxOutputTokens: stored,
      effectiveMaxOutputTokens: stored ?? task.outputTokenRange?.recommended ?? task.effectiveMaxOutputTokens,
      updatedAt: data.assignment?.updatedAt ?? null,
    });
    toast({
      kind: "success",
      title: stored === null ? `${task.label} → recommended output budget` : `${task.label} → ${stored} output tokens`,
    });
  }

  async function choose(value: string) {
    if (!value) {
      const data = await put({ provider_key: null, model: null });
      if (!data) return;
      setBudgetDraft("");
      onPatch(task.key, {
        assignedProvider: null,
        assignedModel: null,
        assignedMaxOutputTokens: null,
        effectiveProvider: task.defaultProvider,
        effectiveModel: task.defaultModel,
        effectiveLabel: task.defaultLabel,
        effectiveNote: null,
        updatedAt: null,
      });
      toast({ kind: "success", title: `${task.label} reset to default` });
      return;
    }
    const [providerKey, model] = value.split("::");
    // No max_output_tokens: switching model CLEARS the budget rather than
    // carrying a number chosen for a different model's range onto this one.
    const data = await put({ provider_key: providerKey, model });
    if (!data) return;
    setBudgetDraft("");
    const option = task.options.find((o) => o.providerKey === providerKey && o.model === model);
    onPatch(task.key, {
      assignedProvider: providerKey,
      assignedModel: model,
      assignedMaxOutputTokens: null,
      effectiveProvider: option?.usable ? providerKey : task.defaultProvider,
      effectiveModel: option?.usable ? model : task.defaultModel,
      effectiveLabel: option?.usable ? `${option.providerLabel} · ${model}` : task.defaultLabel,
      effectiveNote: option?.usable
        ? null
        : `${option?.providerLabel ?? providerKey} is disabled or has no stored key, so this task is running the default.`,
      updatedAt: data.assignment?.updatedAt ?? null,
    });
    toast({ kind: "success", title: `${task.label} → ${model}` });
  }

  return (
    <article className="rounded-lg border border-border bg-surface p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h3 className="flex flex-wrap items-center gap-2 font-display text-sm font-semibold leading-tight text-text">
            <span>{task.label}</span>
            {task.requires.vision ? (
              <Pill tone="accent" className="normal-case">
                multimodal required
              </Pill>
            ) : null}
            {task.requires.minOutputTokens >= 32000 ? (
              <Pill tone="accent" className="normal-case">
                long output required
              </Pill>
            ) : null}
            {task.requires.toolCalling ? (
              <Pill tone="accent" className="normal-case">
                tool calling required
              </Pill>
            ) : null}
            {!task.routable ? (
              <Pill tone="neutral" className="normal-case">
                chosen per generation
              </Pill>
            ) : null}
          </h3>
          <p className="mt-1 max-w-2xl text-xs leading-relaxed text-text-muted">{task.description}</p>
          <p className="tabular mt-1 font-mono text-[11px] text-text-faint">{task.where}</p>
        </div>

        <div className="shrink-0 text-right">
          <p className="text-[11px] uppercase tracking-wide text-text-faint">Serving this task</p>
          <p className="tabular font-mono text-xs text-text">{task.effectiveLabel}</p>
          {task.outputTokenRange ? (
            <p className="tabular mt-0.5 font-mono text-[11px] text-text-faint">
              {formatTokens(task.effectiveMaxOutputTokens)} output
            </p>
          ) : null}
        </div>
      </div>

      {task.routable ? (
        <div className="mt-3 flex flex-wrap items-end gap-2">
          <Field label="Provider and model" className="min-w-[18rem] flex-1">
            <select value={current} onChange={(e) => void choose(e.target.value)} disabled={saving} className={inputCls}>
              <option value="">Default — {task.defaultLabel}</option>
              {task.options.map((o) => (
                <option key={optionValue(o.providerKey, o.model)} value={optionValue(o.providerKey, o.model)}>
                  {o.providerLabel} · {o.model}
                  {o.usable ? "" : " (no key stored)"}
                </option>
              ))}
            </select>
          </Field>

          {/* Output budget. Only offered once a model is actually assigned:
              the allowed range is a property of THAT model, and a number
              typed against the registry default would be re-clamped the
              moment the operator picks a different one. */}
          {task.outputTokenRange && current ? (
            <Field label="Max output tokens" className="w-44">
              <input
                type="number"
                inputMode="numeric"
                className={inputCls}
                min={task.outputTokenRange.min}
                max={task.outputTokenRange.max}
                step={1000}
                value={budgetDraft}
                disabled={saving}
                placeholder={String(task.outputTokenRange.recommended)}
                onChange={(e) => setBudgetDraft(e.target.value)}
                onBlur={() => void commitBudget()}
                onKeyDown={(e) => {
                  if (e.key === "Enter") void commitBudget();
                }}
              />
            </Field>
          ) : null}

          <button type="button" onClick={() => void choose("")} disabled={saving || !current} className={cn(btnSecondarySm, "mb-0.5")}>
            {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <RotateCcw className="h-4 w-4" />} Reset to default
          </button>
        </div>
      ) : null}

      {task.outputTokenRange && current ? (
        <p className="mt-1.5 text-[11px] leading-relaxed text-text-faint">
          Allowed {formatTokens(task.outputTokenRange.min)}–{formatTokens(task.outputTokenRange.max)} for this model;
          leave blank for the vendor&apos;s recommended {formatTokens(task.outputTokenRange.recommended)}. A value above
          the model&apos;s ceiling is clamped, not rejected. Raise this if whole pages come back cut off mid-file; note
          that input and output share one budget on some providers, so the very top of the range is not always reachable.
        </p>
      ) : null}

      {task.effectiveNote ? (
        <p className="mt-2 flex items-start gap-1.5 text-[11px] leading-relaxed text-notready-fg">
          <TriangleAlert className="mt-px h-3.5 w-3.5 shrink-0" aria-hidden />
          <span>{task.effectiveNote}</span>
        </p>
      ) : null}

      <p className="mt-2 text-[11px] leading-relaxed text-text-faint">
        Only models that can do this job are listed
        {task.requires.vision ? " — text-only models are excluded because they would answer about images they never saw" : ""}
        {task.requires.minOutputTokens >= 32000
          ? ` — models that cap below ${task.requires.minOutputTokens.toLocaleString("en-US")} output tokens are excluded because they would truncate the page`
          : ""}
        {task.requires.toolCalling
          ? " — models without verified tool calling are excluded because they would answer with numbers they made up"
          : ""}
        .
      </p>
    </article>
  );
}

/* ------------------------------------------------------------------ shell */

export function AiModelManager({ providers, tasks }: { providers: AiProviderSetting[]; tasks: AiTaskSetting[] }) {
  const [providerRows, setProviderRows] = useState(providers);
  const [taskRows, setTaskRows] = useState(tasks);

  const patchProvider = useCallback((key: string, next: Partial<AiProviderSetting>) => {
    setProviderRows((prev) => prev.map((p) => (p.key === key ? { ...p, ...next } : p)));
  }, []);
  const patchTask = useCallback((key: string, next: Partial<AiTaskSetting>) => {
    setTaskRows((prev) => prev.map((t) => (t.key === key ? { ...t, ...next } : t)));
  }, []);

  return (
    <div className="space-y-4">
      <Panel icon={Route} title="Task routing" description="Each AI task can run on its own provider and model. Spread the load, or keep the defaults.">
        <div className="space-y-3">
          {taskRows.map((t) => (
            <TaskRow key={t.key} task={t} onPatch={patchTask} />
          ))}
        </div>
      </Panel>

      <Panel icon={Cpu} title="Providers" description="Keys are entered here, encrypted at rest, and never leave the server.">
        <div className="space-y-4">
          {providerRows.map((p) => (
            <ProviderCard key={p.key} provider={p} onPatch={patchProvider} />
          ))}
        </div>
      </Panel>

      <Panel icon={ShieldCheck} title="How routing fails safe">
        <ol className="space-y-1.5 text-xs leading-relaxed text-text-muted">
          <li>
            <span className="text-text">1.</span> A task with no assignment runs its default model — the same one it ran before routing
            existed.
          </li>
          <li>
            <span className="text-text">2.</span> An assignment is only used when the model can actually do the job, and the provider is
            enabled with a stored key. Anything else falls back to the default instead of failing the generation.
          </li>
          <li>
            <span className="text-text">3.</span> If the assigned provider is reachable but errors, the call is retried once on the default
            before the generation&rsquo;s own retry logic sees a failure.
          </li>
          <li>
            <span className="text-text">4.</span> Impossible pairings are never offered here, and are refused by the API if requested
            directly — a text-only model on image vetting would answer about photos it never saw.
          </li>
        </ol>
      </Panel>
    </div>
  );
}
