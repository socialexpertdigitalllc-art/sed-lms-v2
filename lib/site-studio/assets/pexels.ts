import type { ImageCandidate } from "./types";

interface PexelsOpts {
  apiKey?: string;              // default process.env.PEXELS_API_KEY
  perPage?: number;             // default 9
  fetchImpl?: typeof fetch;     // default global fetch
  delayMs?: number;             // backoff base, default 400 (tests pass 0)
}
export type PexelsResult =
  | { ok: true; candidates: Extract<ImageCandidate, { kind: "pexels" }>[] }
  | { ok: false; error: string };

/** Pexels search. Contract carried over from the v2 integration (verified in
 *  prod): raw key in Authorization (no Bearer), retry 3x on 429/5xx, and it
 *  NEVER throws — image sourcing is an enhancement, and a Pexels outage must
 *  degrade to "no stock candidates", never to a failed run. */
export async function searchPexels(query: string, opts: PexelsOpts = {}): Promise<PexelsResult> {
  const apiKey = opts.apiKey ?? process.env.PEXELS_API_KEY ?? "";
  if (!apiKey) return { ok: false, error: "PEXELS_API_KEY is not set" };
  const f = opts.fetchImpl ?? fetch;
  const url = `https://api.pexels.com/v1/search?query=${encodeURIComponent(query).replace(/%20/g, "+")}&per_page=${opts.perPage ?? 9}`;
  const delay = opts.delayMs ?? 400;

  for (let attempt = 1; attempt <= 3; attempt++) {
    let res: Response;
    try {
      res = await f(url, { headers: { Authorization: apiKey } });
    } catch (e) {
      return { ok: false, error: `pexels network error: ${e instanceof Error ? e.message : String(e)}` };
    }
    if (res.ok) {
      try {
        const body = (await res.json()) as { photos?: Array<{ id: number; width: number; height: number; photographer?: string; src?: Record<string, string> }> };
        const candidates = (body.photos ?? []).map((p) => ({
          kind: "pexels" as const,
          pexels_id: p.id,
          thumb_url: p.src?.medium ?? p.src?.large ?? "",
          download_url: p.src?.large2x ?? p.src?.large ?? "",
          width: p.width,
          height: p.height,
          photographer: p.photographer ?? "",
        })).filter((c) => c.thumb_url && c.download_url);
        return { ok: true, candidates };
      } catch {
        return { ok: false, error: "pexels returned unparseable JSON" };
      }
    }
    const retryable = res.status === 429 || res.status >= 500;
    if (!retryable || attempt === 3) return { ok: false, error: `pexels HTTP ${res.status}` };
    await new Promise((r) => setTimeout(r, delay * attempt));
  }
  return { ok: false, error: "unreachable" };
}
