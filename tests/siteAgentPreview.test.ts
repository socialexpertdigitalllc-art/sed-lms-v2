// tests/siteAgentPreview.test.ts
// @vitest-environment node
// Task 9 — review-screen data routes: before/after file JSON + sandboxed preview.
import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextResponse } from "next/server";
import { zipFromMap } from "@/lib/template-engine/zip";

// Access gate mock: admitted by default; a test can flip `denial` to make the
// gate short-circuit exactly like the real agentRunAccess error branch.
const accessState = vi.hoisted(() => ({
  denial: null as { error: unknown; status: number } | null,
  run: {} as Record<string, unknown>,
}));
vi.mock("@/lib/site-agent/access", () => ({
  agentRunAccess: async () =>
    accessState.denial ?? { run: accessState.run, userId: "dev-1", perms: new Set(["studio.manage"]) },
}));

// Admin client mock: storage-only fake serving REAL zip bytes; routes go
// through the REAL resultCache/ttlCached/unzipToMap stack.
const zipStore = vi.hoisted(() => ({
  objects: {} as Record<string, Uint8Array>,
  downloads: [] as string[], // every storage download, for cache-behavior asserts
}));
vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => ({
    storage: {
      from: () => ({
        download: async (path: string) => {
          zipStore.downloads.push(path);
          return zipStore.objects[path]
            ? { data: new Blob([zipStore.objects[path].slice()]), error: null }
            : { data: null, error: { message: "missing" } };
        },
      }),
    },
  }),
}));

import { GET as previewGET } from "@/app/api/site-agent/runs/[id]/preview/[[...path]]/route";
import { GET as filesGET } from "@/app/api/site-agent/runs/[id]/files/[...path]/route";

const enc = (s: string) => new TextEncoder().encode(s);
// 0x9F/0x92/0x96 are continuation bytes with no lead byte — a fatal UTF-8 decoder throws.
const PNG_BYTES = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0, 159, 146, 150]);

const RESULT_FILES: Record<string, Uint8Array> = {
  "index.html": enc('<html><head></head><body><a href="/about.html">a</a><script src="app.js"></script></body></html>'),
  "about.html": enc("<html><head></head><body><p>about</p></body></html>"),
  "css/styles.css": enc("body{}"),
  "app.js": enc("console.log('hi');"),
  "logo.png": PNG_BYTES,
};
const ORIGINAL_FILES: Record<string, Uint8Array> = {
  "index.html": enc("<html><head></head><body><h1>old</h1></body></html>"),
  "css/styles.css": enc("body{}"),
  "app.js": enc("console.log('hi');"),
  "logo.png": PNG_BYTES,
  "old.html": enc("<html><head></head><body>old page</body></html>"),
  // NO about.html — it is a file the agent CREATED.
};
zipStore.objects["run-1/result.zip"] = zipFromMap(RESULT_FILES);
zipStore.objects["run-1/original.zip"] = zipFromMap(ORIGINAL_FILES);
// "run-queued" deliberately has NO zips in the store (run still queued/running).

const previewCtx = (id: string, path?: string[]) => ({ params: Promise.resolve({ id, path }) });
const filesCtx = (id: string, path: string[]) => ({ params: Promise.resolve({ id, path }) });

// ttlCached is a module-level cache shared across tests — every test gets a
// DISTINCT updated_at so its cache keys can never collide with another test's.
let ver = 0;
beforeEach(() => {
  accessState.denial = null;
  accessState.run = {
    id: "run-1", ticket_id: "t-1", lead_id: "lead-1", site_host: "acme.dmviral.com",
    status: "review", files: {}, created_by: "dev-1",
    updated_at: `2026-09-01T12:00:00.${String(ver++).padStart(3, "0")}Z`,
  };
});

describe("GET /api/site-agent/runs/[id]/preview/[[...path]]", () => {
  it("serves index.html by default, base-injected, under a no-same-origin script sandbox", async () => {
    const res = await previewGET(new Request("http://x/api/site-agent/runs/run-1/preview"), previewCtx("run-1"));
    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Type")).toContain("text/html");
    const csp = res.headers.get("Content-Security-Policy") ?? "";
    expect(csp).toContain("sandbox allow-scripts");
    expect(csp).not.toContain("allow-same-origin");
    const body = await res.text();
    expect(body).toContain('<base href="/api/site-agent/runs/run-1/preview/">');
    // Root-absolute ref to a known result file is routed back through the preview.
    expect(body).toContain("/api/site-agent/runs/run-1/preview/about.html");
  });

  it("serves a nested asset with its content type", async () => {
    const res = await previewGET(
      new Request("http://x/api/site-agent/runs/run-1/preview/css/styles.css"),
      previewCtx("run-1", ["css", "styles.css"]),
    );
    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Type")).toContain("text/css");
    expect(await res.text()).toBe("body{}");
  });

  it("404s a file that is not in the result", async () => {
    const res = await previewGET(
      new Request("http://x/api/site-agent/runs/run-1/preview/nope.html"),
      previewCtx("run-1", ["nope.html"]),
    );
    expect(res.status).toBe(404);
  });

  it("400s a traversal path before touching storage", async () => {
    const res = await previewGET(
      new Request("http://x/api/site-agent/runs/run-1/preview/..%2Fetc"),
      previewCtx("run-1", ["..", "etc"]),
    );
    expect(res.status).toBe(400);
  });

  it("?raw=1 returns the exact source as text/plain with no base injection", async () => {
    const res = await previewGET(
      new Request("http://x/api/site-agent/runs/run-1/preview/index.html?raw=1"),
      previewCtx("run-1", ["index.html"]),
    );
    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Type")).toContain("text/plain");
    expect(res.headers.get("X-Content-Type-Options")).toBe("nosniff");
    const body = await res.text();
    expect(body).toContain('<script src="app.js">');
    expect(body).not.toContain("<base");
  });

  it("409s while the run has no result zip yet (still queued/running)", async () => {
    accessState.run = { ...accessState.run, id: "run-queued", status: "queued" };
    const res = await previewGET(
      new Request("http://x/api/site-agent/runs/run-queued/preview"),
      previewCtx("run-queued"),
    );
    expect(res.status).toBe(409);
    expect((await res.json()).error).toMatch(/no edited files/i);
  });
});

describe("GET /api/site-agent/runs/[id]/files/[...path]", () => {
  it("returns before+after text for an edited file", async () => {
    const res = await filesGET(new Request("http://x"), filesCtx("run-1", ["index.html"]));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.binary).toBe(false);
    expect(body.path).toBe("index.html");
    expect(body.before).toContain("<h1>old</h1>");
    expect(body.after).toContain('<script src="app.js">');
  });

  it("returns before null for a created file", async () => {
    const res = await filesGET(new Request("http://x"), filesCtx("run-1", ["about.html"]));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.binary).toBe(false);
    expect(body.before).toBeNull();
    expect(typeof body.after).toBe("string");
  });

  it("returns after null for a deleted file", async () => {
    const res = await filesGET(new Request("http://x"), filesCtx("run-1", ["old.html"]));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.binary).toBe(false);
    expect(typeof body.before).toBe("string");
    expect(body.after).toBeNull();
  });

  it("marks a non-UTF-8 file binary and ships byte lengths, never contents", async () => {
    const res = await filesGET(new Request("http://x"), filesCtx("run-1", ["logo.png"]));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.binary).toBe(true);
    expect(body.before).toBeNull();
    expect(body.after).toBeNull();
    expect(typeof body.beforeBytes).toBe("number");
    expect(typeof body.afterBytes).toBe("number");
    expect(body.afterBytes).toBe(PNG_BYTES.byteLength);
  });

  it("404s a file present in neither zip and 400s an unsafe path", async () => {
    const missing = await filesGET(new Request("http://x"), filesCtx("run-1", ["ghost.html"]));
    expect(missing.status).toBe(404);
    const unsafe = await filesGET(new Request("http://x"), filesCtx("run-1", ["..", "etc"]));
    expect(unsafe.status).toBe(400);
  });

  it("409s while the run has no result zip yet", async () => {
    accessState.run = { ...accessState.run, id: "run-queued", status: "running" };
    const res = await filesGET(new Request("http://x"), filesCtx("run-queued", ["index.html"]));
    expect(res.status).toBe(409);
  });
});

describe("resultCache keying — one live entry per (run, side)", () => {
  const countDownloads = (path: string) => zipStore.downloads.filter((p) => p === path).length;

  it("serves repeat requests for the same run version from cache (one download)", async () => {
    zipStore.objects["run-hit/result.zip"] = zipFromMap({
      "index.html": enc("<html><head></head><body><h1>cached hero</h1></body></html>"),
    });
    accessState.run = { ...accessState.run, id: "run-hit", updated_at: "2026-09-01T13:00:00Z" };
    for (let i = 0; i < 2; i++) {
      const res = await previewGET(new Request("http://x/api/site-agent/runs/run-hit/preview"), previewCtx("run-hit"));
      expect(res.status).toBe(200);
      expect(await res.text()).toContain("cached hero");
    }
    expect(countDownloads("run-hit/result.zip")).toBe(1);
  });

  it("a run transition (new updated_at) overwrites the entry in place, never orphans it", async () => {
    const zipPath = "run-revise/result.zip";
    zipStore.objects[zipPath] = zipFromMap({
      "index.html": enc("<html><head></head><body><h1>v1 hero</h1></body></html>"),
    });
    accessState.run = { ...accessState.run, id: "run-revise", updated_at: "2026-09-01T14:00:00Z" };
    const v1 = await previewGET(new Request("http://x/api/site-agent/runs/run-revise/preview"), previewCtx("run-revise"));
    expect(await v1.text()).toContain("v1 hero");
    expect(countDownloads(zipPath)).toBe(1);

    // The worker republishes result.zip and the transition bumps updated_at —
    // the review screen must see the NEW zip despite the 60s TTL.
    zipStore.objects[zipPath] = zipFromMap({
      "index.html": enc("<html><head></head><body><h1>v2 hero</h1></body></html>"),
    });
    accessState.run = { ...accessState.run, updated_at: "2026-09-01T14:05:00Z" };
    const v2 = await previewGET(new Request("http://x/api/site-agent/runs/run-revise/preview"), previewCtx("run-revise"));
    expect(await v2.text()).toContain("v2 hero");
    expect(countDownloads(zipPath)).toBe(2);

    // Asking for the OLD version again re-downloads: the v1 entry was
    // OVERWRITTEN, not kept alongside — the whole point of keying without the
    // version (a version-suffixed key would still hold v1 here and skip this
    // third download, orphaning a multi-MB map per transition for the life of
    // the process).
    accessState.run = { ...accessState.run, updated_at: "2026-09-01T14:00:00Z" };
    const v1Again = await previewGET(new Request("http://x/api/site-agent/runs/run-revise/preview"), previewCtx("run-revise"));
    expect(v1Again.status).toBe(200);
    expect(countDownloads(zipPath)).toBe(3);
  });
});

describe("access gate propagation", () => {
  it("relays the gate's denial response from both routes", async () => {
    accessState.denial = { error: NextResponse.json({ error: "Forbidden" }, { status: 403 }), status: 403 };
    const preview = await previewGET(new Request("http://x"), previewCtx("run-1"));
    expect(preview.status).toBe(403);
    accessState.denial = { error: NextResponse.json({ error: "Forbidden" }, { status: 403 }), status: 403 };
    const files = await filesGET(new Request("http://x"), filesCtx("run-1", ["index.html"]));
    expect(files.status).toBe(403);
  });
});
