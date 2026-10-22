// @vitest-environment node
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { createHash } from "node:crypto";
import { memorySupabase, type MemoryDb } from "./helpers/memorySupabase";
import { HG_ROOT, daDocroot, fakeHostEnv, installFakeHosts, withEnv, type FakeHosts } from "./helpers/fakeSiteHosts";
import { TEST_SECRET, leadPath, routeCtx, signedRequest } from "./helpers/sedcmsRoutes";

/**
 * The CMS's read endpoints (launch plan L3 and "The CMS <-> LMS contract"):
 *   POST /api/internal/sedcms/leads/{id}/summary     {}
 *   POST /api/internal/sedcms/leads/{id}/live-files  { host }
 *   POST /api/internal/sedcms/leads/{id}/checksums   { host, paths }
 * Every route: the signature first (nothing is read before it), then the
 * lead (deleted ones are gone), then its current host against the one the
 * CMS expects. The hosts are faked in memory behind a stubbed fetch.
 */

const state = vi.hoisted(() => ({ db: null as MemoryDb | null, fromCalls: 0 }));

vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => ({
    from: (table: string) => {
      state.fromCalls++;
      return state.db!.client.from(table);
    },
  }),
}));

import { POST as summaryPOST } from "@/app/api/internal/sedcms/leads/[id]/summary/route";
import { POST as liveFilesPOST } from "@/app/api/internal/sedcms/leads/[id]/live-files/route";
import { POST as checksumsPOST } from "@/app/api/internal/sedcms/leads/[id]/checksums/route";

const STAGING_LEAD = "11111111-1111-4111-8111-111111111111";
const CUSTOM_LEAD = "22222222-2222-4222-8222-222222222222";
const WP_LEAD = "33333333-3333-4333-8333-333333333333";
const PROTECTED_LEAD = "44444444-4444-4444-8444-444444444444";
const NO_SITE_LEAD = "55555555-5555-4555-8555-555555555555";
const DELETED_LEAD = "66666666-6666-4666-8666-666666666666";
const UNKNOWN_LEAD = "77777777-7777-4777-8777-777777777777";

const STAGING = "acme-roofing.dmviral.com";
const docroot = daDocroot("acme-roofing");
const sha = (b: string | Uint8Array) => createHash("sha256").update(b).digest("hex");

function leads() {
  const lead = (id: string, website_link: string | null, extra: Record<string, unknown> = {}) => ({
    id,
    business_name: "Acme Roofing",
    business_email: "owner@acme.example",
    status: "Ready",
    website_link,
    deleted_at: null,
    ...extra,
  });
  return [
    lead(STAGING_LEAD, `https://${STAGING}/`),
    lead(CUSTOM_LEAD, "https://www.client.com", { business_email: null, status: "Closed" }),
    lead(WP_LEAD, "wp-client.com"),
    lead(PROTECTED_LEAD, "https://sedsolutions.online"),
    lead(NO_SITE_LEAD, null),
    lead(DELETED_LEAD, `https://${STAGING}`, { deleted_at: "2026-10-01T00:00:00Z" }),
  ];
}

type Handler = (req: Request, ctx: { params: Promise<{ id: string }> }) => Promise<Response>;
const call = (handler: Handler, id: string, endpoint: string, body: unknown, opts = {}) =>
  handler(signedRequest(leadPath(id, endpoint), body, opts), routeCtx(id));

let restoreEnv: () => void;
let hosts: FakeHosts;

beforeEach(() => {
  restoreEnv = withEnv({ ...fakeHostEnv(), SEDCMS_LMS_SECRET: TEST_SECRET });
  state.db = memorySupabase({ leads: leads() });
  state.fromCalls = 0;
  hosts = installFakeHosts({
    websites: [
      { domain: "client.com", username: "u447231526" },
      { domain: "wp-client.com", username: "u447231526", website_type: "wordpress" },
    ],
  });
});
afterEach(() => {
  restoreEnv();
  vi.unstubAllGlobals();
});

describe("every read route: signature first", () => {
  const routes: [string, Handler, unknown][] = [
    ["summary", summaryPOST, {}],
    ["live-files", liveFilesPOST, { host: STAGING }],
    ["checksums", checksumsPOST, { host: STAGING, paths: ["index.html"] }],
  ];

  it.each(routes)("%s: a bad signature is a 401 before any database read or hosting call", async (endpoint, handler, body) => {
    for (const opts of [{ unsigned: true }, { secret: `${TEST_SECRET}-wrong` }, { tamper: (raw: string) => raw.replace("}", ' }') }]) {
      const res = await call(handler, STAGING_LEAD, endpoint, body, opts);
      expect(res.status).toBe(401);
      expect(await res.json()).toEqual({ code: "BAD_SIGNATURE", message: expect.any(String) });
    }
    expect(state.fromCalls).toBe(0);
    expect(hosts.calls).toHaveLength(0);
  });

  it.each(routes)("%s: a 503 while the LMS has no secret", async (endpoint, handler, body) => {
    const restore = withEnv({ SEDCMS_LMS_SECRET: undefined });
    try {
      const res = await call(handler, STAGING_LEAD, endpoint, body);
      expect(res.status).toBe(503);
      expect((await res.json()).code).toBe("NOT_CONFIGURED");
    } finally {
      restore();
    }
    expect(state.fromCalls).toBe(0);
  });

  it.each(routes)("%s: a 503 NOT_CONFIGURED while the secret has whitespace around it", async (endpoint, handler, body) => {
    const quiet = vi.spyOn(console, "error").mockImplementation(() => {});
    const restore = withEnv({ SEDCMS_LMS_SECRET: `${TEST_SECRET} ` });
    try {
      const res = await call(handler, STAGING_LEAD, endpoint, body, { secret: `${TEST_SECRET} ` });
      expect(res.status).toBe(503);
      expect((await res.json()).code).toBe("NOT_CONFIGURED");
    } finally {
      restore();
      quiet.mockRestore();
    }
    expect(state.fromCalls).toBe(0);
  });

  it.each(routes)("%s: a deleted, unknown or malformed lead is a 404 NO_LEAD", async (endpoint, handler, body) => {
    for (const id of [DELETED_LEAD, UNKNOWN_LEAD, "not-a-uuid"]) {
      const res = await call(handler, id, endpoint, body);
      expect(res.status, id).toBe(404);
      expect(await res.json()).toEqual({ code: "NO_LEAD", message: expect.any(String) });
    }
    expect(hosts.calls).toHaveLength(0);
  });

  it.each(routes)("%s: a body that isn't the contract's is a 400", async (endpoint, handler) => {
    for (const body of ["not json", "[]", JSON.stringify({ host: STAGING, extra: 1, paths: [] }), JSON.stringify({ host: 5 })]) {
      const res = await call(handler, STAGING_LEAD, endpoint, body);
      expect(res.status, body).toBe(400);
      expect((await res.json()).code).toBe("BAD_REQUEST");
    }
  });

  it("refuses a body over 30 MiB with a 413, before verifying it", async () => {
    const huge = JSON.stringify({ host: STAGING, pad: "x".repeat(30 * 1024 * 1024) });
    const res = await call(liveFilesPOST, STAGING_LEAD, "live-files", huge);
    expect(res.status).toBe(413);
    expect(state.fromCalls).toBe(0);
  });
});

describe("HOST_CHANGED", () => {
  it("answers 409 with the lead's current host when the CMS expects another", async () => {
    for (const [handler, endpoint, body] of [
      [liveFilesPOST, "live-files", { host: "old-name.dmviral.com" }],
      [checksumsPOST, "checksums", { host: "old-name.dmviral.com", paths: ["index.html"] }],
    ] as const) {
      const res = await call(handler, STAGING_LEAD, endpoint, body);
      expect(res.status).toBe(409);
      expect(await res.json()).toEqual({ code: "HOST_CHANGED", host: STAGING, message: expect.any(String) });
    }
    expect(hosts.calls).toHaveLength(0);
  });

  it("answers 409 with host null when the lead has no site any more", async () => {
    const res = await call(liveFilesPOST, NO_SITE_LEAD, "live-files", { host: STAGING });
    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({ code: "HOST_CHANGED", host: null, message: expect.any(String) });
  });
});

describe("summary", () => {
  it("describes a lead on a staging subdomain, with exactly the contract's keys", async () => {
    const res = await call(summaryPOST, STAGING_LEAD, "summary", {});
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      leadId: STAGING_LEAD,
      businessName: "Acme Roofing",
      businessEmail: "owner@acme.example",
      status: "Ready",
      host: STAGING,
      hostKind: "staging",
      isStatic: true,
    });
  });

  it("describes custom domains: static, not static, protected; and a lead with no site", async () => {
    expect(await (await call(summaryPOST, CUSTOM_LEAD, "summary", {})).json()).toEqual({
      leadId: CUSTOM_LEAD,
      businessName: "Acme Roofing",
      businessEmail: null,
      status: "Closed",
      host: "www.client.com",
      hostKind: "custom",
      isStatic: true,
    });
    expect(await (await call(summaryPOST, WP_LEAD, "summary", {})).json()).toMatchObject({ host: "wp-client.com", hostKind: "custom", isStatic: false });
    expect(await (await call(summaryPOST, PROTECTED_LEAD, "summary", {})).json()).toMatchObject({ host: "sedsolutions.online", hostKind: "custom", isStatic: false });
    expect(await (await call(summaryPOST, NO_SITE_LEAD, "summary", {})).json()).toMatchObject({ host: null, hostKind: null, isStatic: false });
  });

  it("is a 502 HOSTING when Hostinger can't be read, rather than a wrong isStatic", async () => {
    vi.unstubAllGlobals();
    hosts = installFakeHosts({ hostingerDown: true });
    const res = await call(summaryPOST, CUSTOM_LEAD, "summary", {});
    expect(res.status).toBe(502);
    expect((await res.json()).code).toBe("HOSTING");
  });
});

describe("live-files", () => {
  const MiB = 1024 * 1024;

  it("lists every file with its size, and carries the text and sha256 of the text files", async () => {
    hosts.da.put(`${docroot}/index.html`, "<h1>Acme</h1>");
    hosts.da.put(`${docroot}/assets/js/components.js`, "window.LUMEN_SITE = {};");
    hosts.da.put(`${docroot}/assets/img/hero.jpg`, new Uint8Array(2048));
    hosts.da.put(`${docroot}/override.zip`, "PK");
    hosts.da.put(`${docroot}/lms-deploy-1760000000000.zip`, "PK");
    hosts.da.put(`${docroot}/.htaccess`, "RewriteEngine On");
    hosts.da.put(`${docroot}/My Page.html`, "<p>odd name</p>");

    const res = await call(liveFilesPOST, STAGING_LEAD, "live-files", { host: STAGING });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(Object.keys(body).sort()).toEqual(["files", "host", "truncated"]);
    expect(body).toEqual({
      host: STAGING,
      truncated: false,
      files: [
        { path: "My Page.html", size: 15, sha256: null },
        { path: "assets/img/hero.jpg", size: 2048, sha256: null },
        { path: "assets/js/components.js", size: 23, sha256: sha("window.LUMEN_SITE = {};"), text: "window.LUMEN_SITE = {};" },
        { path: "index.html", size: 13, sha256: sha("<h1>Acme</h1>"), text: "<h1>Acme</h1>" },
      ],
    });
  });

  it("keeps the text exact: a byte-order mark stays, and a file that isn't UTF-8 carries no text", async () => {
    const bom = new Uint8Array([0xef, 0xbb, 0xbf, ...new TextEncoder().encode("<p>x</p>")]);
    const latin1 = new Uint8Array([0x3c, 0x70, 0x3e, 0xe9, 0x3c, 0x2f, 0x70, 0x3e]); // "<p>é</p>" in Latin-1
    hosts.da.put(`${docroot}/bom.html`, bom);
    hosts.da.put(`${docroot}/latin1.html`, latin1);
    const body = await (await call(liveFilesPOST, STAGING_LEAD, "live-files", { host: STAGING })).json();
    const bomFile = body.files.find((f: { path: string }) => f.path === "bom.html");
    expect(bomFile.text.charCodeAt(0)).toBe(0xfeff);
    expect(new TextEncoder().encode(bomFile.text)).toEqual(bom);
    expect(bomFile.sha256).toBe(sha(bom));
    expect(body.files.find((f: { path: string }) => f.path === "latin1.html")).toEqual({ path: "latin1.html", size: 8, sha256: sha(latin1) });
  });

  it("carries no text for a file over 1 MiB, and stops carrying text past 25 MiB in all", async () => {
    hosts.da.put(`${docroot}/big.html`, "b".repeat(MiB + 1));
    for (let i = 0; i < 27; i++) hosts.da.put(`${docroot}/p${String(i).padStart(2, "0")}.html`, String.fromCharCode(97 + (i % 26)).repeat(MiB));
    const res = await call(liveFilesPOST, STAGING_LEAD, "live-files", { host: STAGING });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.truncated).toBe(true);
    expect(body.files.find((f: { path: string }) => f.path === "big.html")).toEqual({ path: "big.html", size: MiB + 1, sha256: null });
    const pages = body.files.filter((f: { path: string }) => /^p[0-9]+[.]html$/.test(f.path));
    expect(pages).toHaveLength(27);
    expect(pages.filter((f: { text?: string }) => typeof f.text === "string")).toHaveLength(25);
    expect(pages.slice(0, 25).every((f: { text?: string; sha256: string | null }) => f.text?.length === MiB && f.sha256)).toBe(true);
    expect(pages.slice(25)).toEqual([
      { path: "p25.html", size: MiB, sha256: null },
      { path: "p26.html", size: MiB, sha256: null },
    ]);
  });

  it("works on a custom domain through Hostinger, by the lead's www link", async () => {
    hosts.hostinger.put(`${HG_ROOT}/index.html`, "<h1>Client</h1>");
    const res = await call(liveFilesPOST, CUSTOM_LEAD, "live-files", { host: "www.client.com" });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      host: "www.client.com",
      truncated: false,
      files: [{ path: "index.html", size: 15, sha256: sha("<h1>Client</h1>"), text: "<h1>Client</h1>" }],
    });
  });

  it("answers 403 PROTECTED, 422 NOT_STATIC and 502 HOSTING", async () => {
    const protectedRes = await call(liveFilesPOST, PROTECTED_LEAD, "live-files", { host: "sedsolutions.online" });
    expect(protectedRes.status).toBe(403);
    expect(await protectedRes.json()).toEqual({ code: "PROTECTED", message: expect.any(String) });

    const wp = await call(liveFilesPOST, WP_LEAD, "live-files", { host: "wp-client.com" });
    expect(wp.status).toBe(422);
    expect((await wp.json()).code).toBe("NOT_STATIC");

    vi.unstubAllGlobals();
    hosts = installFakeHosts({ hostingerDown: true });
    const down = await call(liveFilesPOST, CUSTOM_LEAD, "live-files", { host: "www.client.com" });
    expect(down.status).toBe(502);
    expect(await down.json()).toEqual({ code: "HOSTING", message: expect.any(String) });
  });

  it("never puts hosting detail in an error", async () => {
    vi.unstubAllGlobals();
    hosts = installFakeHosts({ shortRead: "index.html" });
    hosts.da.put(`${docroot}/index.html`, "<h1>Acme, a long enough page</h1>");
    const res = await call(liveFilesPOST, STAGING_LEAD, "live-files", { host: STAGING });
    expect(res.status).toBe(502);
    const body = await res.json();
    expect(body).toEqual({ code: "HOSTING", message: expect.any(String), failed: { path: "index.html", step: "read" } });
    expect(body.message).not.toMatch(/da900|dmviral[.]com[/]|domains[/]|Basic|HTTP/);
  });
});

describe("checksums", () => {
  it("answers each path's sha256, in the order asked, null for a missing file", async () => {
    hosts.da.put(`${docroot}/index.html`, "<h1>Acme</h1>");
    hosts.da.put(`${docroot}/cms-media/0123456789abcdef.webp`, new Uint8Array([1, 2, 3]));
    const res = await call(checksumsPOST, STAGING_LEAD, "checksums", {
      host: STAGING,
      paths: ["cms-media/0123456789abcdef.webp", "about.html", "index.html"],
    });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      files: [
        { path: "cms-media/0123456789abcdef.webp", sha256: sha(new Uint8Array([1, 2, 3])) },
        { path: "about.html", sha256: null },
        { path: "index.html", sha256: sha("<h1>Acme</h1>") },
      ],
    });
  });

  it("refuses (422) a path the rules refuse, or more than 100 paths, before any hosting call", async () => {
    for (const paths of [["../index.html"], ["index.html", ".htaccess"], ["x.php"], Array.from({ length: 101 }, (_, i) => `p${i}.html`)]) {
      const res = await call(checksumsPOST, STAGING_LEAD, "checksums", { host: STAGING, paths });
      expect(res.status).toBe(422);
      expect((await res.json()).code).toBe("REFUSED");
    }
    expect(hosts.calls).toHaveLength(0);
  });
});
