// @vitest-environment node
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  SNAPSHOT_KEEP,
  listSiteSnapshots,
  readSiteSnapshot,
  snapshotName,
  snapshotSite,
} from "@/lib/site-studio/deploy/snapshots";

/**
 * Rollback snapshots — storage IS the history (no table), so the fake here
 * is a tiny in-memory bucket recording exactly the calls the lib makes.
 */

const KEYS = ["DA_HOST", "DA_USERNAME", "DA_LOGIN_KEY", "DA_DOMAIN"] as const;
let saved: Record<string, string | undefined>;

beforeEach(() => {
  saved = {};
  for (const k of KEYS) saved[k] = process.env[k];
  process.env.DA_HOST = "https://server.example.com:2222";
  process.env.DA_USERNAME = "sedadmin";
  process.env.DA_LOGIN_KEY = "loginkey";
  process.env.DA_DOMAIN = "dmviral.com";
});

afterEach(() => {
  for (const k of KEYS) {
    if (saved[k] === undefined) delete process.env[k];
    else process.env[k] = saved[k];
  }
  vi.unstubAllGlobals();
});

function fakeStorage(initial: string[] = []) {
  const files = new Map<string, Uint8Array>(initial.map((p) => [p, new Uint8Array([1])]));
  const removed: string[] = [];
  const admin = {
    storage: {
      from: (bucket: string) => {
        if (bucket !== "studio-sites") throw new Error(`unexpected bucket ${bucket}`);
        return {
          upload: async (path: string, bytes: Uint8Array) => {
            files.set(path, bytes);
            return { error: null };
          },
          list: async (prefix: string) => ({
            data: [...files.keys()]
              .filter((p) => p.startsWith(`${prefix}/`))
              .map((p) => ({ name: p.slice(prefix.length + 1), created_at: null, metadata: { size: files.get(p)?.length ?? 0 } })),
            error: null,
          }),
          remove: async (paths: string[]) => {
            for (const p of paths) {
              files.delete(p);
              removed.push(p);
            }
            return { data: null, error: null };
          },
          download: async (path: string) => {
            const bytes = files.get(path);
            return bytes
              ? { data: new Blob([new Uint8Array(bytes)]), error: null }
              : { data: null, error: { message: "not found" } };
          },
        };
      },
    },
  } as unknown as SupabaseClient;
  return { admin, files, removed };
}

function stubDaArchive() {
  const bytes = new Uint8Array(new ArrayBuffer(200));
  bytes[0] = 0x50;
  bytes[1] = 0x4b;
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL) => {
      if (String(input).includes("/api/filemanager/download-archive")) return new Response(bytes, { status: 200 });
      throw new Error(`unexpected fetch: ${String(input)}`);
    }),
  );
}

describe("snapshotName", () => {
  it("keeps ISO ordering without the characters storage keys dislike", () => {
    const name = snapshotName("2026-08-14T18:30:12.345Z");
    expect(name).toBe("2026-08-14T18-30-12-345Z.zip");
    expect(name).not.toMatch(/[:.]/.source.replace(".", "\\.")); // no raw colons/dots besides the extension
  });
});

describe("snapshotSite", () => {
  it("zips the CURRENT live files into snapshots/{host}/ and keeps at most SNAPSHOT_KEEP", async () => {
    stubDaArchive();
    const seeded = Array.from({ length: SNAPSHOT_KEEP }, (_, i) => `snapshots/foo.dmviral.com/2026-08-0${i + 1}T00-00-00-000Z.zip`);
    const { admin, files, removed } = fakeStorage(seeded);

    const res = await snapshotSite(admin, "https://foo.dmviral.com", "2026-08-14T10:00:00.000Z");
    expect(res).toMatchObject({ ok: true, path: "snapshots/foo.dmviral.com/2026-08-14T10-00-00-000Z.zip" });

    const remaining = [...files.keys()].sort();
    expect(remaining).toHaveLength(SNAPSHOT_KEEP);
    // the OLDEST seeded snapshot went, the new one stayed
    expect(removed).toEqual(["snapshots/foo.dmviral.com/2026-08-01T00-00-00-000Z.zip"]);
    expect(remaining).toContain("snapshots/foo.dmviral.com/2026-08-14T10-00-00-000Z.zip");
  });

  it("fails soft when the live files cannot be read", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("nope", { status: 500 })));
    const { admin } = fakeStorage();
    const res = await snapshotSite(admin, "foo.dmviral.com", "2026-08-14T10:00:00.000Z");
    expect(res.ok).toBe(false);
  });
});

describe("listSiteSnapshots", () => {
  it("lists a site's snapshots and never leaks another site's", async () => {
    const { admin } = fakeStorage([
      "snapshots/foo.dmviral.com/2026-08-10T00-00-00-000Z.zip",
      "snapshots/bar.dmviral.com/2026-08-11T00-00-00-000Z.zip",
    ]);
    const list = await listSiteSnapshots(admin, "https://foo.dmviral.com");
    expect(list).toHaveLength(1);
    expect(list?.[0].path).toBe("snapshots/foo.dmviral.com/2026-08-10T00-00-00-000Z.zip");
    expect(await listSiteSnapshots(admin, "not a url")).toBeNull();
  });
});

describe("readSiteSnapshot", () => {
  it("confines paths to the site's own prefix", async () => {
    const { admin } = fakeStorage(["snapshots/foo.dmviral.com/a.zip", "snapshots/bar.dmviral.com/b.zip"]);
    const own = await readSiteSnapshot(admin, "foo.dmviral.com", "snapshots/foo.dmviral.com/a.zip");
    expect(own.ok).toBe(true);
    const other = await readSiteSnapshot(admin, "foo.dmviral.com", "snapshots/bar.dmviral.com/b.zip");
    expect(other.ok).toBe(false);
    const traversal = await readSiteSnapshot(admin, "foo.dmviral.com", "snapshots/foo.dmviral.com/../bar.dmviral.com/b.zip");
    expect(traversal.ok).toBe(false);
  });
});
