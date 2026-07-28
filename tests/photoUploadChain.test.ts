// @vitest-environment node
import { describe, it, expect, vi } from "vitest";
import { runUploadChain, COOLDOWN_MS } from "@/lib/photo-capture/hosts/chain";
import type { HostProvider, ImageHost, UploadAdapter, UploadResult, HostStateStore } from "@/lib/photo-capture/hosts/types";

const NOW = new Date("2026-07-28T12:00:00Z");

function host(id: string, provider: HostProvider, position = 0): ImageHost {
  return { id, provider, label: id, position, enabled: true, exhaustedUntil: null, credentials: { api_key: "k", token: "k" } };
}

function adapter(provider: HostProvider, results: UploadResult[]): UploadAdapter {
  const queue = [...results];
  return {
    provider,
    needsCredentials: true,
    isConfigured: () => true,
    upload: vi.fn(async (): Promise<UploadResult> => queue.shift() ?? { ok: false, reason: "error", message: "exhausted fixture" }),
  };
}

function fakeStore() {
  const calls: string[] = [];
  const store: HostStateStore & { calls: string[] } = {
    calls,
    markExhausted: async (id, until) => { calls.push(`exhausted:${id}:${until.toISOString()}`); },
    markAuthFailed: async (id) => { calls.push(`auth:${id}`); },
    recordSuccess: async (id) => { calls.push(`ok:${id}`); },
  };
  return store;
}

const source = { url: "https://lh3.googleusercontent.com/p/AF1=s0", filename: "a.jpg", fetchBytes: async () => Buffer.from("x") };
const ok = (u: string): UploadResult => ({ ok: true, directUrl: u });

describe("runUploadChain", () => {
  it("uses the first host and stops there", async () => {
    const store = fakeStore();
    const res = await runUploadChain(source, {
      hosts: [host("b1", "imgbb"), host("c1", "imgchest")],
      adapters: { imgbb: adapter("imgbb", [ok("https://i.ibb.co/1.jpg")]), postimages: adapter("postimages", []), imgchest: adapter("imgchest", []) },
      state: store,
      now: () => NOW,
    });

    expect(res.directUrl).toBe("https://i.ibb.co/1.jpg");
    expect(res.hostId).toBe("b1");
    expect(res.attempts.map((a) => a.outcome)).toEqual(["ok"]);
    expect(store.calls).toEqual(["ok:b1"]);
  });

  it("falls through to the next KEY of the same provider on a quota error, and parks the exhausted one", async () => {
    const store = fakeStore();
    const res = await runUploadChain(source, {
      hosts: [host("b1", "imgbb", 0), host("b2", "imgbb", 1)],
      adapters: {
        imgbb: adapter("imgbb", [{ ok: false, reason: "quota", message: "limit" }, ok("https://i.ibb.co/2.jpg")]),
        postimages: adapter("postimages", []),
        imgchest: adapter("imgchest", []),
      },
      state: store,
      now: () => NOW,
    });

    expect(res.hostId).toBe("b2");
    expect(res.directUrl).toBe("https://i.ibb.co/2.jpg");
    expect(store.calls).toEqual([`exhausted:b1:${new Date(NOW.getTime() + COOLDOWN_MS).toISOString()}`, "ok:b2"]);
  });

  it("drops to the next PROVIDER when every key of the first is spent", async () => {
    const store = fakeStore();
    const res = await runUploadChain(source, {
      hosts: [host("b1", "imgbb"), host("p1", "postimages"), host("c1", "imgchest")],
      adapters: {
        imgbb: adapter("imgbb", [{ ok: false, reason: "quota", message: "limit" }]),
        postimages: adapter("postimages", [{ ok: false, reason: "error", message: "endpoint changed" }]),
        imgchest: adapter("imgchest", [ok("https://cdn.imgchest.com/files/z.jpg")]),
      },
      state: store,
      now: () => NOW,
    });

    expect(res.directUrl).toBe("https://cdn.imgchest.com/files/z.jpg");
    expect(res.attempts.map((a) => `${a.provider}:${a.outcome}`)).toEqual([
      "imgbb:quota",
      "postimages:error",
      "imgchest:ok",
    ]);
  });

  it("disables a host with a bad credential instead of parking it", async () => {
    const store = fakeStore();
    const res = await runUploadChain(source, {
      hosts: [host("b1", "imgbb"), host("c1", "imgchest")],
      adapters: {
        imgbb: adapter("imgbb", [{ ok: false, reason: "auth", message: "Invalid API key" }]),
        postimages: adapter("postimages", []),
        imgchest: adapter("imgchest", [ok("https://cdn.imgchest.com/files/y.jpg")]),
      },
      state: store,
      now: () => NOW,
    });

    expect(res.directUrl).toBe("https://cdn.imgchest.com/files/y.jpg");
    expect(store.calls).toEqual(["auth:b1", "ok:c1"]);
  });

  it("skips a host whose adapter says it is not configured", async () => {
    const store = fakeStore();
    const unconfigured: UploadAdapter = { provider: "imgbb", needsCredentials: true, isConfigured: () => false, upload: vi.fn() };
    const res = await runUploadChain(source, {
      hosts: [host("b1", "imgbb"), host("c1", "imgchest")],
      adapters: { imgbb: unconfigured, postimages: adapter("postimages", []), imgchest: adapter("imgchest", [ok("https://cdn.imgchest.com/files/w.jpg")]) },
      state: store,
      now: () => NOW,
    });

    expect(unconfigured.upload).not.toHaveBeenCalled();
    expect(res.attempts[0]).toEqual({ hostId: "b1", provider: "imgbb", outcome: "not_configured" });
    expect(res.directUrl).toBe("https://cdn.imgchest.com/files/w.jpg");
  });

  it("returns a null url and the last error when the whole chain is spent", async () => {
    const store = fakeStore();
    const res = await runUploadChain(source, {
      hosts: [host("b1", "imgbb")],
      adapters: {
        imgbb: adapter("imgbb", [{ ok: false, reason: "error", message: "boom" }]),
        postimages: adapter("postimages", []),
        imgchest: adapter("imgchest", []),
      },
      state: store,
      now: () => NOW,
    });

    expect(res.directUrl).toBeNull();
    expect(res.hostId).toBeNull();
    expect(res.lastError).toBe("boom");
  });

  it("returns a clear error when no hosts are configured at all", async () => {
    const res = await runUploadChain(source, {
      hosts: [],
      adapters: { imgbb: adapter("imgbb", []), postimages: adapter("postimages", []), imgchest: adapter("imgchest", []) },
      state: fakeStore(),
      now: () => NOW,
    });

    expect(res.directUrl).toBeNull();
    expect(res.lastError).toBe("No image host is configured");
  });

  it("treats a rejecting adapter as an error outcome and falls through instead of throwing", async () => {
    const store = fakeStore();
    const throwing: UploadAdapter = {
      provider: "imgbb",
      needsCredentials: true,
      isConfigured: () => true,
      upload: vi.fn(async () => { throw new Error("socket hang up"); }),
    };
    const res = await runUploadChain(source, {
      hosts: [host("b1", "imgbb"), host("c1", "imgchest")],
      adapters: { imgbb: throwing, postimages: adapter("postimages", []), imgchest: adapter("imgchest", [ok("https://cdn.imgchest.com/files/v.jpg")]) },
      state: store,
      now: () => NOW,
    });

    expect(res.directUrl).toBe("https://cdn.imgchest.com/files/v.jpg");
    expect(res.attempts[0]).toEqual({ hostId: "b1", provider: "imgbb", outcome: "error", message: "socket hang up" });
  });

  it("still returns the successful upload when the state store's recordSuccess rejects", async () => {
    const store = fakeStore();
    const flakyStore: HostStateStore = { ...store, recordSuccess: async () => { throw new Error("supabase down"); } };
    const res = await runUploadChain(source, {
      hosts: [host("b1", "imgbb")],
      adapters: { imgbb: adapter("imgbb", [ok("https://i.ibb.co/3.jpg")]), postimages: adapter("postimages", []), imgchest: adapter("imgchest", []) },
      state: flakyStore,
      now: () => NOW,
    });

    expect(res.directUrl).toBe("https://i.ibb.co/3.jpg");
    expect(res.hostId).toBe("b1");
  });
});
