// @vitest-environment node
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { zipFromMap } from "@/lib/template-engine/zip";

/**
 * Wiring for the write half of the ticket workflow: POST override (the upload
 * icon) and POST restore (the board's file history). Same faking pattern as
 * siteDownloadRouteWiring.test.ts; the load-bearing behaviors pinned here:
 *   - lead viewers who CAN download must NOT be able to write;
 *   - a snapshot of the current files is stored BEFORE the write;
 *   - a ?ticket= param pins the activity row to the ticket ONLY when that
 *     ticket's lead actually owns the targeted site;
 *   - restore refuses paths outside the site's own snapshot prefix.
 */

const holder = vi.hoisted(() => ({
  user: null as { id: string } | null,
  perms: new Set<string>(),
  inserts: [] as { table: string; row: Record<string, unknown> }[],
  updates: [] as { table: string; filters: [string, string][] }[],
  ticket: null as { id: string; lead_id: string; leads: { website_link: string | null } } | null,
  storageFiles: new Map<string, Uint8Array>(),
  storageUploads: [] as string[],
}));

vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({
    auth: { getUser: async () => ({ data: { user: holder.user } }) },
  }),
}));

vi.mock("@/lib/permissions/resolver", () => ({
  getUserPermissions: async () => holder.perms,
}));

vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () =>
    ({
      from: (table: string) => ({
        insert: async (row: Record<string, unknown>) => {
          holder.inserts.push({ table, row });
          return { error: null };
        },
        update: () => {
          const entry = { table, filters: [] as [string, string][] };
          holder.updates.push(entry);
          const chain = {
            eq: (col: string, val: string) => {
              entry.filters.push([col, val]);
              return Object.assign(Promise.resolve({ error: null }), chain);
            },
          };
          return chain;
        },
        select: () => ({
          eq: () => ({
            maybeSingle: async () => ({ data: holder.ticket }),
          }),
        }),
      }),
      storage: {
        from: () => ({
          upload: async (path: string, bytes: Uint8Array) => {
            holder.storageFiles.set(path, bytes);
            holder.storageUploads.push(path);
            return { error: null };
          },
          list: async (prefix: string) => ({
            data: [...holder.storageFiles.keys()]
              .filter((p) => p.startsWith(`${prefix}/`))
              .map((p) => ({ name: p.slice(prefix.length + 1), created_at: null, metadata: { size: 1 } })),
            error: null,
          }),
          remove: async () => ({ data: null, error: null }),
          download: async (path: string) => {
            const bytes = holder.storageFiles.get(path);
            return bytes
              ? { data: new Blob([new Uint8Array(bytes)]), error: null }
              : { data: null, error: { message: "not found" } };
          },
        }),
      },
    }) as unknown as SupabaseClient,
}));

import { POST as overridePost } from "@/app/api/site-studio/deployments/override/route";
import { POST as restorePost } from "@/app/api/site-studio/deployments/restore/route";

const KEYS = ["DA_HOST", "DA_USERNAME", "DA_LOGIN_KEY", "DA_DOMAIN"] as const;
let saved: Record<string, string | undefined>;

beforeEach(() => {
  saved = {};
  for (const k of KEYS) saved[k] = process.env[k];
  process.env.DA_HOST = "https://server.example.com:2222";
  process.env.DA_USERNAME = "sedadmin";
  process.env.DA_LOGIN_KEY = "loginkey";
  process.env.DA_DOMAIN = "dmviral.com";
  holder.user = { id: "tech-1" };
  holder.perms = new Set(["tickets.resolve"]);
  holder.inserts = [];
  holder.updates = [];
  holder.ticket = null;
  holder.storageFiles = new Map();
  holder.storageUploads = [];
});

afterEach(() => {
  for (const k of KEYS) {
    if (saved[k] === undefined) delete process.env[k];
    else process.env[k] = saved[k];
  }
  vi.unstubAllGlobals();
});

function siteZipBytes(map: Record<string, string> = { "index.html": "<p>fixed</p>" }) {
  return zipFromMap(Object.fromEntries(Object.entries(map).map(([k, v]) => [k, new TextEncoder().encode(v)])));
}

function siteZipFile(map?: Record<string, string>) {
  return new File([new Uint8Array(siteZipBytes(map))], "fixed-site.zip", { type: "application/zip" });
}

function overrideReq(site: string, file: File | null = siteZipFile(), ticket?: string) {
  const form = new FormData();
  if (file) form.append("file", file);
  const t = ticket ? `&ticket=${encodeURIComponent(ticket)}` : "";
  return new Request(`http://test.local/api/site-studio/deployments/override?site=${encodeURIComponent(site)}${t}`, {
    method: "POST",
    body: form,
  });
}

/** DA surface for a full override: archive (snapshot) + list/remove/upload/extract. */
function stubDa() {
  const archive = new Uint8Array(new ArrayBuffer(200));
  archive[0] = 0x50;
  archive[1] = 0x4b;
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes("/api/filemanager/download-archive")) return new Response(archive, { status: 200 });
      if (url.includes("/api/filemanager/list")) return Response.json({ files: [] });
      if (url.includes("/api/filemanager-actions/")) return Response.json({});
      throw new Error(`unexpected fetch: ${url}`);
    }),
  );
}

describe("POST /api/site-studio/deployments/override", () => {
  it("401s with no session", async () => {
    holder.user = null;
    expect((await overridePost(overrideReq("foo.dmviral.com"))).status).toBe(401);
  });

  it("403s for lead viewers — download-only permissions must not write", async () => {
    holder.perms = new Set(["leads.view", "leads.view_all"]);
    expect((await overridePost(overrideReq("foo.dmviral.com"))).status).toBe(403);
  });

  it("422s a zip that does not look like a website, before touching hosting", async () => {
    const res = await overridePost(overrideReq("foo.dmviral.com", siteZipFile({ "notes.txt": "hi" })));
    expect(res.status).toBe(422);
    const body = (await res.json()) as { error: string };
    expect(body.error).toMatch(/index\.html/);
  });

  it("snapshots the current files FIRST, overrides, stamps the board row, and logs", async () => {
    stubDa();
    const res = await overridePost(overrideReq("https://greenlawn.dmviral.com"));
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ ok: true, url: "https://greenlawn.dmviral.com", snapshotted: true });

    expect(holder.storageUploads).toHaveLength(1);
    expect(holder.storageUploads[0]).toMatch(/^snapshots\/greenlawn\.dmviral\.com\/.+\.zip$/);

    const update = holder.updates.find((u) => u.table === "studio_deployments");
    expect(update?.filters).toEqual([
      ["subdomain", "greenlawn"],
      ["status", "live"],
    ]);
    expect(holder.inserts[0]).toMatchObject({
      table: "activity_log",
      row: {
        action: "studio.site.files_overridden",
        entity_type: "site",
        new_value: { site: "greenlawn.dmviral.com", snapshot: holder.storageUploads[0] },
      },
    });
  });

  it("pins the activity row to the ticket only when the ticket's lead owns the site", async () => {
    stubDa();
    holder.ticket = { id: "tk-1", lead_id: "lead-1", leads: { website_link: "https://greenlawn.dmviral.com" } };
    await overridePost(overrideReq("https://greenlawn.dmviral.com", siteZipFile(), "tk-1"));
    expect(holder.inserts[0].row).toMatchObject({ entity_type: "ticket", entity_id: "tk-1" });

    holder.inserts = [];
    holder.ticket = { id: "tk-2", lead_id: "lead-2", leads: { website_link: "https://other-site.dmviral.com" } };
    await overridePost(overrideReq("https://greenlawn.dmviral.com", siteZipFile(), "tk-2"));
    expect(holder.inserts[0].row).toMatchObject({ entity_type: "site", entity_id: null });
  });

  it("propagates protected-domain refusal", async () => {
    stubDa();
    expect((await overridePost(overrideReq("dmviral.com"))).status).toBe(403);
  });
});

describe("POST /api/site-studio/deployments/restore", () => {
  function restoreReq(site: string, path: string) {
    return new Request(`http://test.local/api/site-studio/deployments/restore?site=${encodeURIComponent(site)}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ path }),
    });
  }

  it("puts a stored snapshot back live, snapshotting the current files first", async () => {
    stubDa();
    const stored = "snapshots/greenlawn.dmviral.com/2026-08-10T00-00-00-000Z.zip";
    holder.storageFiles.set(stored, siteZipBytes({ "index.html": "<p>yesterday</p>" }));

    const res = await restorePost(restoreReq("https://greenlawn.dmviral.com", stored));
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ ok: true, undoable: true });

    // the pre-restore snapshot of the CURRENT files was written
    expect(holder.storageUploads.some((p) => p !== stored && p.startsWith("snapshots/greenlawn.dmviral.com/"))).toBe(true);
    expect(holder.inserts[0]).toMatchObject({
      table: "activity_log",
      row: { action: "studio.site.restored", new_value: { from_snapshot: stored } },
    });
  });

  it("refuses another site's snapshot path", async () => {
    stubDa();
    holder.storageFiles.set("snapshots/other.dmviral.com/a.zip", siteZipBytes());
    const res = await restorePost(restoreReq("greenlawn.dmviral.com", "snapshots/other.dmviral.com/a.zip"));
    expect(res.status).toBe(422);
  });

  it("403s without a write permission", async () => {
    holder.perms = new Set(["leads.view"]);
    const res = await restorePost(restoreReq("greenlawn.dmviral.com", "snapshots/greenlawn.dmviral.com/a.zip"));
    expect(res.status).toBe(403);
  });
});
