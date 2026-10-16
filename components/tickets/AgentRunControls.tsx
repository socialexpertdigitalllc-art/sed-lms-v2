"use client";

import { useEffect, useState } from "react";
import { Loader2, Settings2, X } from "lucide-react";
import { btnPrimary, iconBtn } from "@/components/common/buttons";
import { useToast } from "@/components/common/Toast";
import {
  AGENT_ENGINE_ORDER,
  AGENT_ENGINES,
  AGENT_SPEED_ORDER,
  AGENT_SPEEDS,
  BUILT_IN_DEFAULTS,
  DEFAULT_MINIMAX_MODEL,
  HOUSE_RULES_MAX,
  MAX_RETRIES,
  MINIMAX_DEFAULT_MAX_TOKENS,
  MINIMAX_EFFORTS,
  MINIMAX_LIMITS,
  TIME_LIMIT_CHOICES,
  defaultMinimaxSteps,
  isMinimaxModel,
  minimaxModels,
  readRunOptions,
  runEngine,
  type AgentDefaults,
  type AgentEngine,
  type AgentSpeed,
  type MinimaxEffort,
  type MinimaxSettings,
} from "@/lib/site-agent/options";
import type { AgentModelStat } from "@/lib/site-agent/settings";
import type { AgyModel } from "@/lib/site-agent/types";
import { cn } from "@/lib/utils";

/**
 * The AI developer's per-run controls (send dialog, "Request changes") and the
 * team settings dialog. Every control the worker honours is here: model (with
 * its thinking level), speed, time limit, retries and the site map; the team
 * settings add the standing rules and show how long each model really takes.
 */

/** What the controls edit. `model` "" = Antigravity's own default. */
export interface ControlsValue {
  /** Which AI does the work. */
  engine: AgentEngine;
  /** Antigravity model ("" = Antigravity's own default). */
  model: string;
  /** MiniMax model, used when engine is MiniMax. */
  minimaxModel: string;
  /** MiniMax API settings; an absent field = MiniMax's own default. */
  minimax: MinimaxSettings;
  speed: AgentSpeed;
  timeLimit: number;
  retries: number;
  siteMap: boolean;
}

/** The MiniMax engine as the panel knows it: set up or not, and its models. */
export interface MinimaxInfo {
  available: boolean;
  reason: string | null;
  models: { id: string; note: string | null; maxOutputTokens: number; recommendedOutputTokens: number }[];
}

/** Before the server has said anything: the registry's models, not yet confirmed usable. */
export const MINIMAX_UNKNOWN: MinimaxInfo = { available: false, reason: null, models: minimaxModels() };

const labelCls = "mb-1 block text-xs font-medium text-text-muted";
const fieldCls =
  "w-full rounded-md border border-border bg-surface px-3 py-2 text-sm text-text outline-none focus:ring-2 focus:ring-accent";
const smallFieldCls =
  "rounded-md border border-border bg-surface px-2 py-1.5 text-xs text-text outline-none focus:ring-2 focus:ring-accent";

const known = (id: string | null | undefined, models: AgyModel[]) => (id && models.some((m) => m.id === id) ? id : "");

/** The send dialog's starting point: the team defaults. */
export function controlsFromDefaults(defaults: AgentDefaults, models: AgyModel[]): ControlsValue {
  const speed = defaults.speed ?? BUILT_IN_DEFAULTS.speed;
  return {
    engine: defaults.engine ?? "antigravity",
    model: known(defaults.model, models),
    minimaxModel: isMinimaxModel(defaults.minimax_model) ? defaults.minimax_model : DEFAULT_MINIMAX_MODEL,
    minimax: { ...(defaults.minimax ?? {}) },
    speed,
    timeLimit: defaults.time_limit_min ?? AGENT_SPEEDS[speed].minutes,
    retries: defaults.retries ?? BUILT_IN_DEFAULTS.retries,
    siteMap: defaults.site_map ?? BUILT_IN_DEFAULTS.site_map,
  };
}

/** A run's own controls (Try again, Request changes), over the team defaults. */
export function controlsFromRun(
  run: { model?: string | null; options?: unknown },
  defaults: AgentDefaults,
  models: AgyModel[],
): ControlsValue {
  const base = controlsFromDefaults(defaults, models);
  const o = readRunOptions(run.options);
  const engine = runEngine(run.options);
  return {
    engine,
    // A withdrawn model can't be offered again; the team default stands in.
    model: engine === "minimax" ? base.model : run.model ? known(run.model, models) || base.model : "",
    minimaxModel: engine === "minimax" && isMinimaxModel(run.model) ? run.model : base.minimaxModel,
    minimax: engine === "minimax" ? { ...(o.minimax ?? {}) } : base.minimax,
    speed: o.speed ?? base.speed,
    timeLimit: o.time_limit_min ?? base.timeLimit,
    retries: o.retries ?? base.retries,
    siteMap: o.site_map ?? base.siteMap,
  };
}

/** The request body fields: an explicit model (null = Antigravity's default)
 *  and the options, as the create/revise routes take them. */
export function controlsToBody(v: ControlsValue) {
  return {
    model: v.engine === "minimax" ? v.minimaxModel : v.model || null,
    options: {
      speed: v.speed, time_limit_min: v.timeLimit, retries: v.retries, site_map: v.siteMap, engine: v.engine,
      ...(v.engine === "minimax" ? { minimax: v.minimax } : {}),
    },
  };
}

const sameMinimax = (a: MinimaxSettings, b: MinimaxSettings) =>
  JSON.stringify(Object.entries(a).filter(([, x]) => x !== undefined).sort()) ===
  JSON.stringify(Object.entries(b).filter(([, x]) => x !== undefined).sort());

/**
 * Only what the sender changed from `start` (the team defaults for a new run,
 * the run's own controls for a follow-up). The routes fill in the rest the
 * same way the dialog did, so an untouched dialog sends nothing extra.
 */
export function changedControls(v: ControlsValue, start: ControlsValue): { model?: string | null; options?: Record<string, unknown> } {
  const out: { model?: string | null; options?: Record<string, unknown> } = {};
  const options: Record<string, unknown> = {};
  if (v.engine !== start.engine) {
    // A switched engine names its model outright: the other engine's default
    // means nothing to it.
    options.engine = v.engine;
    out.model = v.engine === "minimax" ? v.minimaxModel : v.model || null;
  } else if (v.engine === "minimax" ? v.minimaxModel !== start.minimaxModel : v.model !== start.model) {
    out.model = v.engine === "minimax" ? v.minimaxModel : v.model || null;
  }
  if (v.engine === "minimax" && (v.engine !== start.engine || !sameMinimax(v.minimax, start.minimax))) {
    options.engine = "minimax";
    options.minimax = v.minimax;
  }
  if (v.speed !== start.speed) options.speed = v.speed;
  if (v.timeLimit !== start.timeLimit || v.speed !== start.speed) options.time_limit_min = v.timeLimit;
  if (v.retries !== start.retries) options.retries = v.retries;
  if (v.siteMap !== start.siteMap) options.site_map = v.siteMap;
  if (Object.keys(options).length) out.options = options;
  return out;
}

function typical(stat: AgentModelStat | undefined): string | null {
  if (!stat || stat.rounds < 1) return null;
  return stat.medianMin < 1 ? "under 1 min" : `~${Math.round(stat.medianMin)} min`;
}

const statFor = (stats: AgentModelStat[], model: string) => stats.find((s) => (s.model ?? "") === model);

/** "Gemini 3.8 Flash (High)" → family "Gemini 3.8 Flash" — for grouping. */
function familyOf(label: string): string {
  return label.replace(/\s*\((?:low|medium|high|minimal|max)\)\s*$/i, "").trim() || label;
}

export function ModelSelect({
  id, value, onChange, models, stats, teamDefault, className,
}: {
  id: string;
  value: string;
  onChange: (model: string) => void;
  models: AgyModel[];
  stats: AgentModelStat[];
  /** The team's default model, marked in the list (unset: nothing marked). */
  teamDefault?: string | null;
  className?: string;
}) {
  const families: { name: string; models: AgyModel[] }[] = [];
  for (const m of models) {
    const name = familyOf(m.label);
    const f = families.find((x) => x.name === name);
    if (f) f.models.push(m);
    else families.push({ name, models: [m] });
  }
  const option = (m: AgyModel) => {
    const t = typical(statFor(stats, m.id));
    return (
      <option key={m.id} value={m.id}>
        {m.label}
        {m.id === teamDefault ? " — team default" : ""}
        {t ? ` · ${t}` : ""}
      </option>
    );
  };
  const agyTypical = typical(statFor(stats, ""));
  return (
    <select id={id} data-testid={id} className={className ?? fieldCls} value={value} onChange={(e) => onChange(e.target.value)}>
      <option value="">
        Antigravity default
        {agyTypical ? ` · ${agyTypical}` : ""}
      </option>
      {families.map((f) =>
        f.models.length > 1 ? (
          <optgroup key={f.name} label={f.name}>
            {f.models.map(option)}
          </optgroup>
        ) : (
          option(f.models[0])
        ),
      )}
    </select>
  );
}

/** Quick / Balanced / Thorough, as a radio group. */
export function SpeedPicker({ value, onChange, name }: { value: AgentSpeed; onChange: (s: AgentSpeed) => void; name: string }) {
  return (
    <div role="radiogroup" aria-label="Speed" className="grid grid-cols-3 gap-1 rounded-lg border border-border bg-surface-2 p-1">
      {AGENT_SPEED_ORDER.map((s) => (
        <label
          key={s}
          className={cn(
            "flex cursor-pointer items-center justify-center rounded-md px-2 py-1.5 text-xs font-medium transition-colors",
            value === s ? "bg-surface text-text shadow-sm" : "text-text-muted hover:text-text",
          )}
        >
          <input
            type="radio"
            name={name}
            value={s}
            data-testid={`${name}-${s}`}
            checked={value === s}
            onChange={() => onChange(s)}
            className="sr-only"
          />
          {AGENT_SPEEDS[s].label}
        </label>
      ))}
    </div>
  );
}

function TimeLimitSelect({ id, value, onChange, className }: { id: string; value: number; onChange: (n: number) => void; className?: string }) {
  const choices: number[] = TIME_LIMIT_CHOICES.includes(value as (typeof TIME_LIMIT_CHOICES)[number])
    ? [...TIME_LIMIT_CHOICES]
    : [...TIME_LIMIT_CHOICES, value].sort((a, b) => a - b);
  return (
    <select id={id} data-testid={id} className={className ?? fieldCls} value={value} onChange={(e) => onChange(Number(e.target.value))}>
      {choices.map((n) => (
        <option key={n} value={n}>
          {n} minutes
        </option>
      ))}
    </select>
  );
}

function RetriesSelect({ id, value, onChange, className }: { id: string; value: number; onChange: (n: number) => void; className?: string }) {
  return (
    <select id={id} data-testid={id} className={className ?? fieldCls} value={value} onChange={(e) => onChange(Number(e.target.value))}>
      <option value={0}>Don&rsquo;t retry</option>
      {Array.from({ length: MAX_RETRIES }, (_, i) => i + 1).map((n) => (
        <option key={n} value={n}>
          Retry up to {n} time{n === 1 ? "" : "s"}
        </option>
      ))}
    </select>
  );
}

/** Antigravity / MiniMax, as a radio group. MiniMax is offered only once its
 *  API key is set up; the hint under it says why when it is not. */
export function EnginePicker({
  value, onChange, name, minimax,
}: {
  value: AgentEngine;
  onChange: (e: AgentEngine) => void;
  name: string;
  minimax: MinimaxInfo;
}) {
  return (
    <div role="radiogroup" aria-label="AI engine" className="grid grid-cols-2 gap-1 rounded-lg border border-border bg-surface-2 p-1">
      {AGENT_ENGINE_ORDER.map((e) => {
        const off = e === "minimax" && !minimax.available && value !== "minimax";
        return (
          <label
            key={e}
            title={off ? minimax.reason ?? "MiniMax isn't set up" : AGENT_ENGINES[e].hint}
            className={cn(
              "flex items-center justify-center rounded-md px-2 py-1.5 text-xs font-medium transition-colors",
              off ? "cursor-not-allowed opacity-50" : "cursor-pointer",
              value === e ? "bg-surface text-text shadow-sm" : "text-text-muted hover:text-text",
            )}
          >
            <input
              type="radio"
              name={name}
              value={e}
              data-testid={`${name}-${e}`}
              checked={value === e}
              disabled={off}
              onChange={() => onChange(e)}
              className="sr-only"
            />
            {AGENT_ENGINES[e].label}
          </label>
        );
      })}
    </div>
  );
}

export function MinimaxModelSelect({
  id, value, onChange, minimax, stats, teamDefault, className,
}: {
  id: string;
  value: string;
  onChange: (model: string) => void;
  minimax: MinimaxInfo;
  stats: AgentModelStat[];
  teamDefault?: string | null;
  className?: string;
}) {
  return (
    <select id={id} data-testid={id} className={className ?? fieldCls} value={value} onChange={(e) => onChange(e.target.value)}>
      {minimax.models.map((m) => {
        const t = typical(statFor(stats, m.id));
        return (
          <option key={m.id} value={m.id}>
            {m.id.replace(/^MiniMax-/, "MiniMax ")}
            {m.id === teamDefault ? " — team default" : ""}
            {t ? ` · ${t}` : ""}
          </option>
        );
      })}
    </select>
  );
}

const isM31 = (model: string) => /^MiniMax-M3\.1/i.test(model);

/** A number box whose empty state means "MiniMax's own default". */
function NumberField({
  id, label, value, onChange, min, max, step, placeholder, help,
}: {
  id: string;
  label: string;
  value: number | undefined;
  onChange: (n: number | undefined) => void;
  min: number;
  max: number;
  step: number;
  placeholder: string;
  help?: string;
}) {
  const [draft, setDraft] = useState(value === undefined ? "" : String(value));
  // An outside change (another control, a reset) replaces the draft.
  const [seen, setSeen] = useState(value);
  if (seen !== value) {
    setSeen(value);
    setDraft(value === undefined ? "" : String(value));
  }
  return (
    <div>
      <label htmlFor={id} className={labelCls}>
        {label}
      </label>
      <input
        id={id}
        data-testid={id}
        type="number"
        inputMode="decimal"
        min={min}
        max={max}
        step={step}
        value={draft}
        placeholder={placeholder}
        className={fieldCls}
        onChange={(e) => {
          setDraft(e.target.value);
          const raw = e.target.value.trim();
          if (raw === "") return onChange(undefined);
          const n = Number(raw);
          if (Number.isFinite(n) && n >= min && n <= max) onChange(step >= 1 ? Math.round(n) : n);
        }}
        onBlur={() => setDraft(value === undefined ? "" : String(value))}
      />
      {help ? <p className="mt-1 text-[11px] text-text-faint">{help}</p> : null}
    </div>
  );
}

/**
 * Every MiniMax API setting the AI developer can send
 * (platform.minimax.io/docs/api-reference/text-chat-openai): thinking,
 * reasoning effort (M3.1), temperature, top-p, output per step, service tier,
 * plus the agent's step budget. Empty fields use MiniMax's own defaults.
 */
export function MinimaxSettingsFields({
  prefix, model, speed, value, onChange,
}: {
  prefix: string;
  model: string;
  speed: AgentSpeed;
  value: MinimaxSettings;
  onChange: (v: MinimaxSettings) => void;
}) {
  const info = minimaxModels().find((m) => m.id === model);
  const ceiling = info?.maxOutputTokens ?? 204800;
  const set = <K extends keyof MinimaxSettings>(k: K, v: MinimaxSettings[K]) => {
    const next = { ...value };
    if (v === undefined) delete next[k];
    else next[k] = v;
    onChange(next);
  };
  const m31 = isM31(model);
  return (
    <div className="grid gap-3 sm:grid-cols-2">
      <div>
        <label htmlFor={`${prefix}-mm-thinking`} className={labelCls}>
          Thinking
        </label>
        <select
          id={`${prefix}-mm-thinking`}
          data-testid={`${prefix}-mm-thinking`}
          className={fieldCls}
          value={value.thinking ?? ""}
          onChange={(e) => set("thinking", (e.target.value || undefined) as MinimaxSettings["thinking"])}
        >
          <option value="">Adaptive (MiniMax default)</option>
          <option value="adaptive">Adaptive — MiniMax decides how long to think</option>
          {!m31 ? <option value="disabled">Off — answer straight away (faster)</option> : null}
        </select>
        <p className="mt-1 text-[11px] text-text-faint">
          {m31 ? "M3.1 always thinks; tune it with reasoning effort." : "Off is honoured by M3; M2.x models think regardless."}
        </p>
      </div>
      {m31 ? (
        <div>
          <label htmlFor={`${prefix}-mm-effort`} className={labelCls}>
            Reasoning effort
          </label>
          <select
            id={`${prefix}-mm-effort`}
            data-testid={`${prefix}-mm-effort`}
            className={fieldCls}
            value={value.reasoning_effort ?? ""}
            onChange={(e) => set("reasoning_effort", (e.target.value || undefined) as MinimaxEffort | undefined)}
          >
            <option value="">Max (MiniMax default)</option>
            {MINIMAX_EFFORTS.map((x) => (
              <option key={x} value={x}>
                {x === "xhigh" ? "Extra high" : x[0].toUpperCase() + x.slice(1)}
              </option>
            ))}
          </select>
          <p className="mt-1 text-[11px] text-text-faint">Lower finishes faster; higher is more careful.</p>
        </div>
      ) : null}
      <div>
        <label htmlFor={`${prefix}-mm-tier`} className={labelCls}>
          Service tier
        </label>
        <select
          id={`${prefix}-mm-tier`}
          data-testid={`${prefix}-mm-tier`}
          className={fieldCls}
          value={value.service_tier ?? ""}
          onChange={(e) => set("service_tier", (e.target.value || undefined) as MinimaxSettings["service_tier"])}
        >
          <option value="">Standard (MiniMax default)</option>
          <option value="priority">Priority — served first when MiniMax is busy, 1.5× the price</option>
        </select>
      </div>
      <NumberField
        id={`${prefix}-mm-temperature`}
        label="Temperature"
        value={value.temperature}
        onChange={(n) => set("temperature", n)}
        min={MINIMAX_LIMITS.temperature.min}
        max={MINIMAX_LIMITS.temperature.max}
        step={MINIMAX_LIMITS.temperature.step}
        placeholder={`${MINIMAX_LIMITS.temperature.vendorDefault} (MiniMax default)`}
        help="0–2. Lower is more literal and predictable; higher is more varied."
      />
      <NumberField
        id={`${prefix}-mm-top-p`}
        label="Top-p"
        value={value.top_p}
        onChange={(n) => set("top_p", n)}
        min={MINIMAX_LIMITS.top_p.min}
        max={MINIMAX_LIMITS.top_p.max}
        step={MINIMAX_LIMITS.top_p.step}
        placeholder={`${MINIMAX_LIMITS.top_p.vendorDefault} (MiniMax default)`}
        help="0–1. Narrows word choice to the most likely options."
      />
      <NumberField
        id={`${prefix}-mm-max-tokens`}
        label="Max output per step (tokens)"
        value={value.max_tokens}
        onChange={(n) => set("max_tokens", n)}
        min={MINIMAX_LIMITS.max_tokens.min}
        max={ceiling}
        step={1}
        placeholder={String(Math.min(MINIMAX_DEFAULT_MAX_TOKENS, info?.recommendedOutputTokens ?? MINIMAX_DEFAULT_MAX_TOKENS))}
        help={`Thinking plus the step's answer. Up to ${ceiling.toLocaleString()} on this model; raise it if big pages get cut off.`}
      />
      <NumberField
        id={`${prefix}-mm-steps`}
        label="Max steps"
        value={value.max_steps}
        onChange={(n) => set("max_steps", n)}
        min={MINIMAX_LIMITS.max_steps.min}
        max={MINIMAX_LIMITS.max_steps.max}
        step={1}
        placeholder={`${defaultMinimaxSteps(speed)} (from the speed)`}
        help="Most calls to MiniMax in one round — each reads, searches or edits."
      />
    </div>
  );
}

/** "temp 0.7 · top-p 0.9 · priority" — what the MiniMax settings change from MiniMax's defaults. */
export function summarizeMinimax(v: MinimaxSettings): string {
  const parts: string[] = [];
  if (v.thinking === "disabled") parts.push("thinking off");
  if (v.reasoning_effort) parts.push(`${v.reasoning_effort} effort`);
  if (v.temperature !== undefined) parts.push(`temp ${v.temperature}`);
  if (v.top_p !== undefined) parts.push(`top-p ${v.top_p}`);
  if (v.max_tokens !== undefined) parts.push(`${v.max_tokens.toLocaleString()} tokens/step`);
  if (v.max_steps !== undefined) parts.push(`${v.max_steps} steps`);
  if (v.service_tier === "priority") parts.push("priority");
  return parts.length ? parts.join(" · ") : "MiniMax defaults";
}

/**
 * The full set of controls. `prefix` keeps ids unique when two sets are on
 * screen (send dialog vs. settings). Changing the speed also moves the time
 * limit to that speed's own, until the limit is picked by hand.
 */
export function RunControls({
  prefix, value, onChange, models, stats, teamDefault, minimax = MINIMAX_UNKNOWN, teamMinimaxDefault, minimaxOpen,
}: {
  prefix: string;
  value: ControlsValue;
  onChange: (v: ControlsValue) => void;
  models: AgyModel[];
  stats: AgentModelStat[];
  teamDefault?: string | null;
  /** The MiniMax engine's status and models (from the panel's list response). */
  minimax?: MinimaxInfo;
  teamMinimaxDefault?: string | null;
  /** Show the MiniMax API settings expanded (the team settings dialog). */
  minimaxOpen?: boolean;
}) {
  const [limitTouched, setLimitTouched] = useState(false);
  const mm = value.engine === "minimax";
  const stat = statFor(stats, mm ? value.minimaxModel : value.model);
  const minimaxNote = minimax.models.find((m) => m.id === value.minimaxModel)?.note;
  return (
    <div className="space-y-4">
      <div>
        <span className={labelCls}>AI engine</span>
        <EnginePicker name={`${prefix}-engine`} value={value.engine} onChange={(engine) => onChange({ ...value, engine })} minimax={minimax} />
        <p className="mt-1 text-xs text-text-faint" data-testid={`${prefix}-engine-hint`}>
          {AGENT_ENGINES[value.engine].hint}
          {!minimax.available && minimax.reason ? ` MiniMax isn't available: ${minimax.reason}.` : ""}
        </p>
      </div>

      <div>
        <label htmlFor={`${prefix}-model`} className={labelCls}>
          Model
        </label>
        {mm ? (
          <MinimaxModelSelect
            id={`${prefix}-model`}
            value={value.minimaxModel}
            onChange={(minimaxModel) => onChange({ ...value, minimaxModel })}
            minimax={minimax}
            stats={stats}
            teamDefault={teamMinimaxDefault}
          />
        ) : (
          <ModelSelect
            id={`${prefix}-model`}
            value={value.model}
            onChange={(model) => onChange({ ...value, model })}
            models={models}
            stats={stats}
            teamDefault={teamDefault}
          />
        )}
        <p className="mt-1 text-xs text-text-faint">
          {mm
            ? minimaxNote ?? ""
            : models.length === 0
              ? "Model list appears once the worker publishes it."
              : "Low thinks least and finishes fastest; High is the most careful and the slowest."}
          {stat && stat.rounds > 0
            ? ` Typical round on this model: ${typical(stat)} (${stat.rounds} in the last 30 days${stat.failed ? `, ${stat.failed} failed` : ""}).`
            : ""}
        </p>
      </div>

      {mm ? (
        <details className="rounded-md border border-border px-3 py-2" open={minimaxOpen} data-testid={`${prefix}-mm-settings`}>
          <summary className="cursor-pointer text-xs font-medium text-text-muted hover:text-text">
            MiniMax settings: <span className="font-normal text-text">{summarizeMinimax(value.minimax)}</span>
          </summary>
          <div className="mt-3">
            <MinimaxSettingsFields
              prefix={prefix}
              model={value.minimaxModel}
              speed={value.speed}
              value={value.minimax}
              onChange={(m) => onChange({ ...value, minimax: m })}
            />
          </div>
        </details>
      ) : null}

      <div>
        <span className={labelCls}>Speed</span>
        <SpeedPicker
          name={`${prefix}-speed`}
          value={value.speed}
          onChange={(speed) =>
            onChange({ ...value, speed, timeLimit: limitTouched ? value.timeLimit : AGENT_SPEEDS[speed].minutes })
          }
        />
        <p className="mt-1 text-xs text-text-faint">
          {AGENT_SPEEDS[value.speed].hint} The AI aims for about {AGENT_SPEEDS[value.speed].steps} steps.
        </p>
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <div>
          <label htmlFor={`${prefix}-limit`} className={labelCls}>
            Time limit
          </label>
          <TimeLimitSelect
            id={`${prefix}-limit`}
            value={value.timeLimit}
            onChange={(timeLimit) => {
              setLimitTouched(true);
              onChange({ ...value, timeLimit });
            }}
          />
        </div>
        <div>
          <label htmlFor={`${prefix}-retries`} className={labelCls}>
            If the AI service drops
          </label>
          <RetriesSelect id={`${prefix}-retries`} value={value.retries} onChange={(retries) => onChange({ ...value, retries })} />
        </div>
      </div>

      <label className="flex cursor-pointer items-start gap-2.5 text-sm text-text">
        <input
          type="checkbox"
          data-testid={`${prefix}-sitemap`}
          className="accent-accent mt-0.5 h-4 w-4 shrink-0"
          checked={value.siteMap}
          onChange={(e) => onChange({ ...value, siteMap: e.target.checked })}
        />
        <span>
          Give the AI a map of the site
          <span className="block text-xs text-text-faint">
            Files, each page&rsquo;s sections and the colour variables, so it goes straight to the change instead of
            searching. Leave on unless a run gets confused.
          </span>
        </span>
      </label>
    </div>
  );
}

/** One line for a <details> summary: "Gemini 3.8 Flash (Low) · Quick · 8 min". */
export function summarizeControls(v: ControlsValue, models: AgyModel[]): string {
  const model =
    v.engine === "minimax"
      ? `MiniMax ${v.minimaxModel.replace(/^MiniMax-/, "")}`
      : v.model
        ? models.find((m) => m.id === v.model)?.label ?? v.model
        : "Antigravity default";
  return `${model} · ${AGENT_SPEEDS[v.speed].label} · ${v.timeLimit} min`;
}

/** The compact controls under "Request changes". */
export function FollowUpControls({
  value, onChange, models, stats, teamDefault, minimax = MINIMAX_UNKNOWN, runEngine: fromEngine = "antigravity",
}: {
  value: ControlsValue;
  onChange: (v: ControlsValue) => void;
  models: AgyModel[];
  stats: AgentModelStat[];
  teamDefault?: string | null;
  minimax?: MinimaxInfo;
  /** The engine that made the edits under review. MiniMax's edits stay with
   *  MiniMax (the revise route refuses a switch back). */
  runEngine?: AgentEngine;
}) {
  // The selects mount only while open: the review pane's own page select
  // stays the one combobox on screen until someone asks for these.
  const [open, setOpen] = useState(false);
  return (
    <details
      className="mt-2 rounded-md border border-border px-2.5 py-1.5"
      data-testid="sa-followup-options"
      open={open}
      onToggle={(e) => setOpen((e.currentTarget as HTMLDetailsElement).open)}
    >
      <summary className="cursor-pointer text-xs text-text-muted hover:text-text">
        Options for this follow-up: <span className="text-text">{summarizeControls(value, models)}</span>
      </summary>
      {open ? (
        <div className="mt-2 flex flex-wrap items-end gap-2">
          {fromEngine === "antigravity" ? (
            <div>
              <label htmlFor="sa-followup-engine" className={labelCls}>
                Engine
              </label>
              <select
                id="sa-followup-engine"
                data-testid="sa-followup-engine"
                className={smallFieldCls}
                value={value.engine}
                onChange={(e) => onChange({ ...value, engine: e.target.value as AgentEngine })}
              >
                <option value="antigravity">Antigravity</option>
                <option value="minimax" disabled={!minimax.available}>
                  MiniMax{minimax.available ? "" : " (not set up)"}
                </option>
              </select>
            </div>
          ) : null}
          <div>
            <label htmlFor="sa-followup-model" className={labelCls}>
              Model
            </label>
            {value.engine === "minimax" ? (
              <MinimaxModelSelect
                id="sa-followup-model"
                value={value.minimaxModel}
                onChange={(minimaxModel) => onChange({ ...value, minimaxModel })}
                minimax={minimax}
                stats={stats}
                className={smallFieldCls}
              />
            ) : (
              <ModelSelect
                id="sa-followup-model"
                value={value.model}
                onChange={(model) => onChange({ ...value, model })}
                models={models}
                stats={stats}
                teamDefault={teamDefault}
                className={smallFieldCls}
              />
            )}
          </div>
          <div>
            <label htmlFor="sa-followup-speed" className={labelCls}>
              Speed
            </label>
            <select
              id="sa-followup-speed"
              data-testid="sa-followup-speed"
              className={smallFieldCls}
              value={value.speed}
              onChange={(e) => {
                const speed = e.target.value as AgentSpeed;
                onChange({ ...value, speed, timeLimit: AGENT_SPEEDS[speed].minutes });
              }}
            >
              {AGENT_SPEED_ORDER.map((s) => (
                <option key={s} value={s}>
                  {AGENT_SPEEDS[s].label}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label htmlFor="sa-followup-limit" className={labelCls}>
              Time limit
            </label>
            <TimeLimitSelect
              id="sa-followup-limit"
              value={value.timeLimit}
              onChange={(timeLimit) => onChange({ ...value, timeLimit })}
              className={smallFieldCls}
            />
          </div>
        </div>
      ) : null}
    </details>
  );
}

interface SettingsPayload {
  defaults: AgentDefaults;
  models: AgyModel[];
  stats: AgentModelStat[];
  settingsAvailable: boolean;
  canConfigure: boolean;
  minimax?: MinimaxInfo;
}

/**
 * Team settings: the defaults every send starts from, the standing rules
 * added to every run, and how long each model has really been taking.
 */
export function AgentSettingsDialog({ onClose, onSaved }: { onClose: () => void; onSaved: (d: AgentDefaults) => void }) {
  const { toast } = useToast();
  const [data, setData] = useState<SettingsPayload | null>(null);
  const [value, setValue] = useState<ControlsValue | null>(null);
  const [rules, setRules] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch("/api/site-agent/settings");
        const body = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(body.error ?? "Could not load the AI developer settings");
        if (cancelled) return;
        const payload = body as SettingsPayload;
        setData(payload);
        setValue(controlsFromDefaults(payload.defaults ?? {}, payload.models ?? []));
        setRules(payload.defaults?.house_rules ?? "");
      } catch (e) {
        if (!cancelled) {
          toast({ kind: "error", title: e instanceof Error ? e.message : "Could not load the AI developer settings" });
          onClose();
        }
      }
    })();
    return () => { cancelled = true; };
  }, [toast, onClose]);

  async function save() {
    if (!value) return;
    setSaving(true);
    try {
      const res = await fetch("/api/site-agent/settings", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          model: value.model || null,
          speed: value.speed,
          time_limit_min: value.timeLimit,
          retries: value.retries,
          site_map: value.siteMap,
          engine: value.engine,
          minimax_model: value.minimaxModel,
          minimax: value.minimax,
          house_rules: rules,
        }),
      });
      const out = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast({ kind: "error", title: out.error ?? "Could not save the settings" });
        return;
      }
      toast({ kind: "success", title: "AI developer defaults saved" });
      onSaved(out.defaults as AgentDefaults);
      onClose();
    } catch (e) {
      toast({ kind: "error", title: e instanceof Error ? e.message : "Could not save the settings" });
    } finally {
      setSaving(false);
    }
  }

  const label = (id: string | null) =>
    id ? data?.models.find((m) => m.id === id)?.label ?? id.replace(/^MiniMax-/, "MiniMax ") : "Antigravity default";

  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-black/40 p-4" role="dialog" aria-modal="true" aria-label="AI developer settings">
      <div className="max-h-[90vh] w-full max-w-xl overflow-y-auto rounded-lg border border-border bg-surface p-5 shadow-lg">
        <div className="flex items-start gap-2">
          <div className="min-w-0 flex-1">
            <h3 className="flex items-center gap-1.5 text-sm font-semibold text-text">
              <Settings2 className="h-4 w-4 text-accent-ink" /> AI developer settings
            </h3>
            <p className="mt-1 text-sm text-text-muted">
              Every &ldquo;Send to AI&rdquo; and &ldquo;AI edit site&rdquo; starts from these. Anyone sending work can
              still change them for that run.
            </p>
          </div>
          <button type="button" className={iconBtn} onClick={onClose} aria-label="Close" title="Close">
            <X className="h-4 w-4" />
          </button>
        </div>

        {!data || !value ? (
          <p className="mt-6 flex items-center gap-2 text-sm text-text-muted">
            <Loader2 className="h-4 w-4 animate-spin" /> Loading…
          </p>
        ) : (
          <>
            {!data.settingsAvailable ? (
              <p className="mt-4 rounded-md border border-notready-bg bg-notready-bg/40 px-2.5 py-1.5 text-xs text-notready-fg">
                Saving needs database update 0086 (AI developer settings). Until it is applied, runs use the built-in
                defaults below.
              </p>
            ) : null}
            {!data.canConfigure ? (
              <p className="mt-4 text-xs text-text-faint">Only operators and admins can change these.</p>
            ) : null}

            <fieldset disabled={!data.canConfigure} className="mt-4 space-y-4">
              <RunControls
                prefix="sa-settings"
                value={value}
                onChange={setValue}
                models={data.models}
                stats={data.stats}
                minimax={data.minimax ?? MINIMAX_UNKNOWN}
                minimaxOpen
              />
              <p className="-mt-2 text-xs text-text-faint">
                The engine and model picked here are where every send starts. MiniMax settings are kept even while
                Antigravity is the default, ready for whenever someone switches.
              </p>
              <div>
                <label htmlFor="sa-settings-rules" className={labelCls}>
                  Team rules — added to every run
                </label>
                <textarea
                  id="sa-settings-rules"
                  data-testid="sa-settings-rules"
                  rows={4}
                  maxLength={HOUSE_RULES_MAX}
                  className={fieldCls}
                  value={rules}
                  onChange={(e) => setRules(e.target.value)}
                  placeholder={"e.g. Never change phone numbers, prices or the logo unless the ticket asks.\nKeep every page mobile-friendly."}
                />
                <p className="mt-1 text-xs text-text-faint">
                  {rules.length}/{HOUSE_RULES_MAX} — the AI follows these unless a ticket explicitly asks otherwise.
                </p>
              </div>
            </fieldset>

            <div className="mt-5">
              <h4 className="text-xs font-medium text-text-muted">How long each model takes (last 30 days)</h4>
              {data.stats.length ? (
                <table className="mt-1.5 w-full text-left text-xs" data-testid="sa-settings-stats">
                  <thead className="text-text-faint">
                    <tr>
                      <th className="py-1 font-medium">Model</th>
                      <th className="py-1 font-medium">Rounds</th>
                      <th className="py-1 font-medium">Typical time</th>
                      <th className="py-1 font-medium">Failed</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.stats.map((s) => (
                      <tr key={s.model ?? "default"} className="border-t border-border text-text">
                        <td className="py-1 pr-2">{label(s.model)}</td>
                        <td className="py-1 pr-2">{s.rounds}</td>
                        <td className="py-1 pr-2">{typical(s)}</td>
                        <td className="py-1">{s.failed}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              ) : (
                <p className="mt-1 text-xs text-text-faint">No finished runs in the last 30 days yet.</p>
              )}
              <p className="mt-1 text-[11px] text-text-faint">
                A round is one send or one &ldquo;Request changes&rdquo;, from the click to the result, queue included.
              </p>
            </div>

            <div className="mt-5 flex justify-end gap-2">
              <button
                type="button"
                onClick={onClose}
                className="rounded-md border border-border px-3 py-2 text-sm text-text-muted hover:text-text"
              >
                Cancel
              </button>
              {data.canConfigure ? (
                <button
                  type="button"
                  data-testid="sa-settings-save"
                  className={btnPrimary}
                  onClick={() => void save()}
                  disabled={saving || !data.settingsAvailable}
                >
                  {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
                  Save defaults
                </button>
              ) : null}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
