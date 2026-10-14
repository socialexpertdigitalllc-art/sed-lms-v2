"use client";

import { useEffect, useState } from "react";
import { Loader2, Settings2, X } from "lucide-react";
import { btnPrimary, iconBtn } from "@/components/common/buttons";
import { useToast } from "@/components/common/Toast";
import {
  AGENT_SPEED_ORDER,
  AGENT_SPEEDS,
  BUILT_IN_DEFAULTS,
  HOUSE_RULES_MAX,
  MAX_RETRIES,
  TIME_LIMIT_CHOICES,
  readRunOptions,
  type AgentDefaults,
  type AgentSpeed,
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
  model: string;
  speed: AgentSpeed;
  timeLimit: number;
  retries: number;
  siteMap: boolean;
}

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
    model: known(defaults.model, models),
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
  return {
    // A withdrawn model can't be offered again; the team default stands in.
    model: run.model ? known(run.model, models) || base.model : "",
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
    model: v.model || null,
    options: { speed: v.speed, time_limit_min: v.timeLimit, retries: v.retries, site_map: v.siteMap },
  };
}

/**
 * Only what the sender changed from `start` (the team defaults for a new run,
 * the run's own controls for a follow-up). The routes fill in the rest the
 * same way the dialog did, so an untouched dialog sends nothing extra.
 */
export function changedControls(v: ControlsValue, start: ControlsValue): { model?: string | null; options?: Record<string, unknown> } {
  const out: { model?: string | null; options?: Record<string, unknown> } = {};
  if (v.model !== start.model) out.model = v.model || null;
  const options: Record<string, unknown> = {};
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

/**
 * The full set of controls. `prefix` keeps ids unique when two sets are on
 * screen (send dialog vs. settings). Changing the speed also moves the time
 * limit to that speed's own, until the limit is picked by hand.
 */
export function RunControls({
  prefix, value, onChange, models, stats, teamDefault,
}: {
  prefix: string;
  value: ControlsValue;
  onChange: (v: ControlsValue) => void;
  models: AgyModel[];
  stats: AgentModelStat[];
  teamDefault?: string | null;
}) {
  const [limitTouched, setLimitTouched] = useState(false);
  const stat = statFor(stats, value.model);
  return (
    <div className="space-y-4">
      <div>
        <label htmlFor={`${prefix}-model`} className={labelCls}>
          Model
        </label>
        <ModelSelect
          id={`${prefix}-model`}
          value={value.model}
          onChange={(model) => onChange({ ...value, model })}
          models={models}
          stats={stats}
          teamDefault={teamDefault}
        />
        <p className="mt-1 text-xs text-text-faint">
          {models.length === 0
            ? "Model list appears once the worker publishes it."
            : "Low thinks least and finishes fastest; High is the most careful and the slowest."}
          {stat && stat.rounds > 0
            ? ` Typical round on this model: ${typical(stat)} (${stat.rounds} in the last 30 days${stat.failed ? `, ${stat.failed} failed` : ""}).`
            : ""}
        </p>
      </div>

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
  const model = v.model ? models.find((m) => m.id === v.model)?.label ?? v.model : "Antigravity default";
  return `${model} · ${AGENT_SPEEDS[v.speed].label} · ${v.timeLimit} min`;
}

/** The compact controls under "Request changes". */
export function FollowUpControls({
  value, onChange, models, stats, teamDefault,
}: {
  value: ControlsValue;
  onChange: (v: ControlsValue) => void;
  models: AgyModel[];
  stats: AgentModelStat[];
  teamDefault?: string | null;
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
          <div>
            <label htmlFor="sa-followup-model" className={labelCls}>
              Model
            </label>
            <ModelSelect
              id="sa-followup-model"
              value={value.model}
              onChange={(model) => onChange({ ...value, model })}
              models={models}
              stats={stats}
              teamDefault={teamDefault}
              className={smallFieldCls}
            />
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
      const body = controlsToBody(value);
      const res = await fetch("/api/site-agent/settings", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ model: body.model, ...body.options, house_rules: rules }),
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
    id ? data?.models.find((m) => m.id === id)?.label ?? id : "Antigravity default";

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
              />
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
