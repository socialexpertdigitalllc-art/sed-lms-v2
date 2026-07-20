// @vitest-environment node
import { describe, it, expect, vi, afterEach } from "vitest";
import {
  counterRemaining,
  fetchReoonBalance,
  fetchVerifaliaBalance,
  isBalanceFresh,
  parseReoonBalance,
  parseVerifaliaBalance,
} from "@/lib/email-verify/balance";
import { QUOTA_WARN_THRESHOLD, quotaAlertDedupKey, quotaAlertText, shouldWarnQuota } from "@/lib/email-verify/alerts";

afterEach(() => {
  vi.unstubAllGlobals();
});

/** Shapes observed against the live APIs on 2026-07-20. */
const VERIFALIA_BODY = { creditPacks: 0, freeCredits: 22, freeCreditsResetIn: "13:20:05" };
const REOON_BODY = { api_status: "active", remaining_daily_credits: 18, remaining_instant_credits: 100, status: "success" };

describe("balance parsers", () => {
  it("sums Verifalia's packs and free credits", () => {
    expect(parseVerifaliaBalance(VERIFALIA_BODY)).toBe(22);
    expect(parseVerifaliaBalance({ creditPacks: 500, freeCredits: 25 })).toBe(525);
    expect(parseVerifaliaBalance({ freeCredits: 5 })).toBe(5);
  });

  it("takes the SMALLER of Reoon's two meters — a call needs one of each", () => {
    expect(parseReoonBalance(REOON_BODY)).toBe(18);
    expect(parseReoonBalance({ remaining_daily_credits: 900, remaining_instant_credits: 3 })).toBe(3);
    expect(parseReoonBalance({ remaining_instant_credits: 7 })).toBe(7);
  });

  it("returns null rather than guessing on an unrecognised body", () => {
    expect(parseVerifaliaBalance(null)).toBeNull();
    expect(parseVerifaliaBalance({ something: 1 })).toBeNull();
    expect(parseReoonBalance("nope")).toBeNull();
    expect(parseReoonBalance({ status: "error" })).toBeNull();
  });
});

describe("balance lookups", () => {
  function stubFetch(status: number, body: unknown) {
    const fn = vi.fn(
      async (url: unknown, _init?: unknown) =>
        new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } })
    );
    vi.stubGlobal("fetch", fn);
    return fn;
  }

  it("reads the Verifalia credits/balance endpoint", async () => {
    const fetchFn = stubFetch(200, VERIFALIA_BODY);
    const out = await fetchVerifaliaBalance({ username: "u", password: "p" });
    expect(out).toEqual({ ok: true, remaining: 22 });
    expect(String(fetchFn.mock.calls[0][0])).toContain("/credits/balance");
  });

  it("reads the Reoon check-account-balance endpoint", async () => {
    const fetchFn = stubFetch(200, REOON_BODY);
    const out = await fetchReoonBalance({ api_key: "k" });
    expect(out).toEqual({ ok: true, remaining: 18 });
    expect(String(fetchFn.mock.calls[0][0])).toContain("check-account-balance");
  });

  it("reports bad credentials without throwing", async () => {
    stubFetch(401, {});
    expect(await fetchVerifaliaBalance({ username: "u", password: "p" })).toEqual({
      ok: false,
      error: "Verifalia rejected the credentials",
    });
  });

  it("never echoes the URL (which carries Reoon's key) in an error", async () => {
    stubFetch(500, {});
    const out = await fetchReoonBalance({ api_key: "SUPERSECRET" });
    expect(out.ok).toBe(false);
    expect(JSON.stringify(out)).not.toContain("SUPERSECRET");
  });

  it("treats a documented Reoon error payload as a rejection", async () => {
    stubFetch(200, { status: "error", reason: "invalid key" });
    expect((await fetchReoonBalance({ api_key: "k" })).ok).toBe(false);
  });

  it("survives a network failure", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => { throw new TypeError("fetch failed"); }));
    const out = await fetchVerifaliaBalance({ username: "u", password: "p" });
    expect(out).toEqual({ ok: false, error: "TypeError" });
  });

  it("skips the call entirely when credentials are missing", async () => {
    const fetchFn = vi.fn();
    vi.stubGlobal("fetch", fetchFn);
    expect((await fetchReoonBalance({ api_key: "" })).ok).toBe(false);
    expect(fetchFn).not.toHaveBeenCalled();
  });
});

describe("counter fallback", () => {
  const now = new Date("2026-07-20T10:00:00Z");

  it("subtracts calls used in the CURRENT period", () => {
    expect(counterRemaining(25, { periodKey: "2026-07-20", callsUsed: 10 }, "verifalia", now)).toBe(15);
  });

  it("treats a stale period counter as zero used", () => {
    expect(counterRemaining(25, { periodKey: "2026-07-19", callsUsed: 25 }, "verifalia", now)).toBe(25);
    expect(counterRemaining(25, null, "verifalia", now)).toBe(25);
  });

  it("never goes negative", () => {
    expect(counterRemaining(25, { periodKey: "2026-07-20", callsUsed: 99 }, "verifalia", now)).toBe(0);
  });
});

describe("balance cache freshness", () => {
  const now = new Date("2026-07-20T10:00:00Z");
  it("serves a value newer than the TTL and refetches an older one", () => {
    expect(isBalanceFresh("2026-07-20T09:59:30Z", now)).toBe(true);
    expect(isBalanceFresh("2026-07-20T09:58:00Z", now)).toBe(false);
    expect(isBalanceFresh(null, now)).toBe(false);
    expect(isBalanceFresh("not a date", now)).toBe(false);
  });
});

describe("quota-low alert", () => {
  it("fires at 80% and not before", () => {
    expect(shouldWarnQuota(19, 25)).toBe(false);
    expect(shouldWarnQuota(20, 25)).toBe(true);
    expect(shouldWarnQuota(25, 25)).toBe(true);
    expect(QUOTA_WARN_THRESHOLD).toBe(0.8);
  });

  it("never divides by a nonsense limit", () => {
    expect(shouldWarnQuota(5, 0)).toBe(false);
    expect(shouldWarnQuota(Number.NaN, 25)).toBe(false);
  });

  it("dedupes per provider AND per period, so a busy day rings once", () => {
    expect(quotaAlertDedupKey("verifalia", "2026-07-20")).toBe("email_verify_quota_low:verifalia:2026-07-20:quota");
    expect(quotaAlertDedupKey("verifalia", "2026-07-20")).not.toBe(quotaAlertDedupKey("verifalia", "2026-07-21"));
    expect(quotaAlertDedupKey("verifalia", "2026-07-20")).not.toBe(quotaAlertDedupKey("reoon", "2026-07-20"));
    expect(quotaAlertDedupKey("verifalia", "2026-07-20", "errors")).toContain(":errors");
  });

  it("writes copy that names the provider and never a credential", () => {
    const quota = quotaAlertText("verifalia", "quota", { used: 20, limit: 25 });
    expect(quota.title).toContain("Verifalia");
    expect(quota.body).toContain("80%");
    expect(quota.body).toContain("5 left");
    const errors = quotaAlertText("reoon", "errors", {});
    expect(errors.title).toContain("Reoon");
    expect(errors.body).toMatch(/credentials/i);
  });
});
