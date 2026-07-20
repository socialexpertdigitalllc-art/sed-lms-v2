// @vitest-environment node
import { describe, it, expect } from "vitest";
import {
  SCORECARD_MIN_SAMPLE,
  buildScorecard,
  buildUsageStats,
  type OutcomeRow,
  type VerificationRow,
} from "@/lib/email-verify/scorecard";

const T = (n: number) => new Date(Date.UTC(2026, 0, n)).toISOString();

function verifications(provider: string, count: number, verdict: VerificationRow["verdict"] = "OK", offset = 0) {
  return Array.from({ length: count }, (_, i) => ({
    normalizedEmail: `${provider}-${offset + i}@example.com`,
    provider,
    verdict,
    verifiedAt: T(1),
  }));
}

describe("scorecard sample threshold", () => {
  it("refuses to publish a rate from a handful of data points", () => {
    const rows = verifications("verifalia", 3);
    const outcomes: OutcomeRow[] = [
      { normalizedEmail: "verifalia-0@example.com", outcome: "hard_bounce", detectedAt: T(5) },
    ];
    const card = buildScorecard(rows, outcomes);
    const v = card.providers[0];
    expect(v.insufficientData).toBe(true);
    expect(v.falsePositiveRate).toBeNull();
    expect(v.accuracy).toBeNull();
    // the raw counts are still there for the UI to show as "1 of 3"
    expect(v.positives).toBe(3);
    expect(v.falsePositives).toBe(1);
  });

  it("publishes once the positive sample reaches the threshold", () => {
    const rows = verifications("verifalia", SCORECARD_MIN_SAMPLE);
    const outcomes: OutcomeRow[] = [
      { normalizedEmail: "verifalia-0@example.com", outcome: "hard_bounce", detectedAt: T(5) },
      { normalizedEmail: "verifalia-1@example.com", outcome: "hard_bounce", detectedAt: T(5) },
    ];
    const v = buildScorecard(rows, outcomes).providers[0];
    expect(v.insufficientData).toBe(false);
    expect(v.falsePositiveRate).toBeCloseTo(2 / SCORECARD_MIN_SAMPLE);
    expect(v.accuracy).toBeCloseTo(1 - 2 / SCORECARD_MIN_SAMPLE);
  });

  it("documents the threshold", () => {
    expect(SCORECARD_MIN_SAMPLE).toBe(20);
  });
});

describe("scorecard attribution", () => {
  it("only charges a bounce to the provider that actually answered", () => {
    const rows: VerificationRow[] = [
      { normalizedEmail: "a@example.com", provider: "verifalia", verdict: "OK", verifiedAt: T(1) },
      { normalizedEmail: "b@example.com", provider: "reoon", verdict: "OK", verifiedAt: T(1) },
    ];
    const outcomes: OutcomeRow[] = [{ normalizedEmail: "b@example.com", outcome: "hard_bounce", detectedAt: T(5) }];
    const card = buildScorecard(rows, outcomes, { minSample: 1 });
    const byKey = Object.fromEntries(card.providers.map((p) => [p.provider, p]));
    expect(byKey.reoon.falsePositives).toBe(1);
    expect(byKey.verifalia.falsePositives).toBe(0);
  });

  it("never blames a local-only verdict on anyone", () => {
    const rows: VerificationRow[] = [{ normalizedEmail: "a@example.com", provider: null, verdict: "OK", verifiedAt: T(1) }];
    const outcomes: OutcomeRow[] = [{ normalizedEmail: "a@example.com", outcome: "hard_bounce", detectedAt: T(5) }];
    const card = buildScorecard(rows, outcomes, { minSample: 1 });
    expect(card.providers).toHaveLength(0);
    expect(card.unattributedHardBounces).toBe(1);
  });

  it("ignores a bounce that predates the verification", () => {
    const rows: VerificationRow[] = [
      { normalizedEmail: "a@example.com", provider: "verifalia", verdict: "OK", verifiedAt: T(10) },
    ];
    const outcomes: OutcomeRow[] = [{ normalizedEmail: "a@example.com", outcome: "hard_bounce", detectedAt: T(2) }];
    const card = buildScorecard(rows, outcomes, { minSample: 1 });
    expect(card.providers[0].falsePositives).toBe(0);
    expect(card.unattributedHardBounces).toBe(1);
  });

  it("ignores soft bounces entirely", () => {
    const rows: VerificationRow[] = [
      { normalizedEmail: "a@example.com", provider: "verifalia", verdict: "OK", verifiedAt: T(1) },
    ];
    const outcomes: OutcomeRow[] = [{ normalizedEmail: "a@example.com", outcome: "soft_bounce", detectedAt: T(5) }];
    const card = buildScorecard(rows, outcomes, { minSample: 1 });
    expect(card.providers[0].falsePositives).toBe(0);
    expect(card.providers[0].hardBounces).toBe(0);
  });

  it("counts a repeatedly-bouncing address once", () => {
    const rows: VerificationRow[] = [
      { normalizedEmail: "a@example.com", provider: "verifalia", verdict: "OK", verifiedAt: T(1) },
    ];
    const outcomes: OutcomeRow[] = [
      { normalizedEmail: "a@example.com", outcome: "hard_bounce", detectedAt: T(5) },
      { normalizedEmail: "a@example.com", outcome: "hard_bounce", detectedAt: T(6) },
      { normalizedEmail: "a@example.com", outcome: "hard_bounce", detectedAt: T(7) },
    ];
    expect(buildScorecard(rows, outcomes, { minSample: 1 }).providers[0].falsePositives).toBe(1);
  });

  it("counts a bounce on a BLOCK verdict as a correct call, not a false positive", () => {
    const rows: VerificationRow[] = [
      { normalizedEmail: "a@example.com", provider: "verifalia", verdict: "BLOCK", verifiedAt: T(1) },
    ];
    const outcomes: OutcomeRow[] = [{ normalizedEmail: "a@example.com", outcome: "hard_bounce", detectedAt: T(5) }];
    const p = buildScorecard(rows, outcomes, { minSample: 1 }).providers[0];
    expect(p.hardBounces).toBe(1);
    expect(p.positives).toBe(0);
    expect(p.falsePositives).toBe(0);
    expect(p.falsePositiveRate).toBeNull(); // no positives to divide by
  });

  it("matches addresses case-insensitively", () => {
    const rows: VerificationRow[] = [
      { normalizedEmail: "Mixed@Example.com", provider: "verifalia", verdict: "OK", verifiedAt: T(1) },
    ];
    const outcomes: OutcomeRow[] = [{ normalizedEmail: "mixed@example.com", outcome: "hard_bounce", detectedAt: T(5) }];
    expect(buildScorecard(rows, outcomes, { minSample: 1 }).providers[0].falsePositives).toBe(1);
  });

  it("returns an empty card for no data at all", () => {
    expect(buildScorecard([], [])).toEqual({ minSample: 20, providers: [], unattributedHardBounces: 0 });
  });
});

describe("usage stats", () => {
  const rows: VerificationRow[] = [
    { normalizedEmail: "a@example.com", provider: "verifalia", verdict: "OK", verifiedAt: "2026-01-01T10:00:00Z" },
    { normalizedEmail: "b@example.com", provider: "reoon", verdict: "WARN", verifiedAt: "2026-01-01T11:00:00Z" },
    { normalizedEmail: "c@example.com", provider: null, verdict: "BLOCK", verifiedAt: "2026-01-02T09:00:00Z" },
    { normalizedEmail: "d@example.com", provider: null, verdict: "OK", verifiedAt: "2026-01-02T09:30:00Z" },
  ];

  it("splits verdicts and per-provider counts", () => {
    const u = buildUsageStats(rows);
    expect(u.verdicts).toEqual({ OK: 2, WARN: 1, BLOCK: 1 });
    expect(u.byProvider).toEqual({ verifalia: 1, reoon: 1 });
    expect(u.billed).toBe(2);
  });

  it("reports the share of traffic that never had to be billed", () => {
    const u = buildUsageStats(rows);
    expect(u.total).toBe(4);
    expect(u.cached).toBe(2);
    expect(u.cacheHitRate).toBe(0.5);
  });

  it("buckets per UTC day, ascending", () => {
    expect(buildUsageStats(rows).perDay).toEqual([
      { date: "2026-01-01", count: 2 },
      { date: "2026-01-02", count: 2 },
    ]);
  });

  it("handles an empty window without dividing by zero", () => {
    const u = buildUsageStats([]);
    expect(u.total).toBe(0);
    expect(u.cacheHitRate).toBeNull();
    expect(u.perDay).toEqual([]);
  });
});
