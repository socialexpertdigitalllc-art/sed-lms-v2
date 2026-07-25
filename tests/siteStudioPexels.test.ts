import { describe, it, expect, vi } from "vitest";
import { searchPexels } from "@/lib/site-studio/assets/pexels";

const photo = (id: number) => ({
  id, width: 4000, height: 2600, photographer: "Ana",
  src: { large2x: `https://images.pexels.com/${id}/large2x.jpg`, large: `https://images.pexels.com/${id}/large.jpg`, medium: `https://images.pexels.com/${id}/medium.jpg` },
});
const okResponse = (ids: number[]) =>
  new Response(JSON.stringify({ photos: ids.map(photo) }), { status: 200 });

describe("searchPexels", () => {
  it("calls the v1 search endpoint with the raw-key Authorization header", async () => {
    const f = vi.fn(async () => okResponse([1]));
    await searchPexels("plumber van", { apiKey: "K", perPage: 12, fetchImpl: f });
    const [url, init] = f.mock.calls[0] as [string, RequestInit];
    expect(url).toContain("https://api.pexels.com/v1/search");
    expect(url).toContain("query=plumber+van");
    expect(url).toContain("per_page=12");
    expect((init.headers as Record<string, string>).Authorization).toBe("K"); // no "Bearer"
  });
  it("maps photos to pexels candidates (medium thumb, large2x download)", async () => {
    const r = await searchPexels("q", { apiKey: "K", fetchImpl: async () => okResponse([7]) });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.candidates[0]).toMatchObject({ kind: "pexels", pexels_id: 7, photographer: "Ana" });
    expect(r.candidates[0].thumb_url).toContain("medium");
    expect(r.candidates[0].download_url).toContain("large2x");
  });
  it("retries on 429 then succeeds; never more than 3 attempts", async () => {
    const f = vi.fn()
      .mockResolvedValueOnce(new Response("", { status: 429 }))
      .mockResolvedValueOnce(new Response("", { status: 500 }))
      .mockResolvedValueOnce(okResponse([1]));
    const r = await searchPexels("q", { apiKey: "K", fetchImpl: f, delayMs: 0 });
    expect(r.ok).toBe(true);
    expect(f).toHaveBeenCalledTimes(3);
  });
  it("NEVER throws: exhausted retries, network error, and missing key all return ok:false", async () => {
    const exhausted = await searchPexels("q", { apiKey: "K", delayMs: 0, fetchImpl: async () => new Response("", { status: 500 }) });
    expect(exhausted.ok).toBe(false);
    const network = await searchPexels("q", { apiKey: "K", fetchImpl: async () => { throw new Error("boom"); } });
    expect(network.ok).toBe(false);
    const noKey = await searchPexels("q", { apiKey: "", fetchImpl: async () => okResponse([1]) });
    expect(noKey.ok).toBe(false);
    if (!noKey.ok) expect(noKey.error).toMatch(/PEXELS_API_KEY/);
  });
  it("does not retry a 4xx that isn't 429", async () => {
    const f = vi.fn(async () => new Response("", { status: 403 }));
    const r = await searchPexels("q", { apiKey: "K", fetchImpl: f });
    expect(r.ok).toBe(false);
    expect(f).toHaveBeenCalledTimes(1);
  });
});
