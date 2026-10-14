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
}

/** The team's defaults, edited in the AI developer settings. */
export interface AgentDefaults {
  /** agy model id; null/absent = Antigravity's own default. */
  model?: string | null;
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
} {
  const o = readRunOptions(raw);
  const d = readDefaults(teamDefaults);
  const speed = o.speed ?? d.speed ?? BUILT_IN_DEFAULTS.speed;
  const minutes = o.time_limit_min ?? (o.speed ? AGENT_SPEEDS[o.speed].minutes : d.time_limit_min ?? AGENT_SPEEDS[speed].minutes);
  return {
    speed,
    timeLimitMs: minutes * 60_000,
    maxAttempts: 1 + (o.retries ?? d.retries ?? BUILT_IN_DEFAULTS.retries),
    siteMap: o.site_map ?? d.site_map ?? BUILT_IN_DEFAULTS.site_map,
    houseRules: o.house_rules ?? d.house_rules ?? null,
  };
}

/** "Quick · 8 min · 3 retries" — the run header's one-line summary. */
export function describeRunOptions(raw: unknown): string | null {
  const o = readRunOptions(raw);
  if (!o.speed && o.time_limit_min === undefined && o.retries === undefined) return null;
  const parts: string[] = [];
  if (o.speed) parts.push(AGENT_SPEEDS[o.speed].label);
  if (o.time_limit_min !== undefined) parts.push(`${o.time_limit_min} min limit`);
  if (o.retries !== undefined) parts.push(o.retries === 0 ? "no retries" : `${o.retries} ${o.retries === 1 ? "retry" : "retries"}`);
  if (o.site_map === false) parts.push("no site map");
  return parts.join(" · ");
}
