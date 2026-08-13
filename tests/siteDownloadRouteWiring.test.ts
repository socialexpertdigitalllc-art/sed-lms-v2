// @vitest-environment node
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * Wiring for GET /api/site-studio/deployments/download — the download icon's
 * one backend. Exercises the ACTUAL handler (auth gate, the three-surface
 * permission union, zip streaming headers, activity log) with only the
 * process-boundary pieces faked: the session, the permission set, the admin
 * client, and DirectAdmin's HTTP surface. fetchLiveSiteZip itself runs real
 * (its unit tests live in siteStudioLiveFiles.test.ts).
 */

const holder = vi.hoisted(() => ({
  user: null as { id: string } | null,
  perms: new Set<string>(),
  inserts: [] as { table: string; row: Record<string, unknown> }[],
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
      }),
    }) as unknown as SupabaseClient,
}));

import { GET } from "@/app/api/site-studio/deployments/download/route";

const KEYS = ["DA_HOST", "DA_USERNAME", "DA_LOGIN_KEY", "DA_DOMAIN"] as const;
let saved: Record<string, string | undefined>;

beforeEach(() => {
  saved = {};
  for (const k of KEYS) saved[k] = process.env[k];
  process.env.DA_HOST = "https://server.example.com:2222";
  process.env.DA_USERNAME = "sedadmin";
  process.env.DA_LOGIN_KEY = "loginkey";
  process.env.DA_DOMAIN = "dmviral.com";
  holder.user = { id: "user-1" };
  holder.perms = new Set(["studio.manage"]);
  holder.inserts = [];
});

afterEach(() => {
  for (const k of KEYS) {
    if (saved[k] === undefined) delete process.env[k];
    else process.env[k] = saved[k];
  }
  vi.unstubAllGlobals();
});

function req(site: string) {
  return new Request(`http://test.local/api/site-studio/deployments/download?site=${encodeURIComponent(site)}`);
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

describe("GET /api/site-studio/deployments/download", () => {
  it("401s with no session", async () => {
    holder.user = null;
    const res = await GET(req("foo.dmviral.com"));
    expect(res.status).toBe(401);
  });

  it("403s without any of the three surfaces' permissions", async () => {
    holder.perms = new Set(["tickets.view"]);
    const res = await GET(req("foo.dmviral.com"));
    expect(res.status).toBe(403);
  });

  it("streams the zip with an attachment filename and logs the pull — tech permission suffices", async () => {
    holder.perms = new Set(["tickets.resolve"]);
    stubDaArchive();

    const res = await GET(req("https://greenlawn.dmviral.com"));
    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Type")).toBe("application/zip");
    expect(res.headers.get("Content-Disposition")).toMatch(
      /^attachment; filename="greenlawn\.dmviral\.com-files-\d{4}-\d{2}-\d{2}\.zip"$/,
    );
    expect(new Uint8Array(await res.arrayBuffer())[0]).toBe(0x50);

    expect(holder.inserts).toHaveLength(1);
    expect(holder.inserts[0].table).toBe("activity_log");
    expect(holder.inserts[0].row).toMatchObject({
      user_id: "user-1",
      action: "studio.site.files_downloaded",
      new_value: { site: "greenlawn.dmviral.com", source: "staging" },
    });
  });

  it("propagates fetchLiveSiteZip's status for refused sites", async () => {
    const res = await GET(req("dmviral.com")); // the protected DA apex
    expect(res.status).toBe(403);
    const body = (await res.json()) as { error: string };
    expect(body.error).toMatch(/protected company domain/);
  });
});
