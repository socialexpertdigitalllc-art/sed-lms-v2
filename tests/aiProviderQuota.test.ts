// @vitest-environment node
import { describe, it, expect, vi, afterEach } from "vitest";
import { probeQuota, type QuotaSnapshot } from "@/lib/ai-tools/providers/quota";

const API_KEY = "sk-test-quota-key-do-not-leak";

function jsonResponse(body: unknown, init?: { status?: number }): Response {
  return new Response(JSON.stringify(body), {
    status: init?.status ?? 200,
    headers: { "content-type": "application/json" },
  });
}

/** A plausible remains body: epoch SECONDS on one window, epoch MILLIS on the other. */
const plausibleBody = {
  data: {
    five_hour: { remaining_tokens: 123456, reset_time: 1753804800 },
    weekly: { remaining_tokens: 900000000, reset_time: 1753900000000 },
  },
};

describe("probeQuota", () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("returns null for a non-minimax provider without touching the network", async () => {
    const fetchImpl = vi.fn();
    const out = await probeQuota("gemini", { api_key: API_KEY }, fetchImpl as unknown as typeof fetch);
    expect(out).toBeNull();
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("returns null when credentials are missing, without touching the network", async () => {
    const fetchImpl = vi.fn();
    expect(await probeQuota("minimax", null, fetchImpl as unknown as typeof fetch)).toBeNull();
    expect(await probeQuota("minimax", { group_id: "g" }, fetchImpl as unknown as typeof fetch)).toBeNull();
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("parses a plausible body into labelled windows, disambiguating epoch seconds from millis", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse(plausibleBody));
    const out = await probeQuota("minimax", { api_key: API_KEY }, fetchImpl as unknown as typeof fetch);

    expect(out).not.toBeNull();
    const snapshot = out as QuotaSnapshot;
    expect(snapshot.providerKey).toBe("minimax");
    expect(snapshot.windows).toHaveLength(2);

    const fiveHour = snapshot.windows.find((w) => w.label === "5-hour window");
    expect(fiveHour?.remainingTokens).toBe(123456);
    // 1753804800 < 1e11 → epoch SECONDS.
    expect(fiveHour?.resetAt?.getTime()).toBe(1753804800 * 1000);

    const weekly = snapshot.windows.find((w) => w.label === "weekly window");
    expect(weekly?.remainingTokens).toBe(900000000);
    // 1753900000000 >= 1e11 → epoch MILLISECONDS, used as-is.
    expect(weekly?.resetAt?.getTime()).toBe(1753900000000);
  });

  it("parses an ISO reset string", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(
      jsonResponse({ plan: { remains: 42, reset_at: "2026-07-30T12:00:00Z" } }),
    );
    const out = await probeQuota("minimax", { api_key: API_KEY }, fetchImpl as unknown as typeof fetch);
    expect(out?.windows).toHaveLength(1);
    expect(out?.windows[0].remainingTokens).toBe(42);
    expect(out?.windows[0].resetAt?.toISOString()).toBe("2026-07-30T12:00:00.000Z");
  });

  it("returns null on a non-200 response", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse({ error: "unauthorised" }, { status: 401 }));
    expect(await probeQuota("minimax", { api_key: API_KEY }, fetchImpl as unknown as typeof fetch)).toBeNull();
  });

  it("returns null — not an empty snapshot — when nothing in the body is recognisable", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(
      jsonResponse({ base_resp: { status_code: 0, status_msg: "success" }, some: ["irrelevant", 7] }),
    );
    const out = await probeQuota("minimax", { api_key: API_KEY }, fetchImpl as unknown as typeof fetch);
    // Strictly null: a snapshot with windows: [] would let the caller mistake
    // "we understood nothing" for "no quota pressure".
    expect(out).toBeNull();
  });

  it("returns null when fetch rejects", async () => {
    const fetchImpl = vi.fn().mockRejectedValue(new TypeError("fetch failed"));
    expect(await probeQuota("minimax", { api_key: API_KEY }, fetchImpl as unknown as typeof fetch)).toBeNull();
  });

  it("returns null when the body is unparseable JSON", async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValue(new Response("<html>gateway error</html>", { status: 200, headers: { "content-type": "text/html" } }));
    expect(await probeQuota("minimax", { api_key: API_KEY }, fetchImpl as unknown as typeof fetch)).toBeNull();
  });

  it("aborts a hung fetch after 5s and returns null", async () => {
    vi.useFakeTimers();
    // A stub that never resolves on its own — it only settles when the
    // probe's own AbortController fires, exactly like a hung socket would
    // under undici's signal handling.
    const fetchImpl = vi.fn(
      (_url: unknown, init?: RequestInit) =>
        new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener("abort", () => reject(new DOMException("The operation was aborted.", "AbortError")));
        }),
    );

    const pending = probeQuota("minimax", { api_key: API_KEY }, fetchImpl as unknown as typeof fetch);
    await vi.advanceTimersByTimeAsync(5_000);
    expect(await pending).toBeNull();
  });

  it("sends the key only as the Authorization header and never in the snapshot", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse(plausibleBody));
    const out = await probeQuota("minimax", { api_key: API_KEY }, fetchImpl as unknown as typeof fetch);

    expect(fetchImpl).toHaveBeenCalledTimes(1);
    const [url, init] = fetchImpl.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("https://api.minimax.io/v1/token_plan/remains");
    expect((init.headers as Record<string, string>).Authorization).toBe(`Bearer ${API_KEY}`);

    // The key must not survive into anything the caller might persist or log.
    expect(JSON.stringify(out)).not.toContain(API_KEY);
  });
});
