/**
 * Provider plan-quota probe.
 *
 * WHY THIS EXISTS: rate limiting made individual calls survivable, but when a
 * provider's PLAN quota window (MiniMax's 5-hour / weekly Token Plan windows)
 * is exhausted, every retry burns against a wall that will not move until a
 * reset time the system never looked at. Before retrying a round whose
 * failures were throttles, the run loop calls `probeQuota` so it can wait for
 * the actual reset — or park the run until it — instead of escalating blindly.
 *
 * WHY ONLY MINIMAX: of the providers this app supports, only MiniMax exposes
 * a plan-remains endpoint (`GET /v1/token_plan/remains`). No other vendor
 * documents an equivalent, so every other provider key returns null
 * immediately — "unknown", not "empty".
 *
 * WHY NULL ON ANY FAILURE: quota awareness is an ENHANCEMENT. The caller has
 * a working fallback (escalating waits), so a probe that is down, slow,
 * misdocumented, or unauthenticated must degrade to that fallback — never
 * fail a run that generation itself could still finish. Concretely: this
 * function never throws, and never delays its caller beyond its own 5s
 * timeout (AbortController-enforced hard stop).
 *
 * WHY NULL INSTEAD OF AN EMPTY SNAPSHOT: the caller parks runs on the
 * strength of a snapshot. A snapshot must therefore mean "real vendor data";
 * a body we recognised nothing in returns null so the caller falls back,
 * rather than an empty `windows: []` it might misread as "no quota pressure".
 *
 * The API key is used solely as the Authorization header value. It is never
 * logged, never thrown, and never present in the returned snapshot.
 */

export interface QuotaWindow {
  /** Human label, e.g. "5-hour window" / "weekly window". */
  label: string;
  /** Tokens remaining in this window, when the vendor reports one. */
  remainingTokens?: number;
  /** When this window resets, when the vendor reports it. */
  resetAt?: Date;
}

export interface QuotaSnapshot {
  providerKey: string;
  windows: QuotaWindow[];
  fetchedAt: Date;
}

/** The probe's hard ceiling on its own runtime — see module doc. */
const PROBE_TIMEOUT_MS = 5_000;

const MINIMAX_REMAINS_ENDPOINT = "https://api.minimax.io/v1/token_plan/remains";

/**
 * TOLERANT PARSER — READ THIS BEFORE TIGHTENING OR TRUSTING IT.
 *
 * The response shape of `/v1/token_plan/remains` is NOT authoritatively
 * documented. Rather than hard-code one guessed schema and go blind the day
 * the vendor's actual field names differ, the parser walks the whole JSON
 * body for objects that LOOK like quota windows: a numeric
 * remaining-token-like field and/or an epoch/ISO reset-like field, under any
 * of several plausible key spellings (case-insensitive).
 *
 * TODO(next maintainer): once a real response has been captured from the
 * live endpoint, tighten this walk into an exact-shape parser and keep the
 * tolerant walk only as a fallback — guessed spellings are a bridge, not a
 * contract.
 */
const TOKEN_KEYS = new Set(["remaining", "remains", "remain_tokens", "remaining_tokens", "left"]);
const RESET_KEYS = new Set(["reset_time", "reset_at", "refresh_time", "next_reset"]);

function pickNumericField(obj: Record<string, unknown>, keys: Set<string>): number | undefined {
  for (const [key, value] of Object.entries(obj)) {
    if (!keys.has(key.toLowerCase())) continue;
    if (typeof value === "number" && Number.isFinite(value)) return value;
  }
  return undefined;
}

/**
 * Epoch values arrive in seconds OR milliseconds depending on who wrote the
 * vendor's serializer, and nothing in the body says which. Disambiguate by
 * magnitude: 1e11 SECONDS is the year 5138 — no vendor means that — while
 * 1e11 MILLISECONDS is 1973, so any value >= 1e11 can only sensibly be
 * milliseconds and anything below it seconds.
 */
const EPOCH_MILLIS_THRESHOLD = 1e11;

function parseResetValue(value: unknown): Date | undefined {
  let epochOrIso = value;
  // A purely numeric string is an epoch that happened to be serialized as a
  // string — hand it to the numeric branch, not Date.parse (which would
  // misread it, cf. the Retry-After lesson in providers/errors.ts).
  if (typeof epochOrIso === "string" && /^\d+(\.\d+)?$/.test(epochOrIso.trim())) {
    epochOrIso = Number(epochOrIso);
  }
  if (typeof epochOrIso === "number" && Number.isFinite(epochOrIso) && epochOrIso > 0) {
    const ms = epochOrIso >= EPOCH_MILLIS_THRESHOLD ? epochOrIso : epochOrIso * 1000;
    return new Date(ms);
  }
  if (typeof epochOrIso === "string") {
    const at = Date.parse(epochOrIso);
    if (!Number.isNaN(at)) return new Date(at);
  }
  return undefined;
}

function pickResetField(obj: Record<string, unknown>): Date | undefined {
  for (const [key, value] of Object.entries(obj)) {
    if (!RESET_KEYS.has(key.toLowerCase())) continue;
    const parsed = parseResetValue(value);
    if (parsed) return parsed;
  }
  return undefined;
}

/**
 * Map the key (or an embedded label-like string) a window was found under to
 * the human label the parking message uses. Unknown keys pass through as-is —
 * a truthful unfamiliar label beats a wrong familiar one.
 */
function windowLabel(key: string, obj: Record<string, unknown>): string {
  const candidates = [key];
  for (const [k, v] of Object.entries(obj)) {
    if (typeof v === "string" && ["label", "name", "window", "type"].includes(k.toLowerCase())) candidates.push(v);
  }
  for (const candidate of candidates) {
    const lower = candidate.toLowerCase();
    if (lower.includes("hour") || lower.includes("5h")) return "5-hour window";
    if (lower.includes("week")) return "weekly window";
  }
  return key || "window";
}

/**
 * Depth-first walk collecting every object that carries at least one
 * recognised quota field. "At least one" rather than both: the shape is
 * undocumented, and a window reporting only a reset time is still actionable
 * for parking, just as one reporting only remaining tokens still informs —
 * demanding both would discard real data on a guess about which half the
 * vendor omits. An object accepted as a window is not descended into, so a
 * window can never double-report through a nested child.
 */
function collectWindows(node: unknown, key: string, out: QuotaWindow[], seen: Set<object>): void {
  if (node === null || typeof node !== "object") return;
  if (seen.has(node)) return;
  seen.add(node);
  if (Array.isArray(node)) {
    for (const item of node) collectWindows(item, key, out, seen);
    return;
  }
  const obj = node as Record<string, unknown>;
  const remainingTokens = pickNumericField(obj, TOKEN_KEYS);
  const resetAt = pickResetField(obj);
  if (remainingTokens !== undefined || resetAt !== undefined) {
    const window: QuotaWindow = { label: windowLabel(key, obj) };
    if (remainingTokens !== undefined) window.remainingTokens = remainingTokens;
    if (resetAt !== undefined) window.resetAt = resetAt;
    out.push(window);
    return;
  }
  for (const [childKey, child] of Object.entries(obj)) collectWindows(child, childKey, out, seen);
}

/**
 * Probe a provider's remaining plan quota. See the module doc for the
 * contract: minimax-only, null on any failure, null rather than an empty
 * snapshot, never throws, never runs longer than PROBE_TIMEOUT_MS.
 */
export async function probeQuota(
  providerKey: string,
  credentials: Record<string, string> | null,
  fetchImpl: typeof fetch = fetch,
): Promise<QuotaSnapshot | null> {
  if (providerKey !== "minimax") return null;
  const apiKey = credentials?.api_key;
  if (!apiKey) return null;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), PROBE_TIMEOUT_MS);
  try {
    const res = await fetchImpl(MINIMAX_REMAINS_ENDPOINT, {
      method: "GET",
      headers: { Authorization: `Bearer ${apiKey}` },
      signal: controller.signal,
    });
    if (!res.ok) return null;
    const body: unknown = await res.json();
    const windows: QuotaWindow[] = [];
    collectWindows(body, "", windows, new Set());
    if (windows.length === 0) return null;
    return { providerKey, windows, fetchedAt: new Date() };
  } catch {
    // Deliberately swallowed WITHOUT logging: the error could embed request
    // details, and the fallback path needs no diagnosis — see module doc.
    return null;
  } finally {
    clearTimeout(timer);
  }
}
