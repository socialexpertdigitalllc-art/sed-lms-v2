// @vitest-environment node
import { describe, it, expect, vi, afterEach } from "vitest";
import { imgbbAdapter } from "@/lib/photo-capture/hosts/imgbb";
import { imgchestAdapter } from "@/lib/photo-capture/hosts/imgchest";
import { postimagesAdapter, parsePostimagesToken, parseOgImage } from "@/lib/photo-capture/hosts/postimages";
import type { UploadSource } from "@/lib/photo-capture/hosts/types";

const bytes = vi.fn(async () => Buffer.from("JPEGDATA"));
const source: UploadSource = { url: "https://lh3.googleusercontent.com/p/AF1=s0", filename: "acme_001.jpg", fetchBytes: bytes };

function jsonResponse(body: unknown, init: { status?: number; headers?: Record<string, string> } = {}) {
  return new Response(JSON.stringify(body), {
    status: init.status ?? 200,
    headers: { "content-type": "application/json", ...(init.headers ?? {}) },
  });
}

afterEach(() => {
  vi.restoreAllMocks();
  bytes.mockClear();
});

describe("imgbb adapter", () => {
  it("uploads by URL and never downloads the bytes", async () => {
    const fetchMock = vi.fn(async (_url: string, _init: RequestInit) => jsonResponse({ success: true, data: { url: "https://i.ibb.co/abc/acme_001.jpg" } }));
    vi.stubGlobal("fetch", fetchMock);

    const res = await imgbbAdapter.upload(source, { credentials: { api_key: "KEY123" } });

    expect(res).toEqual({ ok: true, directUrl: "https://i.ibb.co/abc/acme_001.jpg" });
    expect(bytes).not.toHaveBeenCalled();
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("https://api.imgbb.com/1/upload?key=KEY123");
    expect((init.body as FormData).get("image")).toBe(source.url);
  });

  it("reports imgbb's error message and classifies it", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => jsonResponse({ status: 400, error: { message: "Invalid API key" } }, { status: 400 })));
    const res = await imgbbAdapter.upload(source, { credentials: { api_key: "bad" } });
    expect(res).toEqual({ ok: false, reason: "auth", message: "Invalid API key" });
  });

  it("is unconfigured without an api key", () => {
    expect(imgbbAdapter.isConfigured(null)).toBe(false);
    expect(imgbbAdapter.isConfigured({ api_key: "  " })).toBe(false);
    expect(imgbbAdapter.isConfigured({ api_key: "k" })).toBe(true);
  });
});

describe("imgchest adapter", () => {
  it("posts multipart with a bearer token and returns the cdn link", async () => {
    const fetchMock = vi.fn(async (_url: string, _init: RequestInit) =>
      jsonResponse({ data: { id: "post1", images: [{ id: "img1", link: "https://cdn.imgchest.com/files/img1.jpg" }] } })
    );
    vi.stubGlobal("fetch", fetchMock);

    const res = await imgchestAdapter.upload(source, { credentials: { token: "TOK" } });

    expect(res).toEqual({ ok: true, directUrl: "https://cdn.imgchest.com/files/img1.jpg" });
    expect(bytes).toHaveBeenCalledOnce();
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("https://api.imgchest.com/v1/post");
    expect((init.headers as Record<string, string>).Authorization).toBe("Bearer TOK");
    expect((init.body as FormData).getAll("images[]")).toHaveLength(1);
  });

  it("treats an exhausted rate-limit header as quota", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => jsonResponse({ message: "Too Many Attempts." }, { status: 429, headers: { "x-ratelimit-remaining": "0" } })));
    const res = await imgchestAdapter.upload(source, { credentials: { token: "TOK" } });
    expect(res).toEqual({ ok: false, reason: "quota", message: "Too Many Attempts." });
  });
});

describe("postimages parsers", () => {
  it("reads the token from a hidden input", () => {
    expect(parsePostimagesToken('<input type="hidden" name="token" value="abc123def456">')).toBe("abc123def456");
  });

  it("reads the token from an inline script assignment", () => {
    expect(parsePostimagesToken('var x = 1; token: "9f8e7d6c5b4a", numfiles: 1')).toBe("9f8e7d6c5b4a");
  });

  it("returns null when no token is present", () => {
    expect(parsePostimagesToken("<html><body>nothing</body></html>")).toBeNull();
  });

  it("reads the direct url from the og:image meta tag", () => {
    const html = '<meta property="og:image" content="https://i.postimg.cc/abc/acme.jpg"/>';
    expect(parseOgImage(html)).toBe("https://i.postimg.cc/abc/acme.jpg");
  });

  it("returns null when there is no og:image", () => {
    expect(parseOgImage("<html></html>")).toBeNull();
  });
});

describe("postimages adapter", () => {
  it("scrapes a token, posts the bytes, then resolves the direct url", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(new Response('<input name="token" value="tok999aaa">', { headers: { "content-type": "text/html" } }))
      .mockResolvedValueOnce(jsonResponse({ status: "OK", url: "https://postimages.org/view/xyz" }))
      .mockResolvedValueOnce(new Response('<meta property="og:image" content="https://i.postimg.cc/xy/acme.jpg"/>', { headers: { "content-type": "text/html" } }));
    vi.stubGlobal("fetch", fetchMock);

    const res = await postimagesAdapter.upload(source, { credentials: null });

    expect(res).toEqual({ ok: true, directUrl: "https://i.postimg.cc/xy/acme.jpg" });
    expect(fetchMock.mock.calls[1][0]).toBe("https://postimages.org/json/rr");
    const form = fetchMock.mock.calls[1][1].body as FormData;
    expect(form.get("token")).toBe("tok999aaa");
    expect(form.get("numfiles")).toBe("1");
    expect(String(form.get("upload_session"))).toHaveLength(32);
  });

  it("needs no credentials at all", () => {
    expect(postimagesAdapter.needsCredentials).toBe(false);
    expect(postimagesAdapter.isConfigured(null)).toBe(true);
  });

  it("fails cleanly when the token cannot be scraped", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("<html>redesigned</html>", { headers: { "content-type": "text/html" } })));
    const res = await postimagesAdapter.upload(source, { credentials: null });
    expect(res).toEqual({ ok: false, reason: "error", message: "Could not read an upload token from postimages.org" });
  });
});
