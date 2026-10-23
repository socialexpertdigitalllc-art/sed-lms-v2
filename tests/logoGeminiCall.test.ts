// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from "vitest";
import { GEMINI_IMAGE_MODELS, geminiErrorMessage, geminiImage, geminiImageBody, parseGeminiImageReply, resetGeminiImageModel } from "@/lib/logos/geminiImage";
import { resetGates } from "@/lib/ai-tools/providers/gate";
import { ProviderHttpError } from "@/lib/ai-tools/providers/errors";

/**
 * Google's image model through the Gemini API key: a complete logo, or an
 * edit of one. The request follows generateContent; the call finds a model
 * the key can use, retries only when retrying can help, and speaks plainly
 * when Google says no.
 */

const key = { apiKey: "AIza-test", providerKey: "gemini" };
const png = Buffer.from("p".repeat(300));
const ok = (parts: unknown[] = [{ inlineData: { mimeType: "image/png", data: png.toString("base64") } }]) => Response.json({ candidates: [{ content: { parts }, finishReason: "STOP" }] });
const err = (code: number, message: string) => Response.json({ error: { code, message, status: "X" } }, { status: code });

beforeEach(() => {
  resetGates();
  resetGeminiImageModel();
});

describe("the request", () => {
  it("is generateContent with the key in a header: the prompt (and a picture to edit), wide, 2K, image out", async () => {
    const fetchImpl = vi.fn(async () => ok());
    const out = await geminiImage(key, { prompt: 'Design a logo for "ABC"', image: Buffer.from("old"), aspectRatio: "16:9", imageSize: "2K" }, { fetchImpl });
    expect(out).toEqual({ png, model: GEMINI_IMAGE_MODELS[0] });
    const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("https://generativelanguage.googleapis.com/v1beta/models/gemini-3-pro-image:generateContent");
    expect((init.headers as Record<string, string>)["x-goog-api-key"]).toBe("AIza-test");
    expect(url).not.toContain("AIza"); // never in the URL (logs)
    expect(JSON.parse(String(init.body))).toEqual({
      contents: [{ role: "user", parts: [{ inline_data: { mime_type: "image/png", data: Buffer.from("old").toString("base64") } }, { text: 'Design a logo for "ABC"' }] }],
      generationConfig: { responseModalities: ["TEXT", "IMAGE"], imageConfig: { aspectRatio: "16:9", imageSize: "2K" } },
    });
  });

  it("can drop the settings a model refuses", () => {
    expect(geminiImageBody({ prompt: "p", aspectRatio: "16:9", imageSize: "2K" }, "ratio").generationConfig).toEqual({ responseModalities: ["TEXT", "IMAGE"], imageConfig: { aspectRatio: "16:9" } });
    expect(geminiImageBody({ prompt: "p", aspectRatio: "16:9", imageSize: "2K" }, "none").generationConfig).toEqual({ responseModalities: ["TEXT", "IMAGE"] });
  });
});

describe("the reply", () => {
  it("takes the final picture — never a thinking draft — in either JSON spelling", () => {
    const draft = Buffer.from("d".repeat(200)).toString("base64");
    expect(parseGeminiImageReply({ candidates: [{ content: { parts: [{ text: "here", thought: true }, { inlineData: { data: draft }, thought: true }, { inlineData: { data: png.toString("base64") } }] } }] }, 200)).toEqual(png);
    expect(parseGeminiImageReply({ candidates: [{ content: { parts: [{ inline_data: { mime_type: "image/png", data: png.toString("base64") } }] } }] }, 200)).toEqual(png);
    // only a thinking draft came back: that is not a design
    expect(() => parseGeminiImageReply({ candidates: [{ content: { parts: [{ inlineData: { data: draft }, thought: true }] } }] }, 200)).toThrow(/answered without a picture/);
  });

  it("no picture: blocked → safety message; otherwise what it said", () => {
    const fail = (body: unknown, status = 200) => {
      try {
        parseGeminiImageReply(body, status);
      } catch (e) {
        return e as ProviderHttpError;
      }
      throw new Error("no error");
    };
    expect(fail({ promptFeedback: { blockReason: "SAFETY" } }).message).toMatch(/safety filter/);
    expect(fail({ candidates: [{ finishReason: "IMAGE_SAFETY", content: { parts: [] } }] }).message).toMatch(/safety filter/);
    expect(fail({ candidates: [{ content: { parts: [{ text: "I can't draw that" }] } }] })).toMatchObject({ status: 502, message: expect.stringMatching(/I can't draw that/) });
    expect(fail({ error: { code: 400, message: "API key not valid. Please pass a valid API key." } }, 400).message).toMatch(/refused the Gemini API key/);
  });

  it("Google's refusals become messages a salesperson can act on", () => {
    expect(geminiErrorMessage(429, "Quota exceeded for metric: generate_content_free_tier_requests, limit: 0")).toMatch(/need billing switched on/);
    expect(geminiErrorMessage(429, "Resource has been exhausted")).toMatch(/busy right now/);
    expect(geminiErrorMessage(403, "This API method requires billing to be enabled")).toMatch(/need billing switched on/);
    expect(geminiErrorMessage(400, "Request contains an invalid argument.")).toMatch(/rejected the request/);
  });
});

describe("finding a model and retrying", () => {
  it("a model the key can't use → the next on the list, which is then tried first", async () => {
    const fetchImpl = vi.fn(async (url: RequestInfo | URL) => (String(url).includes("/gemini-3-pro-image:") ? err(404, "models/gemini-3-pro-image is not found for API version v1beta") : ok()));
    expect((await geminiImage(key, { prompt: "p" }, { fetchImpl })).model).toBe("gemini-3-pro-image-preview");
    await geminiImage(key, { prompt: "p" }, { fetchImpl });
    expect(String(fetchImpl.mock.calls[2][0])).toContain("/gemini-3-pro-image-preview:");
  });

  it("a setting the model refuses is dropped, same model", async () => {
    let n = 0;
    const fetchImpl = vi.fn(async () => (++n === 1 ? err(400, 'Invalid JSON payload received. Unknown name "imageSize" at \'generation_config.image_config\'') : ok()));
    expect((await geminiImage(key, { prompt: "p", aspectRatio: "16:9", imageSize: "2K" }, { fetchImpl })).model).toBe("gemini-3-pro-image");
    expect(JSON.parse(String((fetchImpl.mock.calls[1] as unknown as [string, RequestInit])[1].body)).generationConfig.imageConfig).toEqual({ aspectRatio: "16:9" });
  });

  it("busy → waits and retries; a bad key → stops at once", async () => {
    const busy = vi.fn().mockResolvedValueOnce(err(429, "Resource has been exhausted")).mockResolvedValueOnce(ok());
    expect((await geminiImage(key, { prompt: "p" }, { fetchImpl: busy })).png).toEqual(png);
    expect(busy).toHaveBeenCalledTimes(2);
    const bad = vi.fn(async () => err(400, "API key not valid. Please pass a valid API key."));
    await expect(geminiImage(key, { prompt: "p" }, { fetchImpl: bad })).rejects.toThrow(/refused the Gemini API key/);
    expect(bad).toHaveBeenCalledTimes(1);
  }, 20_000);

  it("no model on the list is available → says so", async () => {
    const fetchImpl = vi.fn(async () => err(404, "not found"));
    await expect(geminiImage(key, { prompt: "p" }, { fetchImpl })).rejects.toThrow(/None of Google's image models is available/);
    expect(fetchImpl).toHaveBeenCalledTimes(GEMINI_IMAGE_MODELS.length);
  });
});
