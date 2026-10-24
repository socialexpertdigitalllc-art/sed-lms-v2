import { ProviderHttpError, isRateLimitError, isRetryableError } from "@/lib/ai-tools/providers/errors";
import { getGate } from "@/lib/ai-tools/providers/gate";
import { GATE_MAX_WAIT_MS, backoffDelayMs, type ProviderSpec } from "@/lib/ai-tools/run";

/**
 * Google's image models through the Gemini API (generateContent) — the same
 * API key the LMS already uses for Gemini text. Nano Banana Pro
 * (gemini-3-pro-image) is Google's model for professional assets: it designs a
 * complete logo, lettering included, and it can EDIT a design ("make the
 * symbol bigger", "fix the spelling") while keeping the rest of it.
 *
 * Model IDs move (preview → stable, new versions), so the call walks a list
 * and remembers the first one the key can use. Billing is per picture, on the
 * Google Cloud project the key belongs to — not the Google AI Pro plan.
 */

export const GEMINI_IMAGE_MODELS = ["gemini-3-pro-image", "gemini-3-pro-image-preview", "gemini-nano-banana-2.1", "gemini-3.1-flash-image", "gemini-3.1-flash-image-preview"];
const BASE = "https://generativelanguage.googleapis.com/v1beta/models";
const CALL_TIMEOUT_MS = 180_000;
const MAX_ATTEMPTS = 3;

export interface GeminiImageRequest {
  prompt: string;
  /** A picture to edit (PNG). */
  image?: Buffer | null;
  aspectRatio?: string;
  imageSize?: "1K" | "2K" | "4K";
}

export type GeminiImageKey = Pick<ProviderSpec, "apiKey" | "providerKey" | "rateBudget">;

/** The generateContent body. `config` drops settings a model refused. PURE. */
export function geminiImageBody(req: GeminiImageRequest, config: "full" | "ratio" | "none" = "full"): Record<string, unknown> {
  const parts: Record<string, unknown>[] = [];
  if (req.image) parts.push({ inline_data: { mime_type: "image/png", data: req.image.toString("base64") } });
  parts.push({ text: req.prompt });
  const imageConfig: Record<string, string> = {};
  if (config !== "none" && req.aspectRatio) imageConfig.aspectRatio = req.aspectRatio;
  if (config === "full" && req.imageSize) imageConfig.imageSize = req.imageSize;
  return {
    contents: [{ role: "user", parts }],
    generationConfig: { responseModalities: ["TEXT", "IMAGE"], ...(Object.keys(imageConfig).length ? { imageConfig } : {}) },
  };
}

const SAFETY = /SAFETY|PROHIBITED|BLOCKLIST|SPII|RECITATION/i;

/** Google's answer as a message a salesperson can act on. PURE. */
export function geminiErrorMessage(status: number, message: string): string {
  const m = message || `HTTP ${status}`;
  if (/API key not valid|API_KEY_INVALID|API key expired/i.test(m)) return "Google refused the Gemini API key — check it under Admin → AI providers.";
  if (status === 429 && /free.?tier|limit: ?0/i.test(m)) return "Google's image models need billing switched on for the Gemini API key's Google Cloud project (the free tier has no image quota).";
  if (status === 429) return "Google is busy right now (rate limit). Try again in a minute.";
  if (status === 403 && /billing/i.test(m)) return "Google's image models need billing switched on for the Gemini API key's Google Cloud project.";
  if (status === 403) return `Google refused the request (${m}).`;
  if (status === 400 && SAFETY.test(m)) return "Google's safety filter blocked this design. Try different wording.";
  if (status === 400) return `Google rejected the request (${m}).`;
  return `Google couldn't draw it (${m}).`;
}

/** A model this key can't use (doesn't exist for it, or not on generateContent). PURE. */
export function isModelUnavailable(status: number, message: string): boolean {
  return status === 404 || (status === 400 && /not found|not supported|is not available|unsupported model|does not support/i.test(message));
}

/** A request setting the model refused (imageSize / imageConfig). PURE. */
export function isConfigRefused(status: number, message: string): boolean {
  return status === 400 && /image_?size|image_?config|imageSize|imageConfig|aspect_?ratio|aspectRatio|Unknown name/i.test(message);
}

interface Part {
  text?: string;
  thought?: boolean;
  inlineData?: { mimeType?: string; data?: string };
  inline_data?: { mime_type?: string; data?: string };
}

/** The final picture out of a reply (thinking drafts skipped), or a ProviderHttpError. PURE. */
export function parseGeminiImageReply(body: unknown, httpStatus: number): Buffer {
  const j = (body && typeof body === "object" ? body : {}) as {
    candidates?: { content?: { parts?: Part[] }; finishReason?: string; finishMessage?: string }[];
    promptFeedback?: { blockReason?: string };
    error?: { code?: number; message?: string; status?: string };
  };
  if (httpStatus < 200 || httpStatus >= 300 || j.error) {
    const status = httpStatus >= 300 ? httpStatus : (j.error?.code ?? 500);
    const message = j.error?.message ?? "";
    throw new ProviderHttpError(geminiErrorMessage(status, message), status, null, null);
  }
  const cand = j.candidates?.[0];
  const parts = cand?.content?.parts ?? [];
  const images = parts.filter((p) => !p.thought && (p.inlineData?.data || p.inline_data?.data));
  const last = images[images.length - 1];
  const data = last?.inlineData?.data ?? last?.inline_data?.data;
  if (data) return Buffer.from(data, "base64");
  const reason = j.promptFeedback?.blockReason ?? cand?.finishReason ?? "";
  if (SAFETY.test(reason)) throw new ProviderHttpError("Google's safety filter blocked this design. Try different wording.", 400, null, null);
  const said = parts.map((p) => (p.thought ? "" : (p.text ?? ""))).join(" ").trim();
  throw new ProviderHttpError(`Google answered without a picture${said ? ` ("${said.slice(0, 120)}")` : reason ? ` (${reason})` : ""}. Try again.`, 502, null, null);
}

const sleep = (ms: number, signal?: AbortSignal) =>
  new Promise<void>((resolve) => {
    const t = setTimeout(resolve, ms);
    signal?.addEventListener("abort", () => (clearTimeout(t), resolve()), { once: true });
  });

/** The first model on the list this key could use — tried first next time. */
let workingModel: string | null = null;
export function resetGeminiImageModel() {
  workingModel = null;
}

/** One picture from Google (a new design, or an edit of `req.image`). */
export async function geminiImage(
  key: GeminiImageKey,
  req: GeminiImageRequest,
  opts: { models?: string[]; signal?: AbortSignal; fetchImpl?: typeof fetch } = {},
): Promise<{ png: Buffer; model: string }> {
  const doFetch = opts.fetchImpl ?? fetch;
  const listed = opts.models ?? GEMINI_IMAGE_MODELS;
  const models = workingModel && listed.includes(workingModel) ? [workingModel, ...listed.filter((m) => m !== workingModel)] : listed;
  const gate = getGate(key.providerKey ?? "gemini", key.rateBudget);
  let lastError: unknown = null;

  for (const model of models) {
    let config: "full" | "ratio" | "none" = "full";
    let throttleCounted = false;
    for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
      if (opts.signal?.aborted) throw new Error("Stopped.");
      // Nothing may sit between acquire and try (a leaked slot lowers the gate for good).
      const slot = await gate.acquire({ inputTokens: Math.ceil(req.prompt.length / 4) + (req.image ? 1600 : 0), model, maxTokens: 0 }, opts.signal, GATE_MAX_WAIT_MS);
      try {
        const timeout = AbortSignal.timeout(CALL_TIMEOUT_MS);
        const res = await doFetch(`${BASE}/${model}:generateContent`, {
          method: "POST",
          headers: { "x-goog-api-key": key.apiKey, "Content-Type": "application/json" },
          body: JSON.stringify(geminiImageBody(req, config)),
          signal: opts.signal ? AbortSignal.any([opts.signal, timeout]) : timeout,
        });
        const json = await res.json().catch(() => null);
        const png = parseGeminiImageReply(json, res.status);
        slot.settle(null);
        workingModel = model;
        return { png, model };
      } catch (e) {
        const throttled = isRateLimitError(e);
        slot.settleError(e, { sameCongestionEvent: throttled && throttleCounted });
        if (throttled) throttleCounted = true;
        lastError = e;
        if (opts.signal?.aborted) throw new Error("Stopped.");
        const status = e instanceof ProviderHttpError ? e.status : 0;
        const raw = e instanceof ProviderHttpError ? e.message : "";
        if (e instanceof ProviderHttpError && isModelUnavailable(status, raw)) break; // next model
        if (e instanceof ProviderHttpError && config !== "none" && /rejected the request/.test(raw) && isConfigRefused(status, raw)) {
          config = config === "full" ? "ratio" : "none"; // drop the setting it refused, same model
          attempt--;
          continue;
        }
        const retryable = throttled || isRetryableError(e) || (e instanceof Error && /timeout|aborted|network|fetch failed/i.test(e.message));
        if (!retryable) throw e;
        if (attempt === MAX_ATTEMPTS) break;
        await sleep(Math.max(2000, backoffDelayMs(attempt, e)), opts.signal);
      }
    }
    // A busy or failing model: the next one on the list may do.
    if (lastError instanceof ProviderHttpError && !isModelUnavailable(lastError.status, lastError.message) && !isRetryableError(lastError)) throw lastError;
  }
  if (lastError instanceof ProviderHttpError) {
    if (isModelUnavailable(lastError.status, lastError.message)) throw new ProviderHttpError("None of Google's image models is available to this Gemini API key.", 404, null, null);
    throw lastError;
  }
  const m = lastError instanceof Error ? lastError.message : String(lastError);
  throw new Error(/timeout|aborted/i.test(m) ? "Google took too long to draw it. Try again." : `Google couldn't be reached (${m}).`);
}
