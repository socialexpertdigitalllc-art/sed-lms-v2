import { ProviderHttpError, isRateLimitError, isRetryableError } from "@/lib/ai-tools/providers/errors";
import { getGate } from "@/lib/ai-tools/providers/gate";
import { GATE_MAX_WAIT_MS, backoffDelayMs, type ProviderSpec } from "@/lib/ai-tools/run";
import { minimaxStatusToHttp } from "@/lib/assistant/stream";

/**
 * MiniMax image-01 (POST /v1/image_generation): one prompt in, PNG/JPEG bytes
 * out. It is the same MiniMax account as the chat models, so the key and the
 * rate gate are the provider's (lib/ai-tools/providers/config.ts) — a burst of
 * logos queues behind SED AI's chat calls instead of tripping the account's
 * limit for everyone.
 */

export const IMAGE_MODEL = "image-01";
/** Wide, for a horizontal logo (both sides must be multiples of 8, 512–2048). */
export const LOGO_WIDTH = 1536;
export const LOGO_HEIGHT = 640;
const CALL_TIMEOUT_MS = 120_000;
const MAX_ATTEMPTS = 3;

export interface ImageRequest {
  prompt: string;
  seed: number;
  width?: number;
  height?: number;
}

/** What MiniMax says, as a message a salesperson can act on. PURE. */
export function imageErrorMessage(status: number, vendor: string): string {
  if (status === 401) return "MiniMax refused the API key — check it under Admin → AI providers.";
  if (status === 402) return "The MiniMax plan has no image allowance left right now. It refills on the plan's schedule (or top up the account).";
  if (status === 429) return "MiniMax is busy right now. Try again in a minute.";
  if (status === 400 && /sensitive|flag|risk|1026|1027/i.test(vendor)) return "MiniMax flagged the request as sensitive. Try different wording.";
  if (status === 400) return `MiniMax rejected the request (${vendor || "bad request"}).`;
  return `MiniMax couldn't draw it (${vendor || `HTTP ${status}`}).`;
}

/** The image bytes out of a reply, or a ProviderHttpError. PURE; tested. */
export function parseImageReply(body: unknown, httpStatus: number): Buffer[] {
  const j = (body && typeof body === "object" ? body : {}) as {
    data?: { image_base64?: unknown; image_urls?: unknown };
    metadata?: { failed_count?: unknown };
    base_resp?: { status_code?: unknown; status_msg?: unknown };
  };
  const code = Number(j.base_resp?.status_code ?? 0);
  const msg = typeof j.base_resp?.status_msg === "string" ? j.base_resp.status_msg : "";
  if (httpStatus < 200 || httpStatus >= 300) {
    throw new ProviderHttpError(imageErrorMessage(httpStatus, msg), httpStatus, null, null);
  }
  if (code !== 0) {
    const status = minimaxStatusToHttp(code);
    throw new ProviderHttpError(imageErrorMessage(status, `${msg} (${code})`), status, null, null);
  }
  const list = Array.isArray(j.data?.image_base64) ? (j.data!.image_base64 as unknown[]) : [];
  const out = list.filter((s): s is string => typeof s === "string" && s.length > 100).map((s) => Buffer.from(s, "base64"));
  if (!out.length) {
    // failed_count = images its safety filter blocked (sent as a number or a string).
    if (Number(j.metadata?.failed_count ?? 0) > 0) throw new ProviderHttpError("MiniMax's safety filter blocked this drawing. Try different wording.", 400, null, null);
    throw new ProviderHttpError("MiniMax answered without an image. Try again.", 502, null, null);
  }
  return out;
}

/** The image endpoint on the provider's own host. */
export function imageEndpoint(spec: Pick<ProviderSpec, "endpoint">): string {
  return new URL("/v1/image_generation", spec.endpoint).toString();
}

const sleep = (ms: number, signal?: AbortSignal) =>
  new Promise<void>((resolve) => {
    const t = setTimeout(resolve, ms);
    signal?.addEventListener("abort", () => (clearTimeout(t), resolve()), { once: true });
  });

/**
 * Draw one image. Retries a busy or failed call (not a refusal) up to
 * MAX_ATTEMPTS, each attempt through the provider's rate gate.
 */
export async function drawImage(spec: ProviderSpec, req: ImageRequest, opts: { signal?: AbortSignal; fetchImpl?: typeof fetch } = {}): Promise<Buffer> {
  const doFetch = opts.fetchImpl ?? fetch;
  const gate = getGate(spec.providerKey ?? "minimax", spec.rateBudget);
  const body = JSON.stringify({
    model: IMAGE_MODEL,
    prompt: req.prompt,
    width: req.width ?? LOGO_WIDTH,
    height: req.height ?? LOGO_HEIGHT,
    response_format: "base64",
    seed: req.seed,
    n: 1,
    // Our prompt is already precise; the optimiser likes to add taglines.
    prompt_optimizer: false,
  });
  let lastError: unknown;
  let throttleCounted = false;
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    if (opts.signal?.aborted) throw new Error("Stopped.");
    // Nothing may sit between acquire and try (a leaked slot lowers the gate for good).
    const slot = await gate.acquire({ inputTokens: Math.ceil(req.prompt.length / 4), model: IMAGE_MODEL, maxTokens: 0 }, opts.signal, GATE_MAX_WAIT_MS);
    try {
      const timeout = AbortSignal.timeout(CALL_TIMEOUT_MS);
      const signal = opts.signal ? AbortSignal.any([opts.signal, timeout]) : timeout;
      const res = await doFetch(imageEndpoint(spec), {
        method: "POST",
        headers: { Authorization: `Bearer ${spec.apiKey}`, "Content-Type": "application/json" },
        body,
        signal,
      });
      const json = await res.json().catch(() => null);
      const images = parseImageReply(json, res.status);
      slot.settle(null);
      return images[0];
    } catch (e) {
      const throttled = isRateLimitError(e);
      slot.settleError(e, { sameCongestionEvent: throttled && throttleCounted });
      if (throttled) throttleCounted = true;
      lastError = e;
      if (opts.signal?.aborted) throw new Error("Stopped.");
      const retryable = throttled || isRetryableError(e) || (e instanceof Error && /timeout|aborted|network|fetch failed/i.test(e.message));
      if (!retryable || attempt === MAX_ATTEMPTS) break;
      await sleep(Math.max(1500, backoffDelayMs(attempt, e)), opts.signal);
    }
  }
  if (lastError instanceof ProviderHttpError) throw lastError;
  const m = lastError instanceof Error ? lastError.message : String(lastError);
  throw new Error(/timeout|aborted/i.test(m) ? "MiniMax took too long to draw it. Try again." : `MiniMax couldn't be reached (${m}).`);
}
