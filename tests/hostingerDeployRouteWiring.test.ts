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

const deployZipToWebsiteSpy = vi.hoisted(() =>
  vi.fn(async (..._args: unknown[]): Promise<{ ok: true; settled: boolean } | { ok: false; message: string }> => ({
    ok: true,
    settled: true,
  })),
);
const deleteSubdomainSpy = vi.hoisted(() => vi.fn(async (..._args: unknown[]) => ({})));
const snapshotSiteSpy = vi.hoisted(() =>
  vi.fn(async (..._args: unknown[]) => ({ ok: true as const, path: "snapshots/client.com/x.zip", bytes: 10 })),
);
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

/** Per-test Hostinger state: what the domain is today and how setup answers. */
const hosting = vi.hoisted(() => ({
  website: null as Record<string, unknown> | null,
  domains: [] as { id: number; domain: string; type: string; status: string; expires_at: null }[],
  ensure: null as Record<string, unknown> | null,
}));

vi.mock("@/lib/template-engine/fsDeploy", () => ({ deployZipToDir: deployZipToDirSpy }));
vi.mock("@/lib/site-studio/deploy/snapshots", () => ({ snapshotSite: snapshotSiteSpy }));

vi.mock("@/lib/hostinger/client", () => ({
  hostingerConfigured: () => true,
  listDomains: async () => hosting.domains,
  getWebsite: async () => hosting.website,
  ensureWebsite: async () => hosting.ensure ?? { ok: true, website: hosting.website ?? WEBSITE, created: !hosting.website },
  deployZipToWebsite: deployZipToWebsiteSpy,
  downloadWebsiteZip: async () => ({ ok: true, zip: archivedZip }),
  ensureSsl: async () => "installing",
  isStaticWebsite: (w: { website_type?: string | null }) => !w.website_type || w.website_type === "other",
  websiteTypeLabel: (t: string | null | undefined) => (t === "wordpress" ? "WordPress" : "static"),
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
  deleteSubdomain: deleteSubdomainSpy,
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

import { zipFromMap, unzipToMap } from "@/lib/template-engine/zip";
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
  deployZipToWebsiteSpy.mockImplementation(async () => ({ ok: true, settled: true }));
  deployZipToDirSpy.mockClear();
  deleteSubdomainSpy.mockClear();
  snapshotSiteSpy.mockClear();
  hosting.website = WEBSITE;
  hosting.domains = [{ id: 1, domain: "client.com", type: "domain", status: "active", expires_at: null }];
  hosting.ensure = null;
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
    const bytes = zipFromMap({ "index.html": new TextEncoder().encode("<p>new</p>") });
    form.append("file", new File([new Uint8Array(bytes)], "site.zip", { type: "application/zip" }));
    const res = await studioUploadPost(new Request("http://lms.local/api", { method: "POST", body: form }), ctx);
    const json = (await res.json()) as { ok?: boolean; error?: string; snapshotted?: boolean };

    expect(json.error).toBeUndefined();
    expect(json.ok).toBe(true);
    // the current files are saved to the history BEFORE the overwrite
    expect(snapshotSiteSpy).toHaveBeenCalledTimes(1);
    expect(json.snapshotted).toBe(true);
    expect(snapshotSiteSpy.mock.invocationCallOrder[0]).toBeLessThan(deployZipToWebsiteSpy.mock.invocationCallOrder[0]);
    expect(deployZipToWebsiteSpy).toHaveBeenCalledTimes(1);
    const [siteArg, zipArg] = deployZipToWebsiteSpy.mock.calls[0] as unknown as [unknown, Uint8Array];
    expect(siteArg).toEqual(WEBSITE);
    expect(new TextDecoder().decode(unzipToMap(zipArg)["index.html"])).toBe("<p>new</p>");
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

describe("studio transfer: safety rails", () => {
  const stagingRow = () =>
    fakeAdmin({
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
  const transfer = async (domain: string) => {
    const admin = stagingRow();
    adminHolder.admin = admin;
    const res = await studioTransferPost(
      new Request("http://lms.local/api", { method: "POST", body: JSON.stringify({ domain }) }),
      ctx,
    );
    return { res, json: (await res.json()) as Record<string, unknown>, admin };
  };

  it("a domain that is neither registered nor hosted is refused clearly, and the failure is logged", async () => {
    hosting.website = null;
    hosting.domains = [];
    const { res, json, admin } = await transfer("stranger.com");
    expect(res.status).toBe(422);
    expect(String(json.error)).toMatch(/neither registered/);
    expect(deployZipToWebsiteSpy).not.toHaveBeenCalled();
    expect(admin.updates.activity_log?.[0]).toMatchObject({ action: "studio.deployment.transfer_failed" });
  });

  it("a registered domain with no hosting yet: hosting is created, nothing to snapshot, staging removed", async () => {
    hosting.website = null;
    const { json } = await transfer("client.com");
    expect(json.error).toBeUndefined();
    expect(json).toMatchObject({ url: "https://client.com", hostingCreated: true, subdomainDeleted: true, ssl: "installing" });
    expect(snapshotSiteSpy).not.toHaveBeenCalled();
    expect(deleteSubdomainSpy).toHaveBeenCalledWith("greenlawn");
  });

  it("a domain that already hosts a static site is snapshotted before it is overwritten", async () => {
    const { json } = await transfer("client.com");
    expect(json.error).toBeUndefined();
    expect(snapshotSiteSpy).toHaveBeenCalledTimes(1);
    expect(snapshotSiteSpy.mock.calls[0][1]).toBe("https://client.com");
    expect(snapshotSiteSpy.mock.invocationCallOrder[0]).toBeLessThan(deployZipToWebsiteSpy.mock.invocationCallOrder[0]);
    expect(json.snapshot).toBe("snapshots/client.com/x.zip");
  });

  it("a WordPress site is never a transfer target — the deploy would erase it", async () => {
    hosting.website = { ...WEBSITE, website_type: "wordpress" };
    const { res, json } = await transfer("client.com");
    expect(res.status).toBe(409);
    expect(String(json.error)).toMatch(/WordPress/);
    expect(deployZipToWebsiteSpy).not.toHaveBeenCalled();
    expect(deleteSubdomainSpy).not.toHaveBeenCalled();
  });

  it("hosting still being set up: 409 pending, nothing deployed, staging untouched, not logged as a failure", async () => {
    hosting.website = null;
    hosting.ensure = { ok: false, pending: true, message: "Hostinger is still setting up hosting for client.com" };
    const { res, json, admin } = await transfer("client.com");
    expect(res.status).toBe(409);
    expect(json.pending).toBe(true);
    expect(deployZipToWebsiteSpy).not.toHaveBeenCalled();
    expect(deleteSubdomainSpy).not.toHaveBeenCalled();
    expect(admin.updates.activity_log ?? []).toHaveLength(0);
  });

  it("keeps the staging subdomain when Hostinger had not finished unpacking", async () => {
    deployZipToWebsiteSpy.mockImplementation(async () => ({ ok: true, settled: false }));
    const { json } = await transfer("client.com");
    expect(json).toMatchObject({ url: "https://client.com", settled: false, subdomainDeleted: false });
    expect(deleteSubdomainSpy).not.toHaveBeenCalled();
  });

  it("refuses staging addresses and protected company domains as targets", async () => {
    for (const domain of ["foo.dmviral.com", "sedlms.com", "not a domain"]) {
      const { res } = await transfer(domain);
      expect(res.status).toBe(422);
    }
    expect(deployZipToWebsiteSpy).not.toHaveBeenCalled();
  });

  it("normalizes the pick (scheme, www, case) before using it", async () => {
    const { json } = await transfer("https://WWW.Client.com/");
    expect(json.url).toBe("https://client.com");
  });

  it("an unexpected crash comes back as a JSON error (not a bare 500) and is logged", async () => {
    deployZipToWebsiteSpy.mockImplementation(async () => {
      throw new Error("boom");
    });
    const { res, json, admin } = await transfer("client.com");
    expect(res.status).toBe(500);
    expect(String(json.error)).toMatch(/boom/);
    expect(admin.updates.activity_log?.[0]).toMatchObject({ action: "studio.deployment.transfer_failed" });
  });
});
