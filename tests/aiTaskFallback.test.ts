// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from "vitest";
import { ProviderHttpError } from "@/lib/ai-tools/providers/errors";

/**
 * `callForTask` retries a failed call on the task's DEFAULT provider. That is
 * right for a configuration failure and wrong for a rate limit — see the
 * comment this file exists to protect, in providers/run.ts.
 */

const callWithProvider = vi.fn();
vi.mock("@/lib/ai-tools/run", () => ({ callWithProvider }));

// Minimal routing stub: an assigned provider that is NOT the task default, so
// a fallback would be observable as a second call with different arguments.
vi.mock("@/lib/ai-tools/providers/config", () => ({
  resolveTaskModel: vi.fn(async () => ({
    providerKey: "minimax",
    model: "MiniMax-M3",
    spec: { label: "MiniMax M3", endpoint: "https://api.minimax.io/v1/chat/completions", apiKey: "k", maxOutputTokens: 1000 },
    outputTokens: 1000,
    usedFallback: false,
    fallbackReason: null,
  })),
  defaultSpecForTask: vi.fn(async () => ({
    providerKey: "gemini",
    model: "gemini-3.1-pro-preview",
    spec: { label: "Gemini", endpoint: "https://generativelanguage.googleapis.com/v1beta/openai/chat/completions", apiKey: "k", maxOutputTokens: 1000 },
    outputTokens: 1000,
    usedFallback: true,
    fallbackReason: null,
  })),
}));

describe("callForTask fallback", () => {
  beforeEach(async () => {
    callWithProvider.mockReset();
    const { clearTaskModelCache } = await import("@/lib/ai-tools/providers/run");
    clearTaskModelCache();
  });

  it("throws a 429 straight through instead of rerouting to another model", async () => {
    const { callForTask } = await import("@/lib/ai-tools/providers/run");
    callWithProvider.mockRejectedValue(new ProviderHttpError("rate limited", 429, null, null));

    await expect(callForTask("site_build", "s", "u", { maxTokens: 100, temperature: 0 })).rejects.toBeInstanceOf(
      ProviderHttpError,
    );
    expect(callWithProvider).toHaveBeenCalledTimes(1);
  });

  it("throws a transient 503 through too — its retries already happened downstream", async () => {
    const { callForTask } = await import("@/lib/ai-tools/providers/run");
    callWithProvider.mockRejectedValue(new ProviderHttpError("upstream down", 503, null, null));

    await expect(callForTask("site_build", "s", "u", { maxTokens: 100, temperature: 0 })).rejects.toBeInstanceOf(
      ProviderHttpError,
    );
    expect(callWithProvider).toHaveBeenCalledTimes(1);
  });

  it("still falls back when the assigned model is misconfigured", async () => {
    const { callForTask } = await import("@/lib/ai-tools/providers/run");
    callWithProvider
      .mockRejectedValueOnce(new ProviderHttpError("model not found", 404, null, null))
      .mockResolvedValueOnce({ text: "ok", tokens: 1 });

    const out = await callForTask("site_build", "s", "u", { maxTokens: 100, temperature: 0 });
    expect(out.text).toBe("ok");
    expect(out.providerKey).toBe("gemini");
    expect(callWithProvider).toHaveBeenCalledTimes(2);
  });
});
