import { randomBytes } from "crypto";
import { classifyUploadError } from "./errors";
import type { UploadAdapter, UploadResult, UploadSource } from "./types";

/**
 * postimages has NO public API and NO API keys (see the design, §8). This is
 * the undocumented browser endpoint: scrape a token from the homepage, POST the
 * bytes to /json/rr, then read the direct URL out of the returned page's
 * og:image meta tag.
 *
 * RECORDED RISK: undocumented, and can change without notice. It sits in the
 * middle of the chain so its failure degrades to imgchest. Both parsers are
 * pure and tested, so a markup change is a one-function fix.
 */
const HOME = "https://postimages.org/";
const UPLOAD = "https://postimages.org/json/rr";

/** Reads the upload token from either a hidden input or an inline script. */
export function parsePostimagesToken(html: string): string | null {
  const input = html.match(/name=["']token["']\s+value=["']([A-Za-z0-9]+)["']/i);
  if (input) return input[1];
  const script = html.match(/token\s*[:=]\s*["']([A-Za-z0-9]{8,})["']/i);
  return script ? script[1] : null;
}

/** Reads the direct image URL from a postimages view page. */
export function parseOgImage(html: string): string | null {
  const m = html.match(/<meta\s+property=["']og:image["']\s+content=["']([^"']+)["']/i);
  return m ? m[1] : null;
}

export const postimagesAdapter: UploadAdapter = {
  provider: "postimages",
  needsCredentials: false,

  isConfigured() {
    return true;
  },

  async upload(source: UploadSource): Promise<UploadResult> {
    try {
      const homeResp = await fetch(HOME, { headers: { "user-agent": "Mozilla/5.0" } });
      const token = parsePostimagesToken(await homeResp.text());
      if (!token) {
        return { ok: false, reason: "error", message: "Could not read an upload token from postimages.org" };
      }

      const buf = await source.fetchBytes();
      const form = new FormData();
      form.append("token", token);
      form.append("upload_session", randomBytes(16).toString("hex"));
      form.append("numfiles", "1");
      form.append("optsize", "0");
      form.append("expire", "0");
      form.append("session_upload", String(Date.now()));
      form.append("file", new Blob([new Uint8Array(buf)], { type: "image/jpeg" }), source.filename);

      const upResp = await fetch(UPLOAD, {
        method: "POST",
        headers: { "x-requested-with": "XMLHttpRequest" },
        body: form,
      });
      const body = (await upResp.json().catch(() => null)) as { status?: string; url?: string; error?: string } | null;

      if (!upResp.ok || body?.status !== "OK" || !body?.url) {
        const message = body?.error ?? `HTTP ${upResp.status}`;
        return { ok: false, reason: classifyUploadError({ status: upResp.status, message }), message };
      }

      const viewResp = await fetch(body.url, { headers: { "user-agent": "Mozilla/5.0" } });
      const directUrl = parseOgImage(await viewResp.text());
      if (!directUrl) {
        return { ok: false, reason: "error", message: "Uploaded, but could not read the direct URL from postimages" };
      }
      return { ok: true, directUrl };
    } catch (e) {
      return { ok: false, reason: "error", message: e instanceof Error ? e.message : "Network error" };
    }
  },
};
