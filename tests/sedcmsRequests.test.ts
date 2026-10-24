// @vitest-environment node
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { createHash } from "node:crypto";
import { memorySupabase, type MemoryDb } from "./helpers/memorySupabase";
import { fakeHostEnv, withEnv } from "./helpers/fakeSiteHosts";
import { SEDCMS_DEFAULTS, SEDCMS_UNIQUE, TEST_SECRET, leadPath, linkRow, routeCtx, signedRequest } from "./helpers/sedcmsRoutes";
import type { SiteFiles } from "@/lib/sedcms/files";

/**
 * A request id is single-use in the database (lib/sedcms/requests.ts,
 * migration 0094's sedcms_requests): the security review's M2. The replay
 * cache is per process, and a rollback puts back exactly the bytes an old
 * apply expected, so a captured apply replayed on the other LMS process
 * passed the checksum guard and undid the rollback (probe-replay-two-processes,
 * here inverted). An apply claims its id before anything is read or written.
 */

class MemSite implements SiteFiles {
  readonly files = new Map<string, Uint8Array>();
  writes = 0;
  gate: Promise<void> | null = null;
  async list() {
    return { files: [...this.files.entries()].map(([path, b]) => ({ path, size: b.length })), truncated: false };
  }
  async read(path: string) {
    return this.files.get(path) ?? null;
  }
  async write(path: string, bytes: Uint8Array) {
    if (this.gate) await this.gate;
    this.writes++;
    this.files.set(path, bytes);
  }
}

const state = vi.hoisted(() => ({ db: null as MemoryDb | null, site: null as unknown, failClaim: null as { code?: string; message: string } | null }));
vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => ({
    from: (t: string) => {
      if (t === "sedcms_requests" && state.failClaim) {
        const error = state.failClaim;
        return { insert: async () => ({ data: null, error }) };
      }
      return state.db!.client.from(t);
    },
  }),
}));
vi.mock("@/lib/sedcms/files", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/sedcms/files")>();
  return { ...actual, siteFilesFor: async (host: string) => ({ ok: true, files: state.site, kind: "custom", host, key: `custom:${host}` }) };
});

import { POST as applyPOST } from "@/app/api/internal/sedcms/leads/[id]/apply/route";

const LEAD = "11111111-1111-4111-8111-111111111111";
const OTHER_LEAD = "22222222-2222-4222-8222-222222222222";
const HOST = "client.com";
const enc = (s: string) => new TextEncoder().encode(s);
const dec = (b: Uint8Array | undefined) => new TextDecoder().decode(b);
const sha = (s: string) => createHash("sha256").update(s).digest("hex");
const b64 = (s: string) => Buffer.from(s).toString("base64");
const CACHE = Symbol.for("sedcms.replayCache");
const LOCKS = Symbol.for("sedcms.applyLocks");
const PUBLISH = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const ROLLBACK = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";

/** Another LMS process: its own replay cache and its own site locks (the database is shared). */
function otherProcess() {
  delete (globalThis as Record<symbol, unknown>)[CACHE];
  (globalThis as Record<symbol, unknown>)[LOCKS] = new Map();
}

/** What an eavesdropper keeps of a request: its bytes and headers, sent again later. */
async function capture(req: Request) {
  const body = await req.clone().text();
  const headers: Record<string, string> = {};
  req.headers.forEach((v, k) => (headers[k] = v));
  return () => new Request(req.url, { method: "POST", headers, body });
}

const change = (from: string, to: string) => ({ path: "index.html", expectedSha256: sha(from), contentBase64: b64(to) });
const apply = (leadId: string, requestId: string, from: string, to: string) =>
  applyPOST(signedRequest(leadPath(leadId, "apply"), { host: HOST, requestId, changes: [change(from, to)] }), routeCtx(leadId));

let restore: () => void;
let site: MemSite;
beforeEach(() => {
  restore = withEnv({ ...fakeHostEnv(), SEDCMS_LMS_SECRET: TEST_SECRET });
  state.db = memorySupabase(
    {
      leads: [
        { id: LEAD, business_name: "Client", business_email: null, status: "Ready", website_link: `https://${HOST}`, deleted_at: null },
        { id: OTHER_LEAD, business_name: "Other", business_email: null, status: "Ready", website_link: "https://other.com", deleted_at: null },
      ],
      client_domains: [],
      activity_log: [],
      sedcms_links: [linkRow(LEAD, HOST), linkRow(OTHER_LEAD, "other.com")],
      sedcms_requests: [],
    },
    SEDCMS_DEFAULTS,
    SEDCMS_UNIQUE,
  );
  state.failClaim = null;
  site = new MemSite();
  site.files.set("index.html", enc("<h1>Price: $10</h1>"));
  state.site = site;
  delete (globalThis as Record<symbol, unknown>)[CACHE];
});
afterEach(() => {
  restore();
  delete (globalThis as Record<symbol, unknown>)[CACHE];
});

const claims = () => state.db!.tables.sedcms_requests;

describe("probe-replay-two-processes, inverted", () => {
  it("a captured apply replayed on the other process after a rollback writes nothing: 409 REQUEST_ID_USED", async () => {
    const ctx = routeCtx(LEAD);
    // 1. the client publishes a price change, v1 -> v2; someone captures the request
    const publish = await capture(signedRequest(leadPath(LEAD, "apply"), { host: HOST, requestId: PUBLISH, changes: [change("<h1>Price: $10</h1>", "<h1>Price: $99</h1>")] }));
    expect((await applyPOST(publish(), ctx)).status).toBe(200);
    expect(dec(site.files.get("index.html"))).toBe("<h1>Price: $99</h1>");
    // 2. staff roll it back: v2 -> v1, a new request
    expect((await apply(LEAD, ROLLBACK, "<h1>Price: $99</h1>", "<h1>Price: $10</h1>")).status).toBe(200);
    expect(dec(site.files.get("index.html"))).toBe("<h1>Price: $10</h1>");
    // 3a. replayed on the same process: the replay cache refuses it
    expect((await applyPOST(publish(), ctx)).status).toBe(401);
    // 3b. replayed on the other process, within 300 s: the database refuses it
    otherProcess();
    const replayed = await applyPOST(publish(), ctx);
    expect(replayed.status).toBe(409);
    expect(await replayed.json()).toEqual({ code: "REQUEST_ID_USED", message: expect.any(String) });
    expect(dec(site.files.get("index.html"))).toBe("<h1>Price: $10</h1>"); // the rollback stands
    expect(site.writes).toBe(2);
    expect(claims().map((r) => r.request_id)).toEqual([PUBLISH, ROLLBACK]);
  });
});

describe("an apply's request id is single-use", () => {
  it("is claimed before the first read, with the lead, the kind and a digest of what was asked", async () => {
    expect((await apply(LEAD, PUBLISH, "<h1>Price: $10</h1>", "<h1>Price: $99</h1>")).status).toBe(200);
    expect(claims()).toEqual([
      expect.objectContaining({ request_id: PUBLISH, lead_id: LEAD, kind: "apply", digest: expect.stringMatching(/^[0-9a-f]{64}$/) }),
    ]);
  });

  it("a retry whose files are all at its new bytes answers 200, all unchanged, writing nothing (the plan's retry rule)", async () => {
    expect((await apply(LEAD, PUBLISH, "<h1>Price: $10</h1>", "<h1>Price: $99</h1>")).status).toBe(200);
    otherProcess();
    const again = await apply(LEAD, PUBLISH, "<h1>Price: $10</h1>", "<h1>Price: $99</h1>");
    expect(again.status).toBe(200);
    expect(await again.json()).toEqual({ results: [{ path: "index.html", outcome: "unchanged", sha256: sha("<h1>Price: $99</h1>") }], purged: false });
    expect(site.writes).toBe(1);
  });

  it("a retry after a conflict is refused too: the id was used", async () => {
    const first = await apply(LEAD, PUBLISH, "<h1>Price: $11</h1>", "<h1>Price: $99</h1>");
    expect(first.status).toBe(409);
    expect((await first.json()).code).toBe("CONFLICT");
    // the live file now happens to be the one the stale request expected
    site.files.set("index.html", enc("<h1>Price: $11</h1>"));
    otherProcess();
    const replay = await apply(LEAD, PUBLISH, "<h1>Price: $11</h1>", "<h1>Price: $99</h1>");
    expect(replay.status).toBe(409);
    expect((await replay.json()).code).toBe("REQUEST_ID_USED");
    expect(site.writes).toBe(0);
  });

  it("an id used on another lead, or for other changes, is refused even when the files are at the new bytes", async () => {
    expect((await apply(LEAD, PUBLISH, "<h1>Price: $10</h1>", "<h1>Price: $99</h1>")).status).toBe(200);
    const elsewhere = await applyPOST(
      signedRequest(leadPath(OTHER_LEAD, "apply"), { host: "other.com", requestId: PUBLISH, changes: [change("<h1>Price: $10</h1>", "<h1>Price: $99</h1>")] }),
      routeCtx(OTHER_LEAD),
    );
    expect(elsewhere.status).toBe(409);
    expect((await elsewhere.json()).code).toBe("REQUEST_ID_USED");
    const other = await applyPOST(
      signedRequest(leadPath(LEAD, "apply"), { host: HOST, requestId: PUBLISH, changes: [{ path: "index.html", expectedSha256: null, contentBase64: b64("<h1>Price: $99</h1>") }] }),
      routeCtx(LEAD),
    );
    expect(other.status).toBe(409);
    expect(site.writes).toBe(1);
  });

  it("two deliveries of one apply on two processes at once: exactly one writes", async () => {
    let release!: () => void;
    site.gate = new Promise<void>((r) => (release = r));
    const a = apply(LEAD, PUBLISH, "<h1>Price: $10</h1>", "<h1>Price: $99</h1>"); // process 1, held mid-write
    for (let i = 0; i < 100 && claims().length === 0; i++) await new Promise((r) => setTimeout(r, 1));
    otherProcess();
    const b = await apply(LEAD, PUBLISH, "<h1>Price: $10</h1>", "<h1>Price: $99</h1>"); // process 2
    expect(b.status).toBe(409);
    expect((await b.json()).code).toBe("REQUEST_ID_USED");
    release();
    expect((await a).status).toBe(200);
    expect(site.writes).toBe(1);
  });

  it("when the id can't be recorded nothing is read or written: 500, or 503 while migration 0094 isn't applied", async () => {
    const quiet = vi.spyOn(console, "error").mockImplementation(() => {});
    const reads = vi.spyOn(site, "read");
    state.failClaim = { message: "canceling statement due to statement timeout" };
    const res = await apply(LEAD, PUBLISH, "<h1>Price: $10</h1>", "<h1>Price: $99</h1>");
    expect(res.status).toBe(500);
    expect((await res.json()).code).toBe("INTERNAL");
    state.failClaim = { message: 'relation "public.sedcms_requests" does not exist' };
    const missing = await apply(LEAD, ROLLBACK, "<h1>Price: $10</h1>", "<h1>Price: $99</h1>");
    expect(missing.status).toBe(503);
    expect((await missing.json()).code).toBe("NOT_CONFIGURED");
    expect(reads).not.toHaveBeenCalled();
    expect(site.writes).toBe(0);
    quiet.mockRestore();
  });
});
