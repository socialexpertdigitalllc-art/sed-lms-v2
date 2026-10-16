// lib/site-agent/options.ts
/**
 * The AI developer's run controls, shared by the dashboard (send dialog,
 * "Request changes", team settings) and the worker. Everything here is
 * serialization-safe: run options ride `site_agent_runs.options` and team
 * defaults ride `app_settings.agent_defaults` (both jsonb, migration 0086).
 *
 * Why these exist (2026-10-14): Gemini 3.8 Flash replaced 3.7 and minor edits
 * went from 2–9 minutes to 10–17. The new model thinks about twice as long, and
 * the agent spent 40–80 slow tool calls exploring each site. Speed,
 * time limit, retries and the site map let the person sending the work trade
 * care for time per run; team defaults set the starting point for everyone.
 */
import { AGY_MAX_ATTEMPTS } from "./types";
import { getProvider } from "@/lib/ai-tools/providers/registry";

export type AgentSpeed = "quick" | "balanced" | "thorough";

export const AGENT_SPEEDS: Record<AgentSpeed, {
  label: string;
  hint: string;
  /** The tool-call budget the prompt asks the agent to stay within. */
  steps: number;
  /** The time limit a run gets when nobody picked one. */
  minutes: number;
}> = {
  quick: {
    label: "Quick",
    hint: "Small, targeted edits — text, colours, images, links. Goes straight to the change.",
    steps: 10,
    minutes: 8,
  },
  balanced: {
    label: "Balanced",
    hint: "Most requests — a section reworked, a few related edits.",
    steps: 25,
    minutes: 15,
  },
  thorough: {
    label: "Thorough",
    hint: "Big or site-wide changes — new sections, several pages, SEO passes.",
    steps: 60,
    minutes: 30,
  },
};

export const AGENT_SPEED_ORDER: AgentSpeed[] = ["quick", "balanced", "thorough"];

/** Time limits offered in the dashboard, in minutes. */
export const TIME_LIMIT_CHOICES = [5, 8, 10, 15, 20, 30, 45, 60] as const;
export const MIN_TIME_LIMIT_MIN = 3;
export const MAX_TIME_LIMIT_MIN = 60;
/** Extra tries after a dropped connection (agy's stream cuts and 503s). */
export const MAX_RETRIES = AGY_MAX_ATTEMPTS - 1;
export const HOUSE_RULES_MAX = 2000;

/* ------------------------------------------------------------- engines */

/**
 * Which AI does the work. Antigravity runs on the office worker box through the
 * `agy` CLI; MiniMax runs on the LMS server itself through MiniMax's API (the
 * same account the Site Builder uses), so it needs neither the worker nor any
 * Antigravity quota — the reason it exists (2026-10-16: Antigravity's limit ran
 * out under the workload and every edit stopped).
 */
export type AgentEngine = "antigravity" | "minimax";

export const AGENT_ENGINES: Record<AgentEngine, { label: string; hint: string }> = {
  antigravity: {
    label: "Antigravity",
    hint: "Google's agent, on the office worker machine. Needs the worker online and Antigravity quota.",
  },
  minimax: {
    label: "MiniMax",
    hint: "Runs on the LMS server with the MiniMax API key — no worker machine, no Antigravity quota.",
  },
};

export const AGENT_ENGINE_ORDER: AgentEngine[] = ["antigravity", "minimax"];

export function isAgentEngine(v: unknown): v is AgentEngine {
  return v === "antigravity" || v === "minimax";
}

/** The engine a stored run (or its options) uses; anything else is Antigravity
 *  — every run before MiniMax existed. */
export function runEngine(rawOptions: unknown): AgentEngine {
  const rec = rawOptions && typeof rawOptions === "object" && !Array.isArray(rawOptions) ? (rawOptions as Record<string, unknown>) : null;
  return rec?.engine === "minimax" ? "minimax" : "antigravity";
}

/** The MiniMax models the AI developer can use — the provider registry's list,
 *  every one of which calls tools (the agent edits files through tools). */
export function minimaxModels(): { id: string; note: string | null; maxOutputTokens: number; recommendedOutputTokens: number }[] {
  return (getProvider("minimax")?.models ?? [])
    .filter((m) => m.toolCalling)
    .map((m) => ({
      id: m.id,
      note: m.note ?? null,
      maxOutputTokens: m.maxOutputTokens,
      recommendedOutputTokens: m.recommendedOutputTokens ?? m.maxOutputTokens,
    }));
}

/** M3 is the strongest generally-available model and what the Site Builder runs on. */
export const DEFAULT_MINIMAX_MODEL = "MiniMax-M3";

export function isMinimaxModel(id: unknown): id is string {
  return typeof id === "string" && minimaxModels().some((m) => m.id === id);
}

/** MiniMax's `thinking.type`: adaptive (it decides) or disabled. */
export type MinimaxThinking = "adaptive" | "disabled";
/** MiniMax's `reasoning_effort` — honoured by M3.1 only. */
export type MinimaxEffort = "low" | "medium" | "high" | "xhigh" | "max";
export const MINIMAX_EFFORTS: MinimaxEffort[] = ["low", "medium", "high", "xhigh", "max"];
/** MiniMax's `service_tier`: priority admission costs 1.5x standard. */
export type MinimaxTier = "standard" | "priority";

/**
 * Every knob MiniMax's chat-completions API exposes for this kind of work
 * (platform.minimax.io/docs/api-reference/text-chat-openai, re-read
 * 2026-10-16), plus the agent's own step budget. Absent = the vendor default.
 */
export interface MinimaxSettings {
  /** 0–2; MiniMax default 1. Lower is more literal. */
  temperature?: number;
  /** 0–1; MiniMax default 0.95 (M3) / 0.9 (M2.x). */
  top_p?: number;
  /** `max_completion_tokens` per step — thinking + the step's answer. */
  max_tokens?: number;
  thinking?: MinimaxThinking;
  reasoning_effort?: MinimaxEffort;
  service_tier?: MinimaxTier;
  /** Most model calls (steps) one round may take; default from the speed. */
  max_steps?: number;
}

export const MINIMAX_LIMITS = {
  temperature: { min: 0, max: 2, step: 0.05, vendorDefault: 1 },
  top_p: { min: 0, max: 1, step: 0.01, vendorDefault: 0.95 },
  max_tokens: { min: 1024 },
  max_steps: { min: 3, max: 200 },
} as const;

/** What a MiniMax round gets when nobody picked a value: room for a whole
 *  large page in one write plus thinking, without asking M2.x for its entire
 *  shared input+output window. */
export const MINIMAX_DEFAULT_MAX_TOKENS = 32768;

/** Steps a round may take by default: the prompt's step budget for the speed,
 *  with headroom — MiniMax reads and edits in separate calls, and running out
 *  mid-change wastes the whole round. */
export function defaultMinimaxSteps(speed: AgentSpeed): number {
  return Math.min(MINIMAX_LIMITS.max_steps.max, AGENT_SPEEDS[speed].steps * 2 + 10);
}

function parseMinimax(raw: unknown): Parsed<MinimaxSettings> {
  if (raw === undefined || raw === null) return { ok: true, value: {} };
  const rec = asRecord(raw);
  if (!rec) return { ok: false, message: "minimax must be an object" };
  const out: MinimaxSettings = {};
  const num = (k: "temperature" | "top_p", lim: { min: number; max: number }, label: string): string | null => {
    const v = rec[k];
    if (v === undefined || v === null) return null;
    if (typeof v !== "number" || !Number.isFinite(v) || v < lim.min || v > lim.max) return `${label} must be ${lim.min}–${lim.max}.`;
    out[k] = Math.round(v * 100) / 100;
    return null;
  };
  const e1 = num("temperature", MINIMAX_LIMITS.temperature, "Temperature");
  if (e1) return { ok: false, message: e1 };
  const e2 = num("top_p", MINIMAX_LIMITS.top_p, "Top-p");
  if (e2) return { ok: false, message: e2 };
  if (rec.max_tokens !== undefined && rec.max_tokens !== null) {
    const v = rec.max_tokens;
    const ceiling = Math.max(...minimaxModels().map((m) => m.maxOutputTokens), MINIMAX_LIMITS.max_tokens.min);
    if (typeof v !== "number" || !Number.isInteger(v) || v < MINIMAX_LIMITS.max_tokens.min || v > ceiling) {
      return { ok: false, message: `Max output per step must be ${MINIMAX_LIMITS.max_tokens.min}–${ceiling} tokens.` };
    }
    out.max_tokens = v;
  }
  if (rec.thinking !== undefined && rec.thinking !== null) {
    if (rec.thinking !== "adaptive" && rec.thinking !== "disabled") return { ok: false, message: "thinking must be adaptive or disabled" };
    out.thinking = rec.thinking;
  }
  if (rec.reasoning_effort !== undefined && rec.reasoning_effort !== null) {
    if (!MINIMAX_EFFORTS.includes(rec.reasoning_effort as MinimaxEffort)) {
      return { ok: false, message: `reasoning_effort must be one of ${MINIMAX_EFFORTS.join(", ")}` };
    }
    out.reasoning_effort = rec.reasoning_effort as MinimaxEffort;
  }
  if (rec.service_tier !== undefined && rec.service_tier !== null) {
    if (rec.service_tier !== "standard" && rec.service_tier !== "priority") return { ok: false, message: "service_tier must be standard or priority" };
    out.service_tier = rec.service_tier;
  }
  if (rec.max_steps !== undefined && rec.max_steps !== null) {
    const v = rec.max_steps;
    if (typeof v !== "number" || !Number.isInteger(v) || v < MINIMAX_LIMITS.max_steps.min || v > MINIMAX_LIMITS.max_steps.max) {
      return { ok: false, message: `Max steps must be ${MINIMAX_LIMITS.max_steps.min}–${MINIMAX_LIMITS.max_steps.max}.` };
    }
    out.max_steps = v;
  }
  return { ok: true, value: out };
}

/** One run's controls. Absent fields fall back to the team defaults, then to
 *  the built-in ones below — a run created before 0086 has none at all. */
export interface AgentRunOptions {
  speed?: AgentSpeed;
  time_limit_min?: number;
  /** 0 = fail on the first dropped connection. */
  retries?: number;
  /** Give the agent a generated map of the site's files, sections and colours. */
  site_map?: boolean;
  /** The team's standing instructions as they were when the run was sent. */
  house_rules?: string;
  /** Absent = Antigravity (every run before MiniMax existed). */
  engine?: AgentEngine;
  /** MiniMax runs only: the API settings it was sent with. */
  minimax?: MinimaxSettings;
}

/** The team's defaults, edited in the AI developer settings. */
export interface AgentDefaults {
  /** agy model id; null/absent = Antigravity's own default. */
  model?: string | null;
  /** The engine a send starts on. */
  engine?: AgentEngine;
  /** The MiniMax model a MiniMax send starts on. */
  minimax_model?: string;
  minimax?: MinimaxSettings;
  speed?: AgentSpeed;
  time_limit_min?: number;
  retries?: number;
  site_map?: boolean;
  house_rules?: string;
}

/** Without any choice or team default: Balanced (15 minutes, the old fixed
 *  cap), every retry, and the site map. */
export const BUILT_IN_DEFAULTS: Required<Pick<AgentDefaults, "speed" | "retries" | "site_map">> = {
  speed: "balanced",
  retries: MAX_RETRIES,
  site_map: true,
};

export function isAgentSpeed(v: unknown): v is AgentSpeed {
  return v === "quick" || v === "balanced" || v === "thorough";
}

type Parsed<T> = { ok: true; value: T } | { ok: false; message: string };

/**
 * Validates the option fields both the run payloads and the team defaults
 * share. Unknown keys are dropped; a field that is present but wrong is an
 * error (a typo'd time limit must not silently become the default).
 */
function parseCommon(raw: Record<string, unknown>): Parsed<AgentRunOptions> {
  const out: AgentRunOptions = {};
  if (raw.speed !== undefined && raw.speed !== null) {
    if (!isAgentSpeed(raw.speed)) return { ok: false, message: "speed must be quick, balanced or thorough" };
    out.speed = raw.speed;
  }
  if (raw.time_limit_min !== undefined && raw.time_limit_min !== null) {
    const n = raw.time_limit_min;
    if (typeof n !== "number" || !Number.isInteger(n) || n < MIN_TIME_LIMIT_MIN || n > MAX_TIME_LIMIT_MIN) {
      return { ok: false, message: `The time limit must be ${MIN_TIME_LIMIT_MIN}–${MAX_TIME_LIMIT_MIN} minutes.` };
    }
    out.time_limit_min = n;
  }
  if (raw.retries !== undefined && raw.retries !== null) {
    const n = raw.retries;
    if (typeof n !== "number" || !Number.isInteger(n) || n < 0 || n > MAX_RETRIES) {
      return { ok: false, message: `Retries must be 0–${MAX_RETRIES}.` };
    }
    out.retries = n;
  }
  if (raw.site_map !== undefined && raw.site_map !== null) {
    if (typeof raw.site_map !== "boolean") return { ok: false, message: "site_map must be true or false" };
    out.site_map = raw.site_map;
  }
  if (raw.engine !== undefined && raw.engine !== null) {
    if (!isAgentEngine(raw.engine)) return { ok: false, message: "engine must be antigravity or minimax" };
    out.engine = raw.engine;
  }
  const mm = parseMinimax(raw.minimax);
  if (!mm.ok) return mm;
  if (Object.keys(mm.value).length) out.minimax = mm.value;
  return { ok: true, value: out };
}

const asRecord = (raw: unknown): Record<string, unknown> | null =>
  raw && typeof raw === "object" && !Array.isArray(raw) ? (raw as Record<string, unknown>) : null;

/** A request body's `options` (send dialog, Request changes). */
export function parseRunOptions(raw: unknown): Parsed<AgentRunOptions> {
  if (raw === undefined || raw === null) return { ok: true, value: {} };
  const rec = asRecord(raw);
  if (!rec) return { ok: false, message: "options must be an object" };
  return parseCommon(rec);
}

/** The settings dialog's body. `model` is validated against the worker's
 *  catalogue by the caller (resolveModelChoice), not here. */
export function parseDefaults(raw: unknown): Parsed<AgentDefaults> {
  const rec = asRecord(raw);
  if (!rec) return { ok: false, message: "Send the settings as an object." };
  const common = parseCommon(rec);
  if (!common.ok) return common;
  const out: AgentDefaults = { ...common.value };
  if (rec.house_rules !== undefined && rec.house_rules !== null) {
    if (typeof rec.house_rules !== "string") return { ok: false, message: "house_rules must be text" };
    const rules = rec.house_rules.trim();
    if (rules.length > HOUSE_RULES_MAX) {
      return { ok: false, message: `Team rules are too long (${HOUSE_RULES_MAX} characters max).` };
    }
    if (rules) out.house_rules = rules;
  }
  if (rec.minimax_model !== undefined && rec.minimax_model !== null && rec.minimax_model !== "") {
    if (!isMinimaxModel(rec.minimax_model)) return { ok: false, message: `Unknown MiniMax model "${String(rec.minimax_model)}".` };
    out.minimax_model = rec.minimax_model;
  }
  return { ok: true, value: out };
}

/** Stored jsonb, read defensively: anything malformed is ignored, never thrown. */
export function readDefaults(raw: unknown): AgentDefaults {
  const rec = asRecord(raw);
  if (!rec) return {};
  const parsed = parseDefaults(rec);
  const out: AgentDefaults = parsed.ok ? parsed.value : {};
  if (typeof rec.model === "string" && rec.model.trim()) out.model = rec.model.trim();
  return out;
}

export function readRunOptions(raw: unknown): AgentRunOptions {
  const rec = asRecord(raw);
  if (!rec) return {};
  const parsed = parseCommon(rec);
  const out: AgentRunOptions = parsed.ok ? parsed.value : {};
  if (typeof rec.house_rules === "string" && rec.house_rules.trim()) {
    out.house_rules = rec.house_rules.trim().slice(0, HOUSE_RULES_MAX);
  }
  return out;
}

/**
 * What a new run is sent with: the sender's choices over the team defaults
 * over the built-ins, written onto the run in full so the row says exactly
 * how it ran even if the team settings change later.
 */
export function composeRunOptions(choice: AgentRunOptions, defaults: AgentDefaults): AgentRunOptions {
  const speed = choice.speed ?? defaults.speed ?? BUILT_IN_DEFAULTS.speed;
  const out: AgentRunOptions = {
    speed,
    // A speed picked without a time limit brings its own; otherwise the team's.
    time_limit_min:
      choice.time_limit_min ??
      (choice.speed ? AGENT_SPEEDS[speed].minutes : defaults.time_limit_min ?? AGENT_SPEEDS[speed].minutes),
    retries: choice.retries ?? defaults.retries ?? BUILT_IN_DEFAULTS.retries,
    site_map: choice.site_map ?? defaults.site_map ?? BUILT_IN_DEFAULTS.site_map,
  };
  if (defaults.house_rules) out.house_rules = defaults.house_rules;
  const engine = choice.engine ?? defaults.engine ?? "antigravity";
  if (engine === "minimax") {
    out.engine = "minimax";
    // The sender's MiniMax settings over the team's, written in full.
    const minimax = { ...(defaults.minimax ?? {}), ...(choice.minimax ?? {}) };
    if (Object.keys(minimax).length) out.minimax = minimax;
  }
  return out;
}

/** The worker's reading of a run's options, everything resolved to a value: the
 *  run's own, then the team's (a run sent before 0086 was applied carries
 *  none), then the built-ins, which keep the old 15-minute, 3-retry budget. */
export function effectiveRunOptions(raw: unknown, teamDefaults: unknown = null): {
  speed: AgentSpeed;
  timeLimitMs: number;
  maxAttempts: number;
  siteMap: boolean;
  houseRules: string | null;
  engine: AgentEngine;
  /** MiniMax runs: the API settings, steps resolved to a number. */
  minimax: MinimaxSettings & { max_steps: number };
} {
  const o = readRunOptions(raw);
  const d = readDefaults(teamDefaults);
  const speed = o.speed ?? d.speed ?? BUILT_IN_DEFAULTS.speed;
  const minutes = o.time_limit_min ?? (o.speed ? AGENT_SPEEDS[o.speed].minutes : d.time_limit_min ?? AGENT_SPEEDS[speed].minutes);
  // A run carries its engine; one stored without any is Antigravity. The team
  // default never re-routes a run that was already sent.
  const engine = runEngine(raw);
  const minimax = o.minimax ?? {};
  return {
    speed,
    timeLimitMs: minutes * 60_000,
    maxAttempts: 1 + (o.retries ?? d.retries ?? BUILT_IN_DEFAULTS.retries),
    siteMap: o.site_map ?? d.site_map ?? BUILT_IN_DEFAULTS.site_map,
    houseRules: o.house_rules ?? d.house_rules ?? null,
    engine,
    minimax: { ...minimax, max_steps: minimax.max_steps ?? defaultMinimaxSteps(speed) },
  };
}

/** "Quick · 8 min · 3 retries" — the run header's one-line summary. */
export function describeRunOptions(raw: unknown): string | null {
  const o = readRunOptions(raw);
  if (!o.speed && o.time_limit_min === undefined && o.retries === undefined && !o.engine) return null;
  const parts: string[] = [];
  if (o.engine === "minimax") {
    parts.push("MiniMax");
    const m = o.minimax ?? {};
    if (m.thinking === "disabled") parts.push("no thinking");
    if (m.reasoning_effort) parts.push(`${m.reasoning_effort} effort`);
    if (m.temperature !== undefined) parts.push(`temp ${m.temperature}`);
    if (m.service_tier === "priority") parts.push("priority tier");
  }
  if (o.speed) parts.push(AGENT_SPEEDS[o.speed].label);
  if (o.time_limit_min !== undefined) parts.push(`${o.time_limit_min} min limit`);
  if (o.retries !== undefined) parts.push(o.retries === 0 ? "no retries" : `${o.retries} ${o.retries === 1 ? "retry" : "retries"}`);
  if (o.site_map === false) parts.push("no site map");
  return parts.join(" · ");
}
