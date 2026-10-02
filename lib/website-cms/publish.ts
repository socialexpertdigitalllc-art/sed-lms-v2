import { getWebsiteSettings } from "./settings";
import { WEBSITE_TAGS, type WebsiteTag } from "./types";

export type PublishResult =
  | { ok: true; tags: string[] }
  | { ok: false; error: string };

/**
 * Tell the live website to drop its ISR cache for the given tags (all of
 * them when omitted). Failure is reported, never thrown — the site falls
 * back to its 5-minute revalidate window, so a missed ping only delays
 * the edit, it can't lose it.
 */
export async function notifyWebsite(tags?: WebsiteTag[]): Promise<PublishResult> {
  const settings = await getWebsiteSettings();
  if (!settings.revalidate_url || !settings.revalidate_secret) {
    return { ok: false, error: "Publish hook not configured (set the revalidate URL + secret in Website → Settings)." };
  }
  const body = {
    secret: settings.revalidate_secret,
    tags: tags && tags.length > 0 ? tags : [...WEBSITE_TAGS],
  };
  try {
    const res = await fetch(settings.revalidate_url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(8_000),
    });
    if (!res.ok) {
      return { ok: false, error: `Website answered HTTP ${res.status} — check the revalidate secret.` };
    }
    return { ok: true, tags: body.tags };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "Could not reach the website." };
  }
}
