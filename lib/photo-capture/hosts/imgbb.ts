import { classifyUploadError } from "./errors";
import type { UploadAdapter, UploadResult, UploadSource } from "./types";

/**
 * imgbb: POST https://api.imgbb.com/1/upload?key=KEY
 *
 * The `image` field accepts an image URL, so imgbb fetches the original from
 * Google itself — this path transfers no bytes through us. Max 32 MB.
 * imgbb publishes NO rate limit, so exhaustion is only ever detected from a
 * response (see errors.ts).
 */
const ENDPOINT = "https://api.imgbb.com/1/upload";

export const imgbbAdapter: UploadAdapter = {
  provider: "imgbb",
  needsCredentials: true,

  isConfigured(credentials) {
    return !!credentials?.api_key?.trim();
  },

  async upload(source: UploadSource, ctx): Promise<UploadResult> {
    const key = ctx.credentials?.api_key?.trim();
    if (!key) return { ok: false, reason: "auth", message: "No imgbb API key configured" };

    const form = new FormData();
    form.append("image", source.url);
    form.append("name", source.filename.replace(/\.[a-z0-9]+$/i, ""));

    let resp: Response;
    try {
      resp = await fetch(`${ENDPOINT}?key=${encodeURIComponent(key)}`, { method: "POST", body: form });
    } catch (e) {
      return { ok: false, reason: "error", message: e instanceof Error ? e.message : "Network error" };
    }

    const body = (await resp.json().catch(() => null)) as
      | { success?: boolean; data?: { url?: string }; error?: { message?: string }; status_txt?: string }
      | null;

    const directUrl = body?.data?.url;
    if (resp.ok && body?.success !== false && directUrl) return { ok: true, directUrl };

    const message = body?.error?.message ?? body?.status_txt ?? `HTTP ${resp.status}`;
    return { ok: false, reason: classifyUploadError({ status: resp.status, message }), message };
  },
};
