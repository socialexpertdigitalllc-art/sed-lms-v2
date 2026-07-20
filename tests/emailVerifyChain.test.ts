// @vitest-environment node
import { describe, it, expect, vi } from "vitest";
import { runProviderChain } from "@/lib/email-verify/providers/chain";
import { isProviderAvailable, periodEnd, periodKey, PROVIDER_LIMITS } from "@/lib/email-verify/providers/quota";
import type { ProviderAdapter, ProviderStateStore } from "@/lib/email-verify/providers/types";
import type { ProviderName, RemoteResult } from "@/lib/email-verify/types";

function fakeProvider(name: ProviderName, result: RemoteResult, configured = true): ProviderAdapter {
  return { name, isConfigured: () => configured, verify: vi.fn(async () => result) };
}

function fakeState(initial: Partial<Record<ProviderName, { exhaustedUntil: Date | null; periodKey: string; callsUsed: number }>> = {}) {
  const rows: Record<string, { exhaustedUntil: Date | null; periodKey: string; callsUsed: number }> = {
    verifalia: { exhaustedUntil: null, periodKey: periodKey("verifalia"), callsUsed: 0 },
    reoon: { exhaustedUntil: null, periodKey: periodKey("reoon"), callsUsed: 0 },
    ...initial,
  };
  const store: ProviderStateStore & { rows: typeof rows } = {
    rows,
    get: async (p) => rows[p],
    recordCall: async (p, key) => {
      rows[p] = { ...rows[p], periodKey: key, callsUsed: rows[p].periodKey === key ? rows[p].callsUsed + 1 : 1 };
    },
    markExhausted: async (p, until) => {
      rows[p] = { ...rows[p], exhaustedUntil: until };
    },
    recordError: async () => {},
  };
  return store;
}

const good: RemoteResult = { ok: true, status: "Success", classification: "deliverable", detail: null, raw: { a: 1 } };

describe("provider quota accounting", () => {
  it("documents the free tiers", () => {
    expect(PROVIDER_LIMITS.verifalia).toEqual({ limit: 25, period: "day" });
    expect(PROVIDER_LIMITS.reoon).toEqual({ limit: 600, period: "month" });
  });

  it("buckets Verifalia per UTC day and Reoon per UTC month", () => {
    const t = new Date("2026-07-20T23:30:00Z");
    expect(periodKey("verifalia", t)).toBe("2026-07-20");
    expect(periodKey("reoon", t)).toBe("2026-07");
  });

  it("resets at the next UTC day / month boundary", () => {
    const t = new Date("2026-07-20T23:30:00Z");
    expect(periodEnd("verifalia", t).toISOString()).toBe("2026-07-21T00:00:00.000Z");
    expect(periodEnd("reoon", t).toISOString()).toBe("2026-08-01T00:00:00.000Z");
    expect(periodEnd("reoon", new Date("2026-12-05T00:00:00Z")).toISOString()).toBe("2027-01-01T00:00:00.000Z");
  });

  it("blocks a provider once the proactive counter hits the limit", () => {
    const now = new Date("2026-07-20T10:00:00Z");
    const state = { exhaustedUntil: null, periodKey: "2026-07-20", callsUsed: 25 };
    expect(isProviderAvailable("verifalia", state, now)).toEqual({ available: false, reason: "counter" });
    expect(isProviderAvailable("verifalia", { ...state, callsUsed: 24 }, now).available).toBe(true);
  });

  it("ignores a counter belonging to an expired period", () => {
    const now = new Date("2026-07-20T10:00:00Z");
    const stale = { exhaustedUntil: null, periodKey: "2026-07-19", callsUsed: 999 };
    expect(isProviderAvailable("verifalia", stale, now).available).toBe(true);
  });

  it("honours a reactive park until it expires", () => {
    const now = new Date("2026-07-20T10:00:00Z");
    const parked = { exhaustedUntil: new Date("2026-07-21T00:00:00Z"), periodKey: "2026-07-20", callsUsed: 0 };
    expect(isProviderAvailable("verifalia", parked, now)).toEqual({ available: false, reason: "parked" });
    const lapsed = { ...parked, exhaustedUntil: new Date("2026-07-20T09:00:00Z") };
    expect(isProviderAvailable("verifalia", lapsed, now).available).toBe(true);
  });
});

describe("provider chain", () => {
  it("uses Verifalia first and does not touch Reoon when it answers", async () => {
    const v = fakeProvider("verifalia", good);
    const r = fakeProvider("reoon", good);
    const out = await runProviderChain("a@b.com", { providers: [v, r], state: fakeState() });
    expect(out.provider).toBe("verifalia");
    expect(out.signal?.classification).toBe("deliverable");
    expect(out.raw).toEqual({ a: 1 });
    expect(r.verify).not.toHaveBeenCalled();
  });

  it("falls back to Reoon when Verifalia reports quota exhaustion", async () => {
    const v = fakeProvider("verifalia", { ok: false, reason: "quota", message: "Verifalia HTTP 402" });
    const r = fakeProvider("reoon", { ...good, status: "safe" });
    const state = fakeState();
    const out = await runProviderChain("a@b.com", { providers: [v, r], state });
    expect(out.provider).toBe("reoon");
    expect(out.attempts.map((a) => a.outcome)).toEqual(["quota", "ok"]);
    // the provider's own answer is authoritative: park it until the period rolls over
    expect(state.rows.verifalia.exhaustedUntil).toBeInstanceOf(Date);
  });

  it("falls back when the primary credential is missing", async () => {
    const v = fakeProvider("verifalia", good, false);
    const r = fakeProvider("reoon", good);
    const out = await runProviderChain("a@b.com", { providers: [v, r], state: fakeState() });
    expect(out.provider).toBe("reoon");
    expect(out.attempts[0]).toEqual({ provider: "verifalia", outcome: "not_configured" });
    expect(v.verify).not.toHaveBeenCalled();
  });

  it("falls back on a hard error", async () => {
    const v = fakeProvider("verifalia", { ok: false, reason: "error", message: "TimeoutError" });
    const r = fakeProvider("reoon", good);
    const out = await runProviderChain("a@b.com", { providers: [v, r], state: fakeState() });
    expect(out.provider).toBe("reoon");
  });

  it("skips a provider our own counter says is spent, without calling it", async () => {
    const now = new Date("2026-07-20T10:00:00Z");
    const v = fakeProvider("verifalia", good);
    const r = fakeProvider("reoon", good);
    const state = fakeState({ verifalia: { exhaustedUntil: null, periodKey: "2026-07-20", callsUsed: 25 } });
    const out = await runProviderChain("a@b.com", { providers: [v, r], state, now: () => now });
    expect(v.verify).not.toHaveBeenCalled();
    expect(out.provider).toBe("reoon");
    expect(out.attempts[0].outcome).toBe("skipped_quota");
  });

  it("returns a local-only outcome when every provider is unavailable", async () => {
    const v = fakeProvider("verifalia", { ok: false, reason: "quota", message: "q" });
    const r = fakeProvider("reoon", { ok: false, reason: "auth", message: "no key" }, false);
    const out = await runProviderChain("a@b.com", { providers: [v, r], state: fakeState() });
    expect(out.provider).toBeNull();
    expect(out.signal).toBeNull();
    expect(out.attempts).toHaveLength(2);
  });

  it("counts a call before making it, so a crash cannot under-count", async () => {
    const state = fakeState();
    const v = fakeProvider("verifalia", { ok: false, reason: "error", message: "boom" });
    await runProviderChain("a@b.com", { providers: [v], state });
    expect(state.rows.verifalia.callsUsed).toBe(1);
  });

  it("returns local-only when no providers are supplied at all", async () => {
    const out = await runProviderChain("a@b.com", { providers: [], state: fakeState() });
    expect(out).toEqual({ provider: null, signal: null, raw: null, attempts: [] });
  });
});
