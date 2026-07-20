/**
 * Provider accuracy scorecard — PURE aggregation. No I/O.
 *
 * The question it answers: when a provider told us an address was good, how
 * often did the mail actually bounce? Three rules keep the number honest:
 *
 *  1. ATTRIBUTION — a bounce is only ever charged to the provider that actually
 *     answered for that address (`email_verifications.provider`). A local-only
 *     verdict has no provider and is never blamed on anyone.
 *  2. ORDERING — the bounce must be *after* `verified_at`. A bounce we already
 *     knew about before we asked says nothing about the provider's answer.
 *  3. SAMPLE SIZE — below `SCORECARD_MIN_SAMPLE` positive calls we return null
 *     rates and `insufficientData: true`. "33% wrong" from three data points is
 *     worse than no number at all.
 *
 * Only HARD bounces count. A soft bounce (4.x.x: full mailbox, greylisting,
 * temporary outage) is not evidence that the address is bad — and our bounce
 * parser degrades anything ambiguous to soft, precisely so it lands here
 * harmlessly.
 */

export type Verdict = "OK" | "WARN" | "BLOCK";
export type SendOutcome = "hard_bounce" | "soft_bounce";

export interface VerificationRow {
  normalizedEmail: string;
  /** Provider that answered, or null for a local-only verdict. */
  provider: string | null;
  verdict: Verdict;
  providerStatus?: string | null;
  verifiedAt: string;
}

export interface OutcomeRow {
  normalizedEmail: string;
  outcome: SendOutcome;
  detectedAt: string;
}

export interface ProviderScore {
  provider: string;
  /** Every verification this provider answered. */
  verifications: number;
  /** Of those, how many it called good (verdict OK). */
  positives: number;
  /** Of those positives, how many later hard-bounced. */
  falsePositives: number;
  /** Hard bounces for this provider's addresses regardless of verdict. */
  hardBounces: number;
  /** falsePositives / positives, or null below the sample threshold. */
  falsePositiveRate: number | null;
  /** 1 - falsePositiveRate, or null below the sample threshold. */
  accuracy: number | null;
  insufficientData: boolean;
}

export interface Scorecard {
  minSample: number;
  providers: ProviderScore[];
  /** Bounces we could not attribute (no verification row, or local-only). */
  unattributedHardBounces: number;
}

/**
 * Twenty positive calls. Small enough that a real deployment reaches it inside
 * a few weeks, large enough that one unlucky bounce cannot swing the headline
 * number by more than five points.
 */
export const SCORECARD_MIN_SAMPLE = 20;

function ts(iso: string): number {
  const t = Date.parse(iso);
  return Number.isFinite(t) ? t : NaN;
}

/**
 * Earliest hard bounce per address, so one address that bounces repeatedly is
 * counted once — otherwise a single dead mailbox on a busy list would dominate.
 */
function earliestHardBounce(outcomes: OutcomeRow[]): Map<string, number> {
  const out = new Map<string, number>();
  for (const o of outcomes) {
    if (o.outcome !== "hard_bounce") continue;
    const email = (o.normalizedEmail ?? "").toLowerCase();
    const at = ts(o.detectedAt);
    if (!email || Number.isNaN(at)) continue;
    const prev = out.get(email);
    if (prev === undefined || at < prev) out.set(email, at);
  }
  return out;
}

export function buildScorecard(
  verifications: VerificationRow[],
  outcomes: OutcomeRow[],
  opts: { minSample?: number } = {}
): Scorecard {
  const minSample = opts.minSample ?? SCORECARD_MIN_SAMPLE;
  const bounces = earliestHardBounce(outcomes);
  const byProvider = new Map<string, ProviderScore>();
  const matched = new Set<string>();

  for (const row of verifications) {
    const provider = row.provider;
    if (!provider) continue; // local-only: nobody to credit or blame
    const email = (row.normalizedEmail ?? "").toLowerCase();
    const verifiedAt = ts(row.verifiedAt);

    const score =
      byProvider.get(provider) ??
      ({
        provider,
        verifications: 0,
        positives: 0,
        falsePositives: 0,
        hardBounces: 0,
        falsePositiveRate: null,
        accuracy: null,
        insufficientData: true,
      } satisfies ProviderScore);
    byProvider.set(provider, score);

    score.verifications += 1;
    const positive = row.verdict === "OK";
    if (positive) score.positives += 1;

    const bounceAt = bounces.get(email);
    // Rule 2: only a bounce that happened AFTER we asked is evidence.
    if (bounceAt !== undefined && !Number.isNaN(verifiedAt) && bounceAt > verifiedAt) {
      matched.add(email);
      score.hardBounces += 1;
      if (positive) score.falsePositives += 1;
    }
  }

  const providers = [...byProvider.values()]
    .map((s) => {
      const enough = s.positives >= minSample;
      const rate = enough ? s.falsePositives / s.positives : null;
      return { ...s, falsePositiveRate: rate, accuracy: rate === null ? null : 1 - rate, insufficientData: !enough };
    })
    .sort((a, b) => b.verifications - a.verifications || a.provider.localeCompare(b.provider));

  let unattributed = 0;
  for (const email of bounces.keys()) if (!matched.has(email)) unattributed += 1;

  return { minSample, providers, unattributedHardBounces: unattributed };
}

/* ------------------------------------------------------------ usage rollups */

export interface UsageStats {
  total: number;
  cached: number;
  /** Verifications that reached a provider (i.e. were billed). */
  billed: number;
  cacheHitRate: number | null;
  verdicts: Record<Verdict, number>;
  byProvider: Record<string, number>;
  /** ISO date (UTC) → count, ascending. */
  perDay: { date: string; count: number }[];
}

/**
 * Usage rollup over verification rows. `cached` is derived the only way it can
 * be from stored rows: an address verified once and reused N times leaves one
 * row, so we report the ratio of provider-backed rows to total rows — i.e. how
 * much of our traffic never had to be billed.
 */
export function buildUsageStats(verifications: VerificationRow[], totalLookups?: number): UsageStats {
  const verdicts: Record<Verdict, number> = { OK: 0, WARN: 0, BLOCK: 0 };
  const byProvider: Record<string, number> = {};
  const perDayMap = new Map<string, number>();
  let billed = 0;

  for (const row of verifications) {
    if (row.verdict in verdicts) verdicts[row.verdict] += 1;
    if (row.provider) {
      billed += 1;
      byProvider[row.provider] = (byProvider[row.provider] ?? 0) + 1;
    }
    const day = (row.verifiedAt ?? "").slice(0, 10);
    if (/^\d{4}-\d{2}-\d{2}$/.test(day)) perDayMap.set(day, (perDayMap.get(day) ?? 0) + 1);
  }

  const total = totalLookups ?? verifications.length;
  const cached = Math.max(0, total - billed);
  return {
    total,
    cached,
    billed,
    cacheHitRate: total > 0 ? cached / total : null,
    verdicts,
    byProvider,
    perDay: [...perDayMap.entries()].map(([date, count]) => ({ date, count })).sort((a, b) => a.date.localeCompare(b.date)),
  };
}
