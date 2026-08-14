// @vitest-environment node
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { zipFromMap } from "@/lib/template-engine/zip";

/**
 * Wiring for POST /api/site-studio/deployments/override — the upload icon's
 * backend (ticket + lead screens). Same faking pattern as
 * siteDownloadRouteWiring.test.ts; the load-bearing difference under test:
 * this is a WRITE, so lead viewers who CAN download must NOT be able to
 * upload.
 */

const holder = vi.hoisted(() => ({
  user: null as { id: string } | null,
  perms: new Set<string>(),
  inserts: [] as { table: string; row: Record<string, unknown> }[],
  updates: [] as { table: string; filters: [string, string][] }[],
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
      }),
    }) as unknown as SupabaseClient,
}));

import { POST } from "@/app/api/site-studio/deployments/override/route";

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
});

afterEach(() => {
  for (const k of KEYS) {
    if (saved[k] === undefined) delete process.env[k];
    else process.env[k] = saved[k];
  }
  vi.unstubAllGlobals();
});

function siteZipFile(map: Record<string, string> = { "index.html": "<p>fixed</p>" }) {
  const bytes = zipFromMap(Object.fromEntries(Object.entries(map).map(([k, v]) => [k, new TextEncoder().encode(v)])));
  return new File([new Uint8Array(bytes)], "fixed-site.zip", { type: "application/zip" });
}

function req(site: string, file: File | null = siteZipFile()) {
  const form = new FormData();
  if (file) form.append("file", file);
  return new Request(`http://test.local/api/site-studio/deployments/override?site=${encodeURIComponent(site)}`, {
    method: "POST",
    body: form,
  });
}

function stubDaOverride() {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes("/api/filemanager/list")) return Response.json({ files: [] });
      if (url.includes("/api/filemanager-actions/")) return Response.json({});
      throw new Error(`unexpected fetch: ${url}`);
    }),
  );
}

describe("POST /api/site-studio/deployments/override", () => {
  it("401s with no session", async () => {
    holder.user = null;
    expect((await POST(req("foo.dmviral.com"))).status).toBe(401);
  });

  it("403s for lead viewers — download-only permissions must not write", async () => {
    holder.perms = new Set(["leads.view", "leads.view_all"]);
    expect((await POST(req("foo.dmviral.com"))).status).toBe(403);
  });

  it("422s a zip that does not look like a website, before touching hosting", async () => {
    const res = await POST(req("foo.dmviral.com", siteZipFile({ "notes.txt": "hi" })));
    expect(res.status).toBe(422);
    const body = (await res.json()) as { error: string };
    expect(body.error).toMatch(/index\.html/);
  });

  it("overrides a staging site for a tech user, stamps the board row, and logs it", async () => {
    stubDaOverride();
    const res = await POST(req("https://greenlawn.dmviral.com"));
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ ok: true, url: "https://greenlawn.dmviral.com", files: 1 });

    const update = holder.updates.find((u) => u.table === "studio_deployments");
    expect(update?.filters).toEqual([
      ["subdomain", "greenlawn"],
      ["status", "live"],
    ]);
    expect(holder.inserts[0]).toMatchObject({
      table: "activity_log",
      row: {
        user_id: "tech-1",
        action: "studio.site.files_overridden",
        new_value: { site: "greenlawn.dmviral.com", source: "staging", zip_name: "fixed-site.zip" },
      },
    });
  });

  it("propagates protected-domain refusal", async () => {
    const res = await POST(req("dmviral.com"));
    expect(res.status).toBe(403);
  });
});
