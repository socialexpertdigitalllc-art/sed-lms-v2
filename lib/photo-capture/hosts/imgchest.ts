import { classifyUploadError } from "./errors";
import type { UploadAdapter, UploadResult, UploadSource } from "./types";

/**
 * imgchest: POST https://api.imgchest.com/v1/post
 * Bearer personal access token, multipart `images[]` (max 20 per post).
 * Documented limit: 60 requests/minute, reported via X-RateLimit-Remaining —
 * the only host that warns us before the wall.
 * Each image comes back as https://cdn.imgchest.com/files/{id}.{ext}
 */
const ENDPOINT = "https://api.imgchest.com/v1/post";

export const imgchestAdapter: UploadAdapter = {
  provider: "imgchest",
  needsCredentials: true,

  isConfigured(credentials) {
    return !!credentials?.token?.trim();
  },

  async upload(source: UploadSource, ctx): Promise<UploadResult> {
    const token = ctx.credentials?.token?.trim();
    if (!token) return { ok: false, reason: "auth", message: "No imgchest token configured" };

    let form: FormData;
    try {
      const buf = await source.fetchBytes();
      form = new FormData();
      form.append("images[]", new Blob([new Uint8Array(buf)], { type: "image/jpeg" }), source.filename);
      form.append("privacy", "hidden");
    } catch (e) {
      return { ok: false, reason: "error", message: e instanceof Error ? e.message : "Could not read the source image" };
    }

    let resp: Response;
    try {
      resp = await fetch(ENDPOINT, { method: "POST", headers: { Authorization: `Bearer ${token}` }, body: form });
    } catch (e) {
      return { ok: false, reason: "error", message: e instanceof Error ? e.message : "Network error" };
    }

    const remaining = resp.headers.get("x-ratelimit-remaining");
    const body = (await resp.json().catch(() => null)) as
      | { data?: { images?: { link?: string }[] }; message?: string }
      | null;

    const directUrl = body?.data?.images?.[0]?.link;
    if (resp.ok && directUrl) return { ok: true, directUrl };

    const message = body?.message ?? `HTTP ${resp.status}`;
    return {
      ok: false,
      reason: classifyUploadError({ status: resp.status, message, rateLimitRemaining: remaining }),
      message,
    };
  },
};
