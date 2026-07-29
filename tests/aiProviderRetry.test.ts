// @vitest-environment node
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { callWithProvider, type ProviderSpec } from "@/lib/ai-tools/run";
import { ProviderHttpError } from "@/lib/ai-tools/providers/errors";
import { resetGates } from "@/lib/ai-tools/providers/gate";

const spec: ProviderSpec = {
  label: "Test Provider m1",
  endpoint: "https://api.example.com/v1/chat/completions",
  apiKey: "k",
  maxOutputTokens: 8000,
  providerKey: "testprov",
};

function jsonResponse(body: unknown, init?: { status?: number; headers?: Record<string, string> }): Response {
  return new Response(JSON.stringify(body), {
    status: init?.status ?? 200,
    headers: { "content-type": "application/json", ...(init?.headers ?? {}) },
  });
}

const okBody = {
  choices: [{ message: { content: "hello" } }],
  usage: { prompt_tokens: 100, completion_tokens: 50, total_tokens: 150 },
};

describe("callWithProvider error typing", () => {
  beforeEach(() => resetGates());
  afterEach(() => vi.restoreAllMocks());

  it("throws ProviderHttpError carrying the status and Retry-After", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      jsonResponse({ error: { message: "rate limit exceeded" } }, { status: 429, headers: { "retry-after": "7" } }),
    );

    const err = await callWithProvider(spec, "m1", "sys", "user", { maxTokens: 100, temperature: 0, maxAttempts: 1 }).catch(
      (e) => e,
    );

    expect(err).toBeInstanceOf(ProviderHttpError);
    expect((err as ProviderHttpError).status).toBe(429);
    expect((err as ProviderHttpError).retryAfterMs).toBe(7000);
    expect((err as Error).message).toBe("rate limit exceeded");
  });

  it("captures x-ratelimit headers when the vendor sends them", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      jsonResponse(
        { error: { message: "quota" } },
        { status: 429, headers: { "x-ratelimit-limit": "500", "x-ratelimit-remaining": "0" } },
      ),
    );

    const err = (await callWithProvider(spec, "m1", "s", "u", {
      maxTokens: 100,
      temperature: 0,
      maxAttempts: 1,
    }).catch((e) => e)) as ProviderHttpError;

    expect(err.rateLimit).toEqual({ limit: 500, remaining: 0 });
  });

  it("still succeeds normally", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(jsonResponse(okBody));
    const out = await callWithProvider(spec, "m1", "s", "u", { maxTokens: 100, temperature: 0 });
    expect(out).toEqual({ text: "hello", tokens: 150 });
  });
});
