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
/** The undocumented endpoint rejects requests with an empty/absent user-agent. */
const BROWSER_UA = "Mozilla/5.0";

/** Reads the upload token from either a hidden input or an inline script. */
export function parsePostimagesToken(html: string): string | null {
  // Attribute order is not guaranteed (e.g. an `id` attribute could sit between
  // `name` and `value`), so match the TAG first and read its attributes
  // independently rather than assuming `name` precedes `value`.
  for (const tag of html.match(/<input\b[^>]*>/gi) ?? []) {
    if (!/name=["']token["']/i.test(tag)) continue;
    const m = tag.match(/value=["']([A-Za-z0-9]+)["']/i);
    if (m) return m[1];
  }
  // Boundary before `token` so this cannot match inside `csrftoken`, `xsrfToken`,
  // `authtoken`, etc. — a wrong-but-plausible token fails the upload for an
  // unexplained reason, which is worse than failing to find one at all.
  const script = html.match(/(?:^|[^A-Za-z0-9_])token\s*[:=]\s*["']([A-Za-z0-9]{8,})["']/i);
  return script ? script[1] : null;
}

/** Reads the direct image URL from a postimages view page. */
export function parseOgImage(html: string): string | null {
  // Attribute order is not guaranteed, so match the TAG first and read its
  // attributes independently rather than assuming property precedes content.
  for (const tag of html.match(/<meta\b[^>]*>/gi) ?? []) {
    if (!/property=["']og:image["']/i.test(tag)) continue;
    const m = tag.match(/content=["']([^"']+)["']/i);
    if (m) return m[1];
  }
  return null;
}

export const postimagesAdapter: UploadAdapter = {
  provider: "postimages",
  needsCredentials: false,

  isConfigured() {
    return true;
  },

  async upload(source: UploadSource): Promise<UploadResult> {
    try {
      const homeResp = await fetch(HOME, { headers: { "user-agent": BROWSER_UA } });
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
      // Captured photos are always Google-sourced JPEGs, so the MIME type is
      // known rather than guessed.
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

      const viewResp = await fetch(body.url, { headers: { "user-agent": BROWSER_UA } });
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
