/**
 * PERMISSION MODES for Act mode — how much SED AI may do without a click,
 * chosen by each person (like Claude Code's permission modes) within what
 * their company allows. PURE, client-safe.
 *
 *  - ask: every change waits on its card (the original behaviour);
 *  - auto_safe: safe ("standard") changes happen as soon as they are
 *    prepared; anything that asks for a check still shows a card;
 *  - auto: safe and "check before confirming" changes both happen at once.
 *
 * Whatever the mode, these ALWAYS wait for a person:
 *  - high-impact ("critical") changes — money, deleting, access, going live —
 *    confirmed by typing their name;
 *  - anything that needs an approver (the person's own permission is missing,
 *    or an admin asked for approval on that action);
 *  - actions an admin set to "always ask".
 *
 * Besides the mode, a person can tell SED AI "don't ask again" for one
 * action (the `allow` list): that action then runs on its own even in Ask
 * mode — still within the company limit, and never if it is high-impact.
 */
import type { ActionRisk } from "./card";

export type PermissionMode = "ask" | "auto_safe" | "auto";

export const PERMISSION_MODES: readonly { mode: PermissionMode; label: string; short: string; description: string }[] = [
  {
    mode: "ask",
    label: "Ask before every change",
    short: "Ask first",
    description: "Every change shows a card. Nothing happens until you press its button.",
  },
  {
    mode: "auto_safe",
    label: "Auto-run safe changes",
    short: "Auto: safe",
    description: "Safe changes (new leads and pre-leads, notes, follow-ups, reminders, tickets) happen right away. Anything that needs a check still asks.",
  },
  {
    mode: "auto",
    label: "Auto-run all but high-impact",
    short: "Auto",
    description: "Changes happen right away, emails and status changes included. High-impact ones (money, deleting, access, going live) always ask.",
  },
];

export const MODE_RANK: Record<PermissionMode, number> = { ask: 0, auto_safe: 1, auto: 2 };

/** At most this many changes run on their own in one answer; the rest wait on cards. */
export const AUTO_RUNS_PER_TURN = 15;
export const MAX_ALWAYS_ALLOWED = 100;

export function isPermissionMode(v: unknown): v is PermissionMode {
  return v === "ask" || v === "auto_safe" || v === "auto";
}

/** The person's choice, never above the company's limit. */
export function clampMode(mode: PermissionMode, cap: PermissionMode): PermissionMode {
  return MODE_RANK[mode] <= MODE_RANK[cap] ? mode : cap;
}

export function modeInfo(mode: PermissionMode) {
  return PERMISSION_MODES.find((m) => m.mode === mode) ?? PERMISSION_MODES[0];
}

/** What a person chose (profiles.ui_preferences.assistantPermissions). */
export interface ActPermissions {
  mode: PermissionMode;
  /** Action keys they said "don't ask again" for. */
  allow: string[];
}

export const DEFAULT_ACT_PERMISSIONS: ActPermissions = { mode: "ask", allow: [] };

/** Stored preferences → a clean value (anything odd falls back to Ask). */
export function parseActPermissions(raw: unknown): ActPermissions {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return { ...DEFAULT_ACT_PERMISSIONS, allow: [] };
  const r = raw as { mode?: unknown; allow?: unknown };
  const allow = Array.isArray(r.allow)
    ? [...new Set(r.allow.filter((k): k is string => typeof k === "string" && /^[a-z_]+\.[a-z_]+$/.test(k)))].slice(0, MAX_ALWAYS_ALLOWED)
    : [];
  return { mode: isPermissionMode(r.mode) ? r.mode : "ask", allow };
}

/** The lowest mode under which a change of this risk may run on its own (critical: never). */
function rankNeeded(risk: ActionRisk): number {
  return risk === "standard" ? MODE_RANK.auto_safe : risk === "sensitive" ? MODE_RANK.auto : Infinity;
}

export interface AutoRunFacts {
  /** The person's mode (already clamped or not — it is clamped here). */
  mode: PermissionMode;
  /** The company's limit. */
  cap: PermissionMode;
  /** Actions the person said "don't ask again" for. */
  allow: readonly string[];
  key: string;
  risk: ActionRisk;
  /** The card needs an approver (the person can't do it, or an admin asked). */
  needsApproval: boolean;
  /** An admin set this action to always ask. */
  adminAlwaysAsk: boolean;
}

export type AutoDecision = { auto: true; via: "mode" | "always" } | { auto: false; reason: string };

/** May this proposal run without the person pressing its button? */
export function decideAutoRun(f: AutoRunFacts): AutoDecision {
  if (f.risk === "critical") return { auto: false, reason: "High-impact changes always wait for you to confirm." };
  if (f.needsApproval) return { auto: false, reason: "This needs an approver." };
  if (f.adminAlwaysAsk) return { auto: false, reason: "An admin has set this action to always ask." };
  const need = rankNeeded(f.risk);
  if (MODE_RANK[f.cap] < need) return { auto: false, reason: "Your company's settings don't let this run on its own." };
  if (MODE_RANK[clampMode(f.mode, f.cap)] >= need) return { auto: true, via: "mode" };
  if (f.allow.includes(f.key)) return { auto: true, via: "always" };
  return { auto: false, reason: "You asked to confirm changes like this." };
}

/** Can the card offer "don't ask again" for its action? */
export function canAlwaysAllow(f: Omit<AutoRunFacts, "mode" | "allow">): boolean {
  return f.risk !== "critical" && !f.needsApproval && !f.adminAlwaysAsk && MODE_RANK[f.cap] >= rankNeeded(f.risk);
}
