// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from "vitest";
import { drawImage, IMAGE_MODEL, LOGO_HEIGHT, LOGO_WIDTH } from "@/lib/logos/minimaxImage";
import { resetGates } from "@/lib/ai-tools/providers/gate";
import type { ProviderSpec } from "@/lib/ai-tools/run";

/** The call to MiniMax image-01: exactly what the API documents, retried only when retrying can help. */

const spec = { label: "MiniMax", endpoint: "https://api.minimax.io/v1/chat/completions", apiKey: "sk-test", maxOutputTokens: 1000, providerKey: "minimax" } as ProviderSpec;
const png = Buffer.from("p".repeat(300));
const ok = () => Response.json({ data: { image_base64: [png.toString("base64")] }, metadata: { success_count: "1", failed_count: "0" }, base_resp: { status_code: 0, status_msg: "success" } });

beforeEach(() => resetGates());

describe("drawImage", () => {
  it("asks for one wide base64 image with our exact prompt and seed (no prompt optimiser — it adds taglines)", async () => {
    const fetchImpl = vi.fn(async () => ok());
    expect(await drawImage(spec, { prompt: 'A logo for "ABC"', seed: 99 }, { fetchImpl })).toEqual(png);
    const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("https://api.minimax.io/v1/image_generation");
    expect((init.headers as Record<string, string>).Authorization).toBe("Bearer sk-test");
    expect(JSON.parse(String(init.body))).toEqual({ model: IMAGE_MODEL, prompt: 'A logo for "ABC"', width: LOGO_WIDTH, height: LOGO_HEIGHT, response_format: "base64", seed: 99, n: 1, prompt_optimizer: false });
    expect(LOGO_WIDTH / LOGO_HEIGHT).toBeGreaterThan(2);
    expect(LOGO_WIDTH % 8 + (LOGO_HEIGHT % 8)).toBe(0);
  });

  it("a rate limit is waited out and retried", async () => {
    const fetchImpl = vi.fn().mockResolvedValueOnce(Response.json({ base_resp: { status_code: 1002, status_msg: "rate limit" } })).mockResolvedValueOnce(ok());
    expect(await drawImage(spec, { prompt: "p", seed: 1 }, { fetchImpl })).toEqual(png);
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  }, 15_000);

  it("a refusal (sensitive, no allowance, bad key) is not retried", async () => {
    for (const code of [1026, 1008, 2049]) {
      const fetchImpl = vi.fn(async () => Response.json({ base_resp: { status_code: code, status_msg: "no" } }));
      await expect(drawImage(spec, { prompt: "p", seed: 1 }, { fetchImpl })).rejects.toThrow();
      expect(fetchImpl).toHaveBeenCalledTimes(1);
    }
  });

  it("a network failure becomes a plain message after the retries", async () => {
    const fetchImpl = vi.fn(async () => {
      throw new TypeError("fetch failed");
    });
    await expect(drawImage(spec, { prompt: "p", seed: 1 }, { fetchImpl })).rejects.toThrow(/MiniMax couldn't be reached/);
    expect(fetchImpl).toHaveBeenCalledTimes(3);
  }, 20_000);
});
