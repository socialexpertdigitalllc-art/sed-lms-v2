// @vitest-environment node
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { createHash } from "node:crypto";
import { memorySupabase, type MemoryDb } from "./helpers/memorySupabase";
import { HG_FILES, daDocroot, fakeHostEnv, installFakeHosts, withEnv, type FakeHosts } from "./helpers/fakeSiteHosts";
import { TEST_SECRET, leadPath, linkRow, routeCtx, signedRequest } from "./helpers/sedcmsRoutes";
import { APPLY_DEADLINE_MS, Deadline, HOST_CALL_TIMEOUT_MS, READ_DEADLINE_MS } from "@/lib/sedcms/deadline";
import { applyChanges, type DecodedChange } from "@/lib/sedcms/apply";
import { SiteFilesError, siteFilesFor, type CallLimits, type SiteFiles } from "@/lib/sedcms/files";
import {
  listWebsiteDir,
  makeWebsiteFolder,
  moveWebsiteFile,
  readWebsiteFile,
  removeWebsiteFile,
  statWebsiteFile,
  uploadWebsiteFile,
  type FileSession,
} from "@/lib/hostinger/client";
import { listDocrootDir, makeDaFolder, moveDaFile, readDocrootFile, removeDaPaths, uploadDaFile } from "@/lib/template-engine/directadmin";
import { purgeCacheByUrls } from "@/lib/cloudflare/client";

/**
 * Time limits on everything SED CMS makes the LMS do to a host (the M3
 * security review): the CMS's publish lease assumes an apply ends within
 * 300 s, and the installed Next.js doesn't enforce maxDuration on a
 * self-hosted server. So:
 *   - every single-file host call has its own 30 s, through an AbortSignal;
 *   - an apply starts no read or write after 240 s from when its request was
 *     accepted, and a write in flight then finishes on its own 30 s;
 *   - live-files and checksums stop at 100 s, under the CMS's 120 s.
 * Everything runs on fake timers: no real waits.
 */

const state = vi.hoisted(() => ({ db: null as MemoryDb | null }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => state.db!.client }));

import { POST as liveFilesPOST } from "@/app/api/internal/sedcms/leads/[id]/live-files/route";
import { POST as checksumsPOST } from "@/app/api/internal/sedcms/leads/[id]/checksums/route";

const STAGING = "acme-roofing.dmviral.com";
const LEAD = "11111111-1111-4111-8111-111111111111";
const docroot = daDocroot("acme-roofing");
const enc = (s: string) => new TextEncoder().encode(s);
const sha = (b: string | Uint8Array) => createHash("sha256").update(b).digest("hex");
const pad = (i: number) => String(i).padStart(2, "0");

/** A promise's outcome, and when (on the fake clock) it settled. */
function track<T>(p: Promise<T>) {
  const s = { done: false, at: 0, value: undefined as T | undefined, error: undefined as unknown };
  p.then(
    (v) => Object.assign(s, { done: true, at: Date.now(), value: v }),
    (e) => Object.assign(s, { done: true, at: Date.now(), error: e }),
  );
  return s;
}

const advance = (ms: number) => vi.advanceTimersByTimeAsync(ms);
const abortError = () => new DOMException("This operation was aborted", "AbortError");

/** setTimeout-based (fake-timer driven); rejects when the signal aborts. Infinity waits for the signal; 0 doesn't wait. */
function wait(ms: number, signal?: AbortSignal | null): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) return reject(abortError());
    if (ms === 0) return resolve();
    const timer = Number.isFinite(ms) ? setTimeout(resolve, ms) : null;
    signal?.addEventListener("abort", () => {
      if (timer) clearTimeout(timer);
      reject(abortError());
    }, { once: true });
  });
}

/** A fetch that never answers: it ends only when its signal aborts, like a real one. */
function hangingFetch(answer?: (url: string, init: RequestInit) => Response | null) {
  const calls: { url: string; method: string; at: number }[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init: RequestInit = {}) => {
      calls.push({ url: String(url), method: init.method ?? "GET", at: Date.now() });
      const quick = answer?.(String(url), init);
      if (quick) return quick;
      await wait(Infinity, init.signal);
      throw abortError();
    }),
  );
  return calls;
}

let restoreEnv: () => void;
beforeEach(() => {
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "Date"] });
  restoreEnv = withEnv({ ...fakeHostEnv(), SEDCMS_LMS_SECRET: TEST_SECRET, CLOUDFLARE_API_TOKEN: "cf-test", CLOUDFLARE_ACCOUNT_ID: "acct" });
});
afterEach(() => {
  restoreEnv();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe("the limits", () => {
  it("are 30 s a host call, 240 s an apply, 100 s a read route", () => {
    expect(HOST_CALL_TIMEOUT_MS).toBe(30_000);
    expect(APPLY_DEADLINE_MS).toBe(240_000);
    expect(READ_DEADLINE_MS).toBe(100_000);
  });

  it("a Deadline passes at its time, aborting its signal; disposed, its timer is gone", async () => {
    const d = new Deadline(Date.now() + 1_000);
    expect(d.passed()).toBe(false);
    await advance(999);
    expect(d.passed()).toBe(false);
    expect(d.signal.aborted).toBe(false);
    await advance(1);
    expect(d.passed()).toBe(true);
    expect(d.signal.aborted).toBe(true);

    const gone = new Deadline(Date.now() + 1_000);
    gone.dispose();
    expect(vi.getTimerCount()).toBe(0);
    expect(new Deadline(Date.now() - 1).passed()).toBe(true);
  });
});

describe("every single-file host call has its own 30 s", () => {
  const session: FileSession = {
    tusUrl: `${HG_FILES}/api/tus/public_html`,
    restBase: HG_FILES,
    dir: "/public_html",
    headers: { "X-Auth": "AK", "X-Auth-Rest": "RK" },
  };
  const bytes = enc("<h1>x</h1>");

  const calls: [string, () => Promise<unknown>][] = [
    ["Hostinger: a folder listing", () => listWebsiteDir(session, "")],
    ["Hostinger: a raw read", () => readWebsiteFile(session, "index.html", 1024)],
    ["Hostinger: a temporary file's TUS create", () => uploadWebsiteFile(session, "/sedcms-0123456789abcdef.tmp", bytes)],
    ["Hostinger: a temporary file's check", () => statWebsiteFile(session, "/sedcms-0123456789abcdef.tmp")],
    ["Hostinger: the move", () => moveWebsiteFile(session, "/sedcms-0123456789abcdef.tmp", "/public_html/index.html")],
    ["Hostinger: a removal", () => removeWebsiteFile(session, "/sedcms-0123456789abcdef.tmp")],
    ["Hostinger: making a folder", () => makeWebsiteFolder(session, "/public_html/cms-media")],
    ["DirectAdmin: a folder listing", () => listDocrootDir("acme", "")],
    ["DirectAdmin: a single-file read", () => readDocrootFile("acme", "index.html", 1024)],
    ["DirectAdmin: an upload", () => uploadDaFile("/domains/acme.dmviral.com", "sedcms-0123456789abcdef.tmp", bytes)],
    ["DirectAdmin: the move", () => moveDaFile("/domains/acme.dmviral.com/sedcms-0123456789abcdef.tmp", "/domains/acme.dmviral.com/public_html/index.html")],
    ["DirectAdmin: making a folder", () => makeDaFolder("/domains/acme.dmviral.com/public_html/cms-media")],
    ["DirectAdmin: a removal", () => removeDaPaths(["/domains/acme.dmviral.com/sedcms-0123456789abcdef.tmp"])],
    ["Cloudflare: a purge", () => purgeCacheByUrls("zone-1", ["https://client.com/"])],
  ];

  it.each(calls)("%s that never answers is given up at 30 s, and not retried", async (_name, call) => {
    const fetched = hangingFetch();
    const run = track(call());
    await advance(HOST_CALL_TIMEOUT_MS - 1);
    expect(run.done).toBe(false);
    await advance(1);
    expect(run.done).toBe(true);
    expect(run.error).toBeUndefined(); // an answer, never a throw
    const v = run.value as { ok?: boolean } | null;
    expect(v === null || v.ok === false).toBe(true);
    expect(fetched).toHaveLength(1);
  });

  it("the second step of a call gets its own 30 s too: a TUS patch", async () => {
    const fetched = hangingFetch((url, init) => (init.method === "POST" && url.includes("/api/tus/") ? new Response(null, { status: 201 }) : null));
    const tus = track(uploadWebsiteFile(session, "/sedcms-0123456789abcdef.tmp", bytes));
    await advance(HOST_CALL_TIMEOUT_MS);
    expect(tus.done).toBe(true);
    expect(tus.value).toMatchObject({ ok: false });
    expect(fetched.map((c) => c.method)).toEqual(["POST", "PATCH"]);
  });

  it("reads, listings and purges also stop the moment the caller's signal aborts", async () => {
    for (const call of [
      (signal: AbortSignal) => readWebsiteFile(session, "index.html", 1024, { signal }),
      (signal: AbortSignal) => listWebsiteDir(session, "", { signal }),
      (signal: AbortSignal) => readDocrootFile("acme", "index.html", 1024, { signal }),
      (signal: AbortSignal) => listDocrootDir("acme", "", { signal }),
      (signal: AbortSignal) => purgeCacheByUrls("zone-1", ["https://client.com/"], { signal }),
    ]) {
      const fetched = hangingFetch();
      const controller = new AbortController();
      const run = track<unknown>(call(controller.signal));
      setTimeout(() => controller.abort(), 5_000);
      await advance(5_000);
      expect(run.done).toBe(true);
      expect(run.error).toBeUndefined();
      expect(fetched).toHaveLength(1);
      vi.unstubAllGlobals();
    }
  });

  it("a purge starts no batch once its signal has aborted", async () => {
    const fetched = hangingFetch();
    const controller = new AbortController();
    controller.abort();
    expect(await purgeCacheByUrls("zone-1", ["https://client.com/"], { signal: controller.signal })).toMatchObject({ ok: false });
    expect(fetched).toHaveLength(0);
  });
});

/** A site whose reads and writes take time; reads stop at the deadline, as the real ones do; a write in flight is never cut. */
class SlowSiteFiles implements SiteFiles {
  readonly files = new Map<string, Uint8Array>();
  readonly log: { op: "read" | "write"; path: string; at: number }[] = [];
  constructor(
    private readonly readMs: number,
    private readonly writeMs: number,
  ) {}
  async list() {
    return { files: [], truncated: false };
  }
  async read(path: string, _max: number, limits: CallLimits = {}) {
    this.log.push({ op: "read", path, at: Date.now() });
    try {
      await wait(this.readMs, limits.deadline?.signal);
    } catch {
      throw new SiteFilesError("read", "deadline", "out of time", path);
    }
    return this.files.get(path) ?? null;
  }
  async write(path: string, bytes: Uint8Array) {
    this.log.push({ op: "write", path, at: Date.now() });
    await wait(this.writeMs);
    this.files.set(path, bytes);
  }
}

function newFiles(n: number, prefix = "p"): DecodedChange[] {
  return Array.from({ length: n }, (_, i) => {
    const bytes = enc(`<p>new ${i}</p>`);
    return { path: `${prefix}${pad(i)}.html`, expectedSha256: null, bytes, sha256: sha(bytes) };
  });
}

describe("applyChanges stops at its deadline", () => {
  it("starts no write after it: what was written is answered, and the first file that wasn't", async () => {
    const site = new SlowSiteFiles(0, 50_000);
    const start = Date.now();
    const deadline = new Deadline(start + APPLY_DEADLINE_MS);
    const run = track(applyChanges(site, newFiles(8), { deadline }));
    await advance(400_000);
    expect(run.done).toBe(true);
    const out = run.value!;
    expect(out).toMatchObject({ kind: "failed", cut: true, wrote: true, failed: { path: "p05.html", step: "write" } });
    expect((out as { results: { path: string; outcome: string }[] }).results.map((r) => [r.path, r.outcome])).toEqual(
      [0, 1, 2, 3, 4].map((i) => [`p${pad(i)}.html`, "written"]),
    );
    const writes = site.log.filter((l) => l.op === "write");
    expect(writes.map((w) => w.path)).toEqual(["p00.html", "p01.html", "p02.html", "p03.html", "p04.html"]);
    for (const w of writes) expect(w.at).toBeLessThan(start + APPLY_DEADLINE_MS);
    expect(run.at - start).toBe(250_000); // the write in flight at 240 s finished, nothing after it
    deadline.dispose();
  });

  it("a write in flight at the deadline finishes and is counted", async () => {
    const site = new SlowSiteFiles(0, 50_000);
    const start = Date.now();
    const deadline = new Deadline(start + 220_000);
    const run = track(applyChanges(site, newFiles(8), { deadline }));
    await advance(400_000);
    expect(run.value).toMatchObject({ kind: "failed", cut: true, failed: { path: "p05.html", step: "write" } });
    expect(site.files.get("p04.html")).toEqual(enc("<p>new 4</p>"));
    deadline.dispose();
  });

  it("a read still running at the deadline is stopped there, and nothing is written", async () => {
    const site = new SlowSiteFiles(100_000, 0);
    const start = Date.now();
    const deadline = new Deadline(start + APPLY_DEADLINE_MS);
    const run = track(applyChanges(site, newFiles(3), { deadline }));
    await advance(400_000);
    expect(run.value).toEqual({ kind: "failed", cut: true, wrote: false, results: [], failed: { path: "p02.html", step: "read" } });
    expect(run.at - start).toBe(APPLY_DEADLINE_MS);
    expect(site.log.filter((l) => l.op === "write")).toEqual([]);
    deadline.dispose();
  });

  it("a deadline already past (the request waited behind another apply) reads and writes nothing", async () => {
    const site = new SlowSiteFiles(0, 0);
    const out = await applyChanges(site, newFiles(3), { deadline: new Deadline(Date.now() - 1) });
    expect(out).toEqual({ kind: "failed", cut: true, wrote: false, results: [], failed: { path: "p00.html", step: "read" } });
    expect(site.log).toEqual([]);
  });
});

describe("through the real host clients (DirectAdmin faked), on fake time", () => {
  let hosts: FakeHosts;
  const isUpload = (url: string) => url.includes("/api/filemanager-actions/upload");
  const isMove = (url: string) => url.includes("/api/filemanager-actions/move");
  const isExtract = (url: string) => url.includes("/api/filemanager-actions/extract-archive");

  function existing(n: number): DecodedChange[] {
    return Array.from({ length: n }, (_, i) => {
      const bytes = enc(`<p>new ${i}</p>`);
      return { path: `p${pad(i)}.html`, expectedSha256: sha(`<p>old ${i}</p>`), bytes, sha256: sha(bytes) };
    });
  }

  async function staging(n: number) {
    for (let i = 0; i < n; i++) hosts.da.put(`${docroot}/p${pad(i)}.html`, `<p>old ${i}</p>`);
    const site = await siteFilesFor(STAGING);
    if (!site.ok) throw new Error(site.error);
    return site.files;
  }

  it("slow uploads: no upload or move begins after 240 s; one uploaded as it passed is never moved in", async () => {
    hosts = installFakeHosts({ delay: (c) => (isUpload(c.url) ? 25_000 : 0) });
    const files = await staging(12);
    const start = Date.now();
    const deadline = new Deadline(start + APPLY_DEADLINE_MS);
    const run = track(applyChanges(files, existing(12), { deadline }));
    await advance(400_000);
    expect(run.value).toMatchObject({ kind: "failed", cut: true, wrote: true, failed: { path: "p09.html", step: "write" } });
    expect((run.value as { results: unknown[] }).results).toHaveLength(9);
    const uploads = hosts.calls.filter((c) => isUpload(c.url));
    expect(uploads).toHaveLength(10);
    for (const u of uploads) expect(u.at).toBeLessThan(start + APPLY_DEADLINE_MS);
    const moves = hosts.calls.filter((c) => isMove(c.url));
    expect(moves).toHaveLength(9);
    for (const m of moves) expect(m.at).toBeLessThan(start + APPLY_DEADLINE_MS);
    // after the deadline only the clean-up started
    expect(hosts.calls.filter((c) => c.at >= start + APPLY_DEADLINE_MS).every((c) => c.url.includes("/filemanager-actions/remove"))).toBe(true);
    expect(hosts.da.text(`${docroot}/p08.html`)).toBe("<p>new 8</p>");
    expect(hosts.da.text(`${docroot}/p09.html`)).toBe("<p>old 9</p>");
    expect(hosts.da.temps()).toEqual([]);
    deadline.dispose();
  });

  it("a download that never answers ends the apply at its own 30 s, with nothing written", async () => {
    hosts = installFakeHosts({ hang: (c) => c.url.includes("/api/filemanager/download") && c.url.includes("p03.html") });
    const files = await staging(6);
    const start = Date.now();
    const deadline = new Deadline(start + APPLY_DEADLINE_MS);
    const run = track(applyChanges(files, existing(6), { deadline }));
    await advance(400_000);
    expect(run.value).toEqual({ kind: "failed", cut: false, wrote: false, results: [], failed: { path: "p03.html", step: "read" } });
    expect(run.at - start).toBe(HOST_CALL_TIMEOUT_MS);
    expect(hosts.calls.filter((c) => isUpload(c.url))).toEqual([]);
    deadline.dispose();
  });

  it("an upload that never answers ends the apply at its own 30 s; nothing after it is started", async () => {
    let uploads = 0;
    hosts = installFakeHosts({ hang: (c) => isUpload(c.url) && ++uploads === 2 });
    const files = await staging(4);
    const start = Date.now();
    const deadline = new Deadline(start + APPLY_DEADLINE_MS);
    const run = track(applyChanges(files, existing(4), { deadline }));
    await advance(400_000);
    expect(run.value).toEqual({
      kind: "failed",
      cut: false,
      wrote: true,
      results: [{ path: "p00.html", outcome: "written", sha256: sha("<p>new 0</p>") }],
      failed: { path: "p01.html", step: "write" },
    });
    expect(run.at - start).toBe(HOST_CALL_TIMEOUT_MS);
    expect(hosts.calls.filter((c) => isUpload(c.url))).toHaveLength(2);
    expect(hosts.calls.filter((c) => isMove(c.url))).toHaveLength(1);
    expect(hosts.da.text(`${docroot}/p01.html`)).toBe("<p>old 1</p>");
    expect(hosts.da.temps()).toEqual([]);
    deadline.dispose();
  });

  it("a write whose folder walk is answered only once the deadline has passed never starts", async () => {
    let jumpTo = 0;
    hosts = installFakeHosts({
      delay: (c) => {
        // the clock reaches the deadline while the listing is answered
        if (jumpTo && c.url.includes("/api/filemanager/list")) vi.setSystemTime(jumpTo);
        return 0;
      },
    });
    const files = await staging(1);
    const deadline = new Deadline(Date.now() + APPLY_DEADLINE_MS);
    jumpTo = deadline.at;
    await expect(files.write("p00.html", enc("<p>new 0</p>"), { deadline })).rejects.toMatchObject({ step: "write", reason: "deadline" });
    expect(hosts.calls.filter((c) => isUpload(c.url))).toEqual([]);
    expect(hosts.da.text(`${docroot}/p00.html`)).toBe("<p>old 0</p>");
    deadline.dispose();
  });

  it("a new folder made as the deadline passed: that file is never uploaded, and isn't written", async () => {
    const isMkdir = (url: string) => url.includes("/api/filemanager-actions/mkdir");
    hosts = installFakeHosts({ delay: (c) => (isUpload(c.url) || isMkdir(c.url) ? 25_000 : 0) });
    const files = await staging(9);
    const media = enc("WEBP");
    const changes = [...existing(9), { path: "cms-media/0123456789abcdef.webp", expectedSha256: null, bytes: media, sha256: sha(media) }];
    const start = Date.now();
    const deadline = new Deadline(start + APPLY_DEADLINE_MS);
    const run = track(applyChanges(files, changes, { deadline }));
    await advance(400_000);
    expect(run.value).toMatchObject({ kind: "failed", cut: true, failed: { path: "cms-media/0123456789abcdef.webp", step: "write" } });
    expect((run.value as { results: unknown[] }).results).toHaveLength(9);
    expect(hosts.calls.filter((c) => isMkdir(c.url))).toHaveLength(1);
    expect(hosts.calls.filter((c) => isUpload(c.url))).toHaveLength(9);
    expect(hosts.calls.filter((c) => isExtract(c.url))).toEqual([]);
    expect(hosts.da.files.has(`${docroot}/cms-media/0123456789abcdef.webp`)).toBe(false);
    deadline.dispose();
  });
});

describe("the read routes stop at 100 s", () => {
  let hosts: FakeHosts;
  const isDownload = (url: string) => url.includes("/api/filemanager/download");
  const isList = (url: string) => url.includes("/api/filemanager/list");

  beforeEach(() => {
    state.db = memorySupabase({
      leads: [{ id: LEAD, business_name: "Acme", business_email: null, status: "Ready", website_link: `https://${STAGING}`, deleted_at: null }],
      sedcms_links: [linkRow(LEAD, STAGING)],
    });
  });

  it("live-files: past 100 s the remaining text files carry no text, and truncated is true", async () => {
    hosts = installFakeHosts({ delay: (c) => (isDownload(c.url) ? 15_000 : 0) });
    for (let i = 0; i < 10; i++) hosts.da.put(`${docroot}/p${pad(i)}.html`, `<p>page ${i}</p>`);
    const start = Date.now();
    const run = track(liveFilesPOST(signedRequest(leadPath(LEAD, "live-files"), { host: STAGING }), routeCtx(LEAD)));
    await advance(300_000);
    expect(run.done).toBe(true);
    const res = run.value as Response;
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.truncated).toBe(true);
    expect(body.files).toHaveLength(10);
    expect(body.files.filter((f: { text?: string }) => typeof f.text === "string").map((f: { path: string }) => f.path)).toEqual(
      [0, 1, 2, 3, 4, 5].map((i) => `p${pad(i)}.html`),
    );
    for (const f of body.files.slice(6)) expect(f).toEqual({ path: f.path, size: f.size, sha256: null });
    for (const d of hosts.calls.filter((c) => isDownload(c.url))) expect(d.at).toBeLessThan(start + READ_DEADLINE_MS);
    expect(run.at - start).toBe(READ_DEADLINE_MS);
  });

  it("live-files: a listing still unfinished at 100 s is a 502 HOSTING (the file list would be incomplete)", async () => {
    hosts = installFakeHosts({ delay: (c) => (isList(c.url) ? 22_000 : 0) });
    for (let i = 1; i <= 6; i++) hosts.da.put(`${docroot}/d${i}/page.html`, "<p>x</p>");
    const start = Date.now();
    const run = track(liveFilesPOST(signedRequest(leadPath(LEAD, "live-files"), { host: STAGING }), routeCtx(LEAD)));
    await advance(300_000);
    const res = run.value as Response;
    expect(res.status).toBe(502);
    expect((await res.json()).code).toBe("HOSTING");
    for (const l of hosts.calls.filter((c) => isList(c.url))) expect(l.at).toBeLessThan(start + READ_DEADLINE_MS);
    expect(run.at - start).toBe(READ_DEADLINE_MS);
  });

  it("checksums: a read still running at 100 s makes a 502 HOSTING naming that path", async () => {
    hosts = installFakeHosts({ delay: (c) => (isDownload(c.url) ? 18_000 : 0) });
    for (let i = 0; i < 7; i++) hosts.da.put(`${docroot}/p${pad(i)}.html`, `<p>page ${i}</p>`);
    const start = Date.now();
    const paths = Array.from({ length: 7 }, (_, i) => `p${pad(i)}.html`);
    const run = track(checksumsPOST(signedRequest(leadPath(LEAD, "checksums"), { host: STAGING, paths }), routeCtx(LEAD)));
    await advance(300_000);
    const res = run.value as Response;
    expect(res.status).toBe(502);
    expect(await res.json()).toEqual({ code: "HOSTING", message: expect.any(String), failed: { path: "p05.html", step: "read" } });
    for (const d of hosts.calls.filter((c) => isDownload(c.url))) expect(d.at).toBeLessThan(start + READ_DEADLINE_MS);
    expect(run.at - start).toBe(READ_DEADLINE_MS);
  });
});
