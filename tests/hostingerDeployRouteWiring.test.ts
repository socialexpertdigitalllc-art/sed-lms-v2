// @vitest-environment node
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { NextResponse } from "next/server";

/**
 * The hosting-plan migration broke every custom-domain file action: the LMS
 * runs on the OLD hosting account while client sites live on the NEW one, so
 * fsDeploy's "write into the addon docroot on the shared disk" writes into a
 * directory that does not exist on the LMS's account. These tests exercise the
 * ACTUAL route handlers (same approach as siteStudioProductionRouteWiring) and
 * pin the exact boundary the bug lived at: every custom-domain deploy must go
 * through the Hostinger API (deployZipToWebsite) and must never touch the
 * local filesystem.
 */

const deployZipToWebsiteSpy = vi.hoisted(() => vi.fn(async () => ({ ok: true as const })));
const deployZipToDirSpy = vi.hoisted(() =>
  vi.fn(async () => {
    throw new Error("fs deploy must not be used for custom domains");
  }),
);
const archivedZip = vi.hoisted(() => new Uint8Array([0x50, 0x4b, 1, 2, 3, 4]));

const WEBSITE = vi.hoisted(() => ({
  domain: "client.com",
  username: "u447231526",
  root_directory: "/home/u447231526/domains/client.com/public_html",
  vhost_type: "addon",
  order_id: 1009861861,
  is_enabled: true,
}));

vi.mock("@/lib/template-engine/fsDeploy", () => ({ deployZipToDir: deployZipToDirSpy }));

vi.mock("@/lib/hostinger/client", () => ({
  hostingerConfigured: () => true,
  listDomains: async () => [{ id: 1, domain: "client.com", type: "domain", status: "active", expires_at: null }],
  getWebsite: async () => WEBSITE,
  ensureWebsite: async () => ({ ok: true, website: WEBSITE }),
  deployZipToWebsite: deployZipToWebsiteSpy,
}));

vi.mock("@/lib/template-engine/directadmin", () => ({
  daConfigured: () => true,
  subFromWebsiteLink: (url: string, daDomain: string) => {
    try {
      const host = new URL(url).hostname;
      return host.endsWith(`.${daDomain}`) ? host.slice(0, -(daDomain.length + 1)) : null;
    } catch {
      return null;
    }
  },
  archiveDocroot: async () => archivedZip,
  deleteSubdomain: async () => ({}),
  clearDocroot: async () => ({ ok: true }),
  uploadZipAndExtract: async () => ({ ok: true }),
  docrootFor: (sub: string) => `/staging/${sub}`,
}));

vi.mock("@/lib/site-studio/service/guard", () => ({
  guard: async () => ({ userId: "user-1" }),
  guardError: (status: 401 | 403) => NextResponse.json({ error: "denied" }, { status }),
}));

vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({ auth: { getUser: async () => ({ data: { user: { id: "user-1" } } }) } }),
}));

vi.mock("@/lib/permissions/resolver", () => ({
  getUserPermissions: async () => new Set(["templates.deploy"]),
}));

vi.mock("@/lib/notifications/notify", () => ({ notify: async () => {} }));
vi.mock("@/lib/notifications/rules", () => ({ getRule: async () => ({}) }));

/** Just enough Supabase surface for these three routes: chainable filters that
 *  resolve to a canned row per table, and update/insert recorders. */
function fakeAdmin(rows: Record<string, Record<string, unknown> | null>) {
  const updates: Record<string, Record<string, unknown>[]> = {};
  const admin = {
    updates,
    from(table: string) {
      const chain = (result: unknown) => {
        const c: Record<string, unknown> = {};
        for (const m of ["eq", "or", "order", "select"]) c[m] = () => c;
        c.maybeSingle = async () => ({ data: result, error: null });
        c.single = async () => ({ data: result, error: result ? null : { message: "not found" } });
        c.then = (resolve: (v: unknown) => unknown, reject?: (e: unknown) => unknown) =>
          Promise.resolve({ data: result, error: null }).then(resolve, reject);
        return c;
      };
      return {
        select: () => chain(rows[table] ?? null),
        update: (patch: Record<string, unknown>) => {
          (updates[table] ??= []).push(patch);
          return chain(null);
        },
        insert: async (row: Record<string, unknown>) => {
          (updates[table] ??= []).push(row);
          return { data: null, error: null };
        },
      };
    },
  };
  return admin;
}

const adminHolder = vi.hoisted(() => ({ admin: null as unknown }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => adminHolder.admin }));

import { POST as studioTransferPost } from "@/app/api/site-studio/deployments/[id]/transfer/route";
import { POST as studioUploadPost } from "@/app/api/site-studio/deployments/[id]/upload/route";
import { POST as v2TransferPost } from "@/app/api/template-engine/generations/[id]/transfer/route";

const ENV_KEYS = ["DA_DOMAIN", "PROTECTED_DOMAINS"];
const savedEnv: Record<string, string | undefined> = {};

beforeEach(() => {
  for (const k of ENV_KEYS) savedEnv[k] = process.env[k];
  process.env.DA_DOMAIN = "dmviral.com";
  process.env.PROTECTED_DOMAINS = "sedlms.com";
  deployZipToWebsiteSpy.mockClear();
  deployZipToDirSpy.mockClear();
  // reachability probe inside the routes
  vi.stubGlobal("fetch", vi.fn(async () => new Response("ok", { status: 200 })));
});

afterEach(() => {
  for (const k of ENV_KEYS) {
    if (savedEnv[k] === undefined) delete process.env[k];
    else process.env[k] = savedEnv[k];
  }
  vi.unstubAllGlobals();
});

const ctx = { params: Promise.resolve({ id: "dep-1" }) };

describe("custom-domain deploys go through the Hostinger API, never the local disk", () => {
  it("studio transfer: deploys the archived staging files to the addon website over the API", async () => {
    adminHolder.admin = fakeAdmin({
      studio_deployments: {
        id: "dep-1",
        lead_id: "lead-1",
        subdomain: "greenlawn",
        url: "https://greenlawn.dmviral.com",
        status: "live",
        updated_at: "2026-09-01T00:00:00Z",
      },
      leads: { id: "lead-1", business_name: "Green Lawn", agent_id: "a", closed_by: "c", website_link: null },
    });

    const req = new Request("http://lms.local/api", {
      method: "POST",
      body: JSON.stringify({ domain: "client.com" }),
    });
    const res = await studioTransferPost(req, ctx);
    const json = (await res.json()) as { url?: string; error?: string };

    expect(json.error).toBeUndefined();
    expect(json.url).toBe("https://client.com");
    expect(deployZipToWebsiteSpy).toHaveBeenCalledTimes(1);
    expect(deployZipToWebsiteSpy).toHaveBeenCalledWith(WEBSITE, archivedZip);
    expect(deployZipToDirSpy).not.toHaveBeenCalled();
  });

  it("studio upload: overrides a custom-domain site's files over the API", async () => {
    adminHolder.admin = fakeAdmin({
      studio_deployments: { id: "dep-1", subdomain: "client.com", url: "https://client.com", status: "live" },
    });

    const form = new FormData();
    const bytes = new Uint8Array([0x50, 0x4b, 9, 9]);
    form.append("file", new File([bytes], "site.zip", { type: "application/zip" }));
    const res = await studioUploadPost(new Request("http://lms.local/api", { method: "POST", body: form }), ctx);
    const json = (await res.json()) as { ok?: boolean; error?: string };

    expect(json.error).toBeUndefined();
    expect(json.ok).toBe(true);
    expect(deployZipToWebsiteSpy).toHaveBeenCalledTimes(1);
    const [siteArg, zipArg] = deployZipToWebsiteSpy.mock.calls[0] as unknown as [unknown, Uint8Array];
    expect(siteArg).toEqual(WEBSITE);
    expect(Array.from(zipArg)).toEqual(Array.from(bytes));
    expect(deployZipToDirSpy).not.toHaveBeenCalled();
  });

  it("v2 transfer: deploys the archived staging files to the addon website over the API", async () => {
    adminHolder.admin = fakeAdmin({
      template_generations: {
        id: "gen-1",
        lead_id: "lead-1",
        status: "deployed",
        deployed_url: "https://greenlawn.dmviral.com",
      },
      leads: { id: "lead-1", business_name: "Green Lawn", agent_id: "a", closed_by: "c", website_link: null },
    });

    const req = new Request("http://lms.local/api", {
      method: "POST",
      body: JSON.stringify({ domain: "client.com" }),
    });
    const res = await v2TransferPost(req, { params: Promise.resolve({ id: "gen-1" }) });
    const json = (await res.json()) as { url?: string; error?: string };

    expect(json.error).toBeUndefined();
    expect(json.url).toBe("https://client.com");
    expect(deployZipToWebsiteSpy).toHaveBeenCalledTimes(1);
    expect(deployZipToWebsiteSpy).toHaveBeenCalledWith(WEBSITE, archivedZip);
    expect(deployZipToDirSpy).not.toHaveBeenCalled();
  });
});
