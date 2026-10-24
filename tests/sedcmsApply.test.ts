// @vitest-environment node
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { createHash } from "node:crypto";
import { memorySupabase, type MemoryDb } from "./helpers/memorySupabase";
import { daDocroot, fakeHostEnv, installFakeHosts, withEnv } from "./helpers/fakeSiteHosts";
import { SEDCMS_UNIQUE, TEST_SECRET, leadPath, linkRow, routeCtx, signedRequest } from "./helpers/sedcmsRoutes";
import { SiteFilesError, type SiteFiles } from "@/lib/sedcms/files";
import { cmsPathAllowed } from "@/lib/sedcms/paths";

/**
 * POST /api/internal/sedcms/leads/{id}/apply (launch plan L4 and "Apply, in
 * the LMS, in order"): every checksum is checked against the live file
 * first, and a mismatch is a 409 with nothing written; then the files are
 * written one by one in the order given; Cloudflare is purged (best effort)
 * when it fronts the site; one activity_log row records it. One apply at a
 * time per site.
 */

/** A site's files in memory, recording every read and write in order. */
class MemSiteFiles implements SiteFiles {
  readonly files = new Map<string, Uint8Array>();
  readonly ops: string[] = [];
  failWrite: string | null = null;
  failRead: string | null = null;
  gate: Promise<void> | null = null;
  /** each write takes this long (setTimeout, so fake timers drive it) */
  writeDelayMs = 0;
  /** Date.now() as each write began */
  readonly writeTimes: number[] = [];
  constructor(readonly tag: string) {}

  async list() {
    return { files: [...this.files.entries()].map(([path, b]) => ({ path, size: b.length })), truncated: false };
  }
  async read(path: string) {
    this.ops.push(`${this.tag}:read:${path}`);
    if (!cmsPathAllowed(path)) throw new SiteFilesError("read", "refused", "refused", path);
    if (path === this.failRead) throw new SiteFilesError("read", "hosting", "HTTP 500 from srv955", path);
    return this.files.get(path) ?? null;
  }
  async write(path: string, bytes: Uint8Array) {
    this.ops.push(`${this.tag}:write:${path}`);
    this.writeTimes.push(Date.now());
    if (this.writeDelayMs) await new Promise((resolve) => setTimeout(resolve, this.writeDelayMs));
    if (this.gate) await this.gate;
    if (path === this.failWrite) throw new SiteFilesError("write", "hosting", "HTTP 500 from srv955", path);
    this.files.set(path, bytes);
  }
}

const state = vi.hoisted(() => ({
  db: null as MemoryDb | null,
  fromCalls: 0,
  sites: new Map<string, unknown>(),
  siteFilesCalls: 0,
  purges: [] as { zoneId: string; urls: string[] }[],
  purgeOk: true,
}));

vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => ({
    from: (table: string) => {
      state.fromCalls++;
      return state.db!.client.from(table);
    },
  }),
}));

vi.mock("@/lib/sedcms/files", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/sedcms/files")>();
  return {
    ...actual,
    siteFilesFor: async (host: string) => {
      state.siteFilesCalls++;
      const fake = state.sites.get(host);
      return fake ? { ok: true, files: fake, kind: "custom", host, key: `custom:${host.replace(/^www[.]/, "")}` } : actual.siteFilesFor(host);
    },
  };
});

vi.mock("@/lib/cloudflare/client", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/cloudflare/client")>();
  return {
    ...actual,
    purgeCacheByUrls: async (zoneId: string, urls: string[]) => {
      state.purges.push({ zoneId, urls });
      return state.purgeOk ? { ok: true } : { ok: false, message: "Authentication error (10000)" };
    },
  };
});

import { POST as applyPOST } from "@/app/api/internal/sedcms/leads/[id]/apply/route";
import { POST as checksumsPOST } from "@/app/api/internal/sedcms/leads/[id]/checksums/route";

const LEAD = "11111111-1111-4111-8111-111111111111";
const OTHER_LEAD = "22222222-2222-4222-8222-222222222222";
const STAGING_LEAD = "33333333-3333-4333-8333-333333333333";
const PROTECTED_LEAD = "44444444-4444-4444-8444-444444444444";
const NO_ZONE_LEAD = "55555555-5555-4555-8555-555555555555";
const WP_LEAD = "66666666-6666-4666-8666-666666666666";
const HOST = "www.client.com";
const OTHER_HOST = "other-client.com";
const NO_ZONE_HOST = "nozone.com";
const STAGING = "acme-roofing.dmviral.com";
const REQUEST_ID = "5f0c2d1e-3b4a-4c5d-8e6f-7a8b9c0d1e2f";

async function until(done: () => boolean) {
  for (let i = 0; i < 2000 && !done(); i++) await new Promise((r) => setTimeout(r, 1));
  if (!done()) throw new Error("timed out waiting");
}

const enc = (s: string) => new TextEncoder().encode(s);
const sha = (b: string | Uint8Array) => createHash("sha256").update(b).digest("hex");
const b64 = (s: string | Uint8Array) => Buffer.from(typeof s === "string" ? enc(s) : s).toString("base64");

function change(path: string, before: string | null, after: string) {
  return { path, expectedSha256: before === null ? null : sha(before), contentBase64: b64(after) };
}

let site: MemSiteFiles;
let restoreEnv: () => void;

beforeEach(() => {
  restoreEnv = withEnv({ ...fakeHostEnv(), SEDCMS_LMS_SECRET: TEST_SECRET, CLOUDFLARE_API_TOKEN: "cf-test", CLOUDFLARE_ACCOUNT_ID: "acct" });
  const lead = (id: string, website_link: string) => ({ id, business_name: "Client", business_email: null, status: "Ready", website_link, deleted_at: null });
  state.db = memorySupabase({
    leads: [
      lead(LEAD, `https://${HOST}`),
      lead(OTHER_LEAD, `https://${OTHER_HOST}`),
      lead(STAGING_LEAD, `https://${STAGING}`),
      lead(PROTECTED_LEAD, "https://sedsolutions.online"),
      lead(NO_ZONE_LEAD, `https://${NO_ZONE_HOST}`),
      lead(WP_LEAD, "https://wp-client.com"),
    ],
    client_domains: [
      { id: "d0", domain: "client.com", lead_id: LEAD, status: "failed", cf_zone_id: "zone-stale" },
      { id: "d1", domain: "client.com", lead_id: LEAD, status: "live", cf_zone_id: "zone-client" },
      { id: "d2", domain: "unrelated.com", lead_id: OTHER_LEAD, status: "live", cf_zone_id: "zone-unrelated" },
      { id: "d3", domain: "nozone.com", lead_id: NO_ZONE_LEAD, status: "live", cf_zone_id: null },
    ],
    activity_log: [],
    sedcms_links: [
      linkRow(LEAD, HOST),
      linkRow(OTHER_LEAD, OTHER_HOST),
      linkRow(STAGING_LEAD, STAGING),
      linkRow(PROTECTED_LEAD, "sedsolutions.online"),
      linkRow(NO_ZONE_LEAD, NO_ZONE_HOST),
      linkRow(WP_LEAD, "wp-client.com"),
    ],
  }, {}, SEDCMS_UNIQUE);
  state.fromCalls = 0;
  state.siteFilesCalls = 0;
  state.purges = [];
  state.purgeOk = true;
  state.sites = new Map();
  site = new MemSiteFiles("a");
  site.files.set("index.html", enc("<h1>Old</h1>"));
  site.files.set("assets/js/components.js", enc("old();"));
  state.sites.set(HOST, site);
});
afterEach(() => {
  restoreEnv();
  vi.unstubAllGlobals();
});

const apply = (id: string, body: unknown, opts = {}) => applyPOST(signedRequest(leadPath(id, "apply"), body, opts), routeCtx(id));
const logRows = () => state.db!.tables.activity_log.filter((r) => r.action === "studio.site.cms_applied");

describe("apply: checksums first", () => {
  it("a mismatch is a 409 listing every mismatch, and nothing is written", async () => {
    site.files.set("about.html", enc("<p>someone else made this</p>"));
    const res = await apply(LEAD, {
      host: HOST,
      requestId: REQUEST_ID,
      changes: [
        change("index.html", "<h1>Not what is live</h1>", "<h1>New</h1>"),
        change("assets/js/components.js", "old();", "next();"),
        change("about.html", null, "<p>new page</p>"), // null: must not exist, but it does
      ],
    });
    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({
      code: "CONFLICT",
      message: expect.any(String),
      files: [
        { path: "index.html", expectedSha256: sha("<h1>Not what is live</h1>"), liveSha256: sha("<h1>Old</h1>") },
        { path: "about.html", expectedSha256: null, liveSha256: sha("<p>someone else made this</p>") },
      ],
    });
    expect(site.ops.filter((o) => o.includes(":write:"))).toEqual([]);
    expect(new TextDecoder().decode(site.files.get("index.html"))).toBe("<h1>Old</h1>");
    expect(logRows()).toHaveLength(0);
    expect(state.purges).toHaveLength(0);
  });

  it("an expected file that is gone is a conflict too (live null)", async () => {
    const res = await apply(LEAD, { host: HOST, requestId: REQUEST_ID, changes: [change("gone.html", "<p>was here</p>", "<p>x</p>")] });
    expect(res.status).toBe(409);
    expect((await res.json()).files).toEqual([{ path: "gone.html", expectedSha256: sha("<p>was here</p>"), liveSha256: null }]);
  });
});

describe("apply: writing", () => {
  it("reads every target, then writes in the order given, and answers each file's outcome", async () => {
    const res = await apply(LEAD, {
      host: HOST,
      requestId: REQUEST_ID,
      changes: [
        change("cms-media/0123456789abcdef.webp", null, "IMG"),
        change("assets/js/components.js", "old();", "next();"),
        change("index.html", "<h1>Old</h1>", "<h1>New</h1>"),
      ],
    });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      results: [
        { path: "cms-media/0123456789abcdef.webp", outcome: "written", sha256: sha("IMG") },
        { path: "assets/js/components.js", outcome: "written", sha256: sha("next();") },
        { path: "index.html", outcome: "written", sha256: sha("<h1>New</h1>") },
      ],
      purged: true,
    });
    expect(site.ops).toEqual([
      "a:read:cms-media/0123456789abcdef.webp",
      "a:read:assets/js/components.js",
      "a:read:index.html",
      "a:write:cms-media/0123456789abcdef.webp",
      "a:write:assets/js/components.js",
      "a:write:index.html",
    ]);
    expect(new TextDecoder().decode(site.files.get("index.html"))).toBe("<h1>New</h1>");
  });

  it("a file already at its new bytes is unchanged and not written", async () => {
    const res = await apply(LEAD, {
      host: HOST,
      requestId: REQUEST_ID,
      changes: [change("index.html", "<h1>Old</h1>", "<h1>Old</h1>"), change("assets/js/components.js", "old();", "next();")],
    });
    expect(res.status).toBe(200);
    expect((await res.json()).results).toEqual([
      { path: "index.html", outcome: "unchanged", sha256: sha("<h1>Old</h1>") },
      { path: "assets/js/components.js", outcome: "written", sha256: sha("next();") },
    ]);
    expect(site.ops).not.toContain("a:write:index.html");
  });

  it("a retried request whose files are all at their new bytes answers 200, all unchanged", async () => {
    const body = { host: HOST, requestId: REQUEST_ID, changes: [change("index.html", "<h1>Old</h1>", "<h1>New</h1>")] };
    expect((await apply(LEAD, body)).status).toBe(200);
    const again = await apply(LEAD, body);
    expect(again.status).toBe(200);
    expect(await again.json()).toEqual({ results: [{ path: "index.html", outcome: "unchanged", sha256: sha("<h1>New</h1>") }], purged: false });
    expect(site.ops.filter((o) => o.includes(":write:"))).toEqual(["a:write:index.html"]);
    expect(logRows().map((r) => (r.new_value as { outcome: string }).outcome)).toEqual(["applied", "unchanged"]);
    expect(logRows().every((r) => (r.new_value as { requestId: string }).requestId === REQUEST_ID)).toBe(true);
  });

  it("a failure on the second file is a 502 with the first file's result and failed: { path, step }", async () => {
    site.failWrite = "assets/js/components.js";
    site.files.set("about.html", enc("<p>About</p>"));
    const res = await apply(LEAD, {
      host: HOST,
      requestId: REQUEST_ID,
      changes: [
        change("index.html", "<h1>Old</h1>", "<h1>New</h1>"),
        change("assets/js/components.js", "old();", "next();"),
        change("about.html", "<p>About</p>", "<p>About us</p>"),
      ],
    });
    expect(res.status).toBe(502);
    const body = await res.json();
    expect(body).toEqual({
      code: "HOSTING",
      message: expect.any(String),
      results: [{ path: "index.html", outcome: "written", sha256: sha("<h1>New</h1>") }],
      failed: { path: "assets/js/components.js", step: "write" },
    });
    expect(body.message).not.toContain("srv955");
    expect(site.ops).not.toContain("a:write:about.html");
    expect(state.purges).toHaveLength(0);
    const [row] = logRows();
    expect(row.new_value).toEqual({
      requestId: REQUEST_ID,
      host: HOST,
      paths: ["index.html", "assets/js/components.js", "about.html"],
      outcome: "failed",
      written: ["index.html"],
      failed: { path: "assets/js/components.js", step: "write" },
    });
  });

  it("a failed read of a target is a 502 with nothing written", async () => {
    site.failRead = "index.html";
    const res = await apply(LEAD, { host: HOST, requestId: REQUEST_ID, changes: [change("assets/js/components.js", "old();", "x"), change("index.html", "<h1>Old</h1>", "y")] });
    expect(res.status).toBe(502);
    expect(await res.json()).toEqual({ code: "HOSTING", message: expect.any(String), results: [], failed: { path: "index.html", step: "read" } });
    expect(site.ops.filter((o) => o.includes(":write:"))).toEqual([]);
  });

  it("logs one activity row with no user and no file content", async () => {
    const res = await apply(LEAD, { host: HOST, requestId: REQUEST_ID, changes: [change("index.html", "<h1>Old</h1>", "<h1>Secret-ish new text</h1>")] });
    expect(res.status).toBe(200);
    const rows = logRows();
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ user_id: null, action: "studio.site.cms_applied", entity_type: "lead", entity_id: LEAD });
    expect(rows[0].new_value).toEqual({ requestId: REQUEST_ID, host: HOST, paths: ["index.html"], outcome: "applied", written: ["index.html"] });
    expect(JSON.stringify(rows[0])).not.toContain("Secret-ish");
    expect(JSON.stringify(rows[0])).not.toContain(b64("<h1>Secret-ish new text</h1>"));
  });
});

describe("apply: refusals (422 REFUSED) before any read", () => {
  const refused = async (body: unknown, id = LEAD) => {
    const res = await apply(id, body);
    expect(res.status).toBe(422);
    expect((await res.json()).code).toBe("REFUSED");
  };

  it("a path cmsPathAllowed refuses", async () => {
    for (const path of ["../index.html", ".htaccess", "index.php", "x.php.html", "cgi-bin/x.html", "/index.html"]) {
      await refused({ host: HOST, requestId: REQUEST_ID, changes: [change("index.html", "<h1>Old</h1>", "x"), { path, expectedSha256: null, contentBase64: b64("x") }] });
    }
    expect(site.ops).toEqual([]);
    expect(state.siteFilesCalls).toBe(0);
  });

  it("51 files, a repeated path, or a malformed checksum", async () => {
    await refused({ host: HOST, requestId: REQUEST_ID, changes: Array.from({ length: 51 }, (_, i) => change(`p${i}.html`, null, "x")) });
    await refused({ host: HOST, requestId: REQUEST_ID, changes: [change("index.html", null, "x"), change("index.html", null, "y")] });
    for (const expectedSha256 of ["ABC", sha("x").toUpperCase(), `${sha("x")}0`]) {
      await refused({ host: HOST, requestId: REQUEST_ID, changes: [{ path: "index.html", expectedSha256, contentBase64: b64("x") }] });
    }
    expect(site.ops).toEqual([]);
  });

  it("content that isn't strict base64, a file over 5 MiB, or more than 20 MiB in all — sized before decoding", async () => {
    for (const contentBase64 of ["not base64!", "abc", "YWJj=", "YW Jj", `YWJj${String.fromCharCode(10)}`]) {
      await refused({ host: HOST, requestId: REQUEST_ID, changes: [{ path: "index.html", expectedSha256: null, contentBase64 }] });
    }
    const over5 = Buffer.alloc(5 * 1024 * 1024 + 1).toString("base64");
    await refused({ host: HOST, requestId: REQUEST_ID, changes: [{ path: "big.jpg", expectedSha256: null, contentBase64: over5 }] });
    // 5 x 4.2 MiB: each under 5 MiB, 21 MiB in all, and still a body under 30 MiB
    const part = Buffer.alloc(Math.round(4.2 * 1024 * 1024)).toString("base64");
    await refused({
      host: HOST,
      requestId: REQUEST_ID,
      changes: Array.from({ length: 5 }, (_, i) => ({ path: `img${i}.jpg`, expectedSha256: null, contentBase64: part })),
    });
    expect(site.ops).toEqual([]);
  });

  it("a protected host or a site that isn't static", async () => {
    await refused({ host: "sedsolutions.online", requestId: REQUEST_ID, changes: [change("index.html", null, "x")] }, PROTECTED_LEAD);
    installFakeHosts({ websites: [{ domain: "wp-client.com", username: "u1", website_type: "wordpress" }] });
    await refused({ host: "wp-client.com", requestId: REQUEST_ID, changes: [change("index.html", null, "x")] }, WP_LEAD);
    expect(logRows()).toHaveLength(0);
  });

  it("a requestId that isn't a UUID is a 400", async () => {
    const res = await apply(LEAD, { host: HOST, requestId: "1", changes: [] });
    expect(res.status).toBe(400);
  });
});

describe("apply: the signature, the lead and the host come first", () => {
  it("a bad signature is a 401 before anything", async () => {
    const res = await apply(LEAD, { host: HOST, requestId: REQUEST_ID, changes: [change("index.html", "<h1>Old</h1>", "x")] }, { unsigned: true });
    expect(res.status).toBe(401);
    expect(state.fromCalls).toBe(0);
    expect(state.siteFilesCalls).toBe(0);
  });

  it("HOST_CHANGED when the lead's site moved", async () => {
    const res = await apply(LEAD, { host: "old.dmviral.com", requestId: REQUEST_ID, changes: [change("index.html", "<h1>Old</h1>", "x")] });
    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({ code: "HOST_CHANGED", host: HOST, message: expect.any(String) });
    expect(site.ops).toEqual([]);
  });
});

describe("apply: Cloudflare", () => {
  it("purges the written files' URLs on the lead's zone, apex and www, folders for index pages", async () => {
    const res = await apply(LEAD, {
      host: HOST,
      requestId: REQUEST_ID,
      changes: [
        change("index.html", "<h1>Old</h1>", "<h1>New</h1>"),
        change("assets/js/components.js", "old();", "old();"), // unchanged: not purged
        change("services/index.html", null, "<p>s</p>"),
      ],
    });
    expect(res.status).toBe(200);
    expect((await res.json()).purged).toBe(true);
    expect(state.purges).toHaveLength(1);
    expect(state.purges[0].zoneId).toBe("zone-client");
    expect([...state.purges[0].urls].sort()).toEqual(
      [
        "https://www.client.com/index.html",
        "https://www.client.com/",
        "https://client.com/index.html",
        "https://client.com/",
        "https://www.client.com/services/index.html",
        "https://www.client.com/services/",
        "https://client.com/services/index.html",
        "https://client.com/services/",
      ].sort(),
    );
  });

  it("isn't called without a zone, or for a zone that isn't the site's domain", async () => {
    const other = new MemSiteFiles("b");
    other.files.set("index.html", enc("<h1>Old</h1>"));
    state.sites.set(OTHER_HOST, other);
    state.sites.set(NO_ZONE_HOST, other);
    const a = await apply(OTHER_LEAD, { host: OTHER_HOST, requestId: REQUEST_ID, changes: [change("index.html", "<h1>Old</h1>", "x")] });
    expect(a.status).toBe(200);
    expect((await a.json()).purged).toBe(false);
    const b = await apply(NO_ZONE_LEAD, { host: NO_ZONE_HOST, requestId: REQUEST_ID, changes: [change("index.html", "x", "y")] });
    expect(b.status).toBe(200);
    expect((await b.json()).purged).toBe(false);
    expect(state.purges).toHaveLength(0);
  });

  it("a failed purge doesn't fail the apply", async () => {
    state.purgeOk = false;
    const res = await apply(LEAD, { host: HOST, requestId: REQUEST_ID, changes: [change("index.html", "<h1>Old</h1>", "<h1>New</h1>")] });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ results: [{ path: "index.html", outcome: "written", sha256: sha("<h1>New</h1>") }], purged: false });
    expect(state.purges).toHaveLength(1);
  });

  it("purgeCacheByUrls posts the URLs to the zone's purge_cache, 30 at a time", async () => {
    const real = await vi.importActual<typeof import("@/lib/cloudflare/client")>("@/lib/cloudflare/client");
    const calls: { url: string; body: unknown; auth: string | null }[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string, init: RequestInit) => {
        calls.push({ url, body: JSON.parse(String(init.body)), auth: new Headers(init.headers).get("authorization") });
        return Response.json({ success: true, result: { id: "zone-client" } });
      }),
    );
    const urls = Array.from({ length: 61 }, (_, i) => `https://client.com/p${i}.html`);
    expect(await real.purgeCacheByUrls("zone-client", urls)).toEqual({ ok: true });
    expect(calls.map((c) => c.url)).toEqual(Array(3).fill("https://api.cloudflare.com/client/v4/zones/zone-client/purge_cache"));
    expect(calls.map((c) => (c.body as { files: string[] }).files.length)).toEqual([30, 30, 1]);
    expect(calls[0].auth).toBe("Bearer cf-test");
  });
});

describe("apply: one at a time per site", () => {
  it("two applies for one host run one after the other; another site's doesn't wait", async () => {
    let release!: () => void;
    site.gate = new Promise<void>((r) => (release = r));
    site.files.set("about.html", enc("<p>About</p>"));
    const other = new MemSiteFiles("b");
    other.files.set("index.html", enc("<h1>Old</h1>"));
    state.sites.set(OTHER_HOST, other);

    const first = apply(LEAD, { host: HOST, requestId: REQUEST_ID, changes: [change("index.html", "<h1>Old</h1>", "<h1>New</h1>")] });
    await until(() => site.ops.includes("a:write:index.html")); // the first holds the site, mid-write
    const second = apply(LEAD, { host: HOST, requestId: "6f0c2d1e-3b4a-4c5d-8e6f-7a8b9c0d1e2f", changes: [change("about.html", "<p>About</p>", "<p>About us</p>")] });
    const elsewhere = apply(OTHER_LEAD, { host: OTHER_HOST, requestId: REQUEST_ID, changes: [change("index.html", "<h1>Old</h1>", "x")] });

    expect((await elsewhere).status).toBe(200); // not held by client.com's lock
    await new Promise((r) => setTimeout(r, 20));
    expect(site.ops).toEqual(["a:read:index.html", "a:write:index.html"]); // the second hasn't started
    release();
    expect((await first).status).toBe(200);
    expect((await second).status).toBe(200);
    expect(site.ops).toEqual(["a:read:index.html", "a:write:index.html", "a:read:about.html", "a:write:about.html"]);
  });

  it("a failed apply releases the site for the next one", async () => {
    site.failWrite = "index.html";
    expect((await apply(LEAD, { host: HOST, requestId: REQUEST_ID, changes: [change("index.html", "<h1>Old</h1>", "x")] })).status).toBe(502);
    site.failWrite = null;
    expect((await apply(LEAD, { host: HOST, requestId: REQUEST_ID, changes: [change("index.html", "<h1>Old</h1>", "x")] })).status).toBe(200);
  });
});

describe("apply: 240 s from when the request was accepted, on fake time", () => {
  beforeEach(() => vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "Date"] }));
  afterEach(() => vi.useRealTimers());

  /** Lets requests run on (setImmediate is real under these fake timers) until done() holds. */
  async function flushUntil(done: () => boolean) {
    for (let i = 0; i < 1000 && !done(); i++) await new Promise((resolve) => setImmediate(resolve));
    if (!done()) throw new Error("timed out waiting");
  }

  it("a cut apply answers what was written and the first file that wasn't, starts no write after 240 s, and isn't purged", async () => {
    site.writeDelayMs = 100_000;
    site.files.set("about.html", enc("<p>About</p>"));
    site.files.set("contact.html", enc("<p>Contact</p>"));
    const start = Date.now();
    const pending = apply(LEAD, {
      host: HOST,
      requestId: REQUEST_ID,
      changes: [
        change("index.html", "<h1>Old</h1>", "<h1>New</h1>"),
        change("assets/js/components.js", "old();", "next();"),
        change("about.html", "<p>About</p>", "<p>About us</p>"),
        change("contact.html", "<p>Contact</p>", "<p>Contact us</p>"),
      ],
    });
    await vi.advanceTimersByTimeAsync(600_000);
    const res = await pending;
    expect(res.status).toBe(502);
    const body = await res.json();
    expect(body).toEqual({
      code: "HOSTING",
      message: expect.any(String),
      results: [
        { path: "index.html", outcome: "written", sha256: sha("<h1>New</h1>") },
        { path: "assets/js/components.js", outcome: "written", sha256: sha("next();") },
        { path: "about.html", outcome: "written", sha256: sha("<p>About us</p>") },
      ],
      failed: { path: "contact.html", step: "write" },
    });
    expect(body.message).toMatch(/time/);
    expect(site.writeTimes).toHaveLength(3);
    for (const t of site.writeTimes) expect(t).toBeLessThan(start + 240_000);
    expect(site.ops).not.toContain("a:write:contact.html");
    expect(state.purges).toHaveLength(0);
    const [row] = logRows();
    expect(row.new_value).toEqual({
      requestId: REQUEST_ID,
      host: HOST,
      paths: ["index.html", "assets/js/components.js", "about.html", "contact.html"],
      outcome: "failed",
      written: ["index.html", "assets/js/components.js", "about.html"],
      failed: { path: "contact.html", step: "write" },
      timedOut: true,
    });
  });

  it("an apply that waited behind another past its own deadline reads and writes nothing; the first isn't purged once its deadline has passed", async () => {
    site.writeDelayMs = 250_000;
    site.files.set("about.html", enc("<p>About</p>"));
    const first = apply(LEAD, { host: HOST, requestId: REQUEST_ID, changes: [change("index.html", "<h1>Old</h1>", "<h1>New</h1>")] });
    await flushUntil(() => site.ops.includes("a:write:index.html"));
    const second = apply(LEAD, {
      host: HOST,
      requestId: "6f0c2d1e-3b4a-4c5d-8e6f-7a8b9c0d1e2f",
      changes: [change("about.html", "<p>About</p>", "<p>About us</p>")],
    });
    await vi.advanceTimersByTimeAsync(600_000);
    const [a, b] = [await first, await second];

    expect(a.status).toBe(200);
    expect(await a.json()).toEqual({ results: [{ path: "index.html", outcome: "written", sha256: sha("<h1>New</h1>") }], purged: false });
    expect(state.purges).toHaveLength(0);

    expect(b.status).toBe(502);
    expect(await b.json()).toEqual({ code: "HOSTING", message: expect.any(String), results: [], failed: { path: "about.html", step: "read" } });
    expect(site.ops).not.toContain("a:read:about.html");
    expect(site.ops).not.toContain("a:write:about.html");
    expect(logRows().map((r) => (r.new_value as { requestId: string }).requestId)).toEqual([REQUEST_ID]);
  });
});

describe("apply end to end, on a staging subdomain (DirectAdmin faked)", () => {
  it("writes the bytes, and checksums then reads them back", async () => {
    const hosts = installFakeHosts();
    const docroot = daDocroot("acme-roofing");
    hosts.da.put(`${docroot}/index.html`, "<h1>Old</h1>");
    const png = Uint8Array.from({ length: 300 }, (_, i) => (i * 7) % 256);

    const res = await apply(STAGING_LEAD, {
      host: STAGING,
      requestId: REQUEST_ID,
      changes: [
        { path: "cms-media/0123456789abcdef.png", expectedSha256: null, contentBase64: b64(png) },
        change("index.html", "<h1>Old</h1>", "<h1>New</h1>"),
      ],
    });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      results: [
        { path: "cms-media/0123456789abcdef.png", outcome: "written", sha256: sha(png) },
        { path: "index.html", outcome: "written", sha256: sha("<h1>New</h1>") },
      ],
      purged: false,
    });
    expect(hosts.da.files.get(`${docroot}/cms-media/0123456789abcdef.png`)).toEqual(png);
    expect(hosts.da.text(`${docroot}/index.html`)).toBe("<h1>New</h1>");

    const check = await checksumsPOST(
      signedRequest(leadPath(STAGING_LEAD, "checksums"), { host: STAGING, paths: ["index.html", "cms-media/0123456789abcdef.png"] }),
      routeCtx(STAGING_LEAD),
    );
    expect(await check.json()).toEqual({
      files: [
        { path: "index.html", sha256: sha("<h1>New</h1>") },
        { path: "cms-media/0123456789abcdef.png", sha256: sha(png) },
      ],
    });
  });
});
