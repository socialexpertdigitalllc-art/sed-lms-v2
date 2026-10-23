// @vitest-environment node
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { HG_ROOT, daDocroot, daSiteFolder, fakeHostEnv, installFakeHosts, withEnv, type FakeHosts, type FakeHostsOptions, type MemFs, type RecordedCall } from "./helpers/fakeSiteHosts";
import { Deadline } from "@/lib/sedcms/deadline";
import { SiteFilesError, TEMP_PLACEMENT, siteFilesFor, type SiteFiles, type TempPlacement } from "@/lib/sedcms/files";

/**
 * A live file is never half-written. Every SED CMS write, on both hosts:
 *   1. uploads the new bytes to a temporary file under a random name,
 *      outside the web root (in the folder that holds public_html);
 *   2. checks it: its size, and its sha256 where the host computes one;
 *   3. moves it over the live file in ONE call (rename with override);
 *   4. on any failure before the move, removes the temporary file and
 *      leaves the live file as it was.
 * A host whose files can't be reached outside the web root uses a dot-named
 * temporary file beside the live one instead. No step starts after the
 * deadline; the clean-up of a temporary file still happens.
 */

interface Step {
  name: string;
  matches: (c: RecordedCall) => boolean;
  isMove?: boolean;
}

interface HostCase {
  name: string;
  host: string;
  install: (o?: FakeHostsOptions) => FakeHosts;
  fs: (h: FakeHosts) => MemFs;
  live: (rel: string) => string;
  /** the folder that holds public_html: temporary files go here */
  outside: string;
  /** each call of a write, in order */
  steps: Step[];
  isTempUpload: (c: RecordedCall) => boolean;
  isCheck: (c: RecordedCall) => boolean;
  isMove: (c: RecordedCall) => boolean;
  isRemoval: (c: RecordedCall) => boolean;
  /** the host computes a sha256 for the check */
  checksSha256: boolean;
}

const hgMove = (c: RecordedCall) => c.method === "PATCH" && c.url.includes("/api/resources/") && c.url.includes("action=rename");
const hgCheck = (c: RecordedCall) => c.method === "GET" && c.url.includes("/api/resources/") && c.url.includes("checksum=sha256");
const daMove = (c: RecordedCall) => c.url.includes("/api/filemanager-actions/move");
const daUpload = (c: RecordedCall) => c.url.includes("/api/filemanager-actions/upload");
const daCheck = (c: RecordedCall) => c.url.includes("/api/filemanager/list") && new URL(c.url).searchParams.get("path") === daSiteFolder("acme");

const HOSTS: HostCase[] = [
  {
    name: "Hostinger (a custom domain)",
    host: "client.com",
    install: (o = {}) => installFakeHosts({ websites: [{ domain: "client.com", username: "u447231526" }], ...o }),
    fs: (h) => h.hostinger,
    live: (rel) => `${HG_ROOT}/${rel}`,
    outside: "",
    steps: [
      { name: "the temporary file's create (TUS)", matches: (c) => c.method === "POST" && c.url.includes("/api/tus/") },
      { name: "the temporary file's bytes (TUS)", matches: (c) => c.method === "PATCH" && c.url.includes("/api/tus/") },
      { name: "the check (size and sha256)", matches: hgCheck },
      { name: "the move", matches: hgMove, isMove: true },
    ],
    isTempUpload: (c) => c.url.includes("/api/tus/"),
    isCheck: hgCheck,
    isMove: hgMove,
    isRemoval: (c) => c.method === "DELETE",
    checksSha256: true,
  },
  {
    name: "DirectAdmin (a staging subdomain)",
    host: "acme.dmviral.com",
    install: (o = {}) => installFakeHosts(o),
    fs: (h) => h.da,
    live: (rel) => `${daDocroot("acme")}/${rel}`,
    outside: daSiteFolder("acme"),
    steps: [
      { name: "the temporary upload", matches: daUpload },
      { name: "the check (size)", matches: daCheck },
      { name: "the move", matches: daMove, isMove: true },
    ],
    isTempUpload: daUpload,
    isCheck: daCheck,
    isMove: daMove,
    isRemoval: (c) => c.url.includes("/api/filemanager-actions/remove"),
    checksSha256: false,
  },
];

const original = Uint8Array.from({ length: 300 }, (_, i) => (i * 13) % 256);
const replacement = new TextEncoder().encode("<h1>The new page</h1>");

let restoreEnv: () => void;
beforeEach(() => {
  restoreEnv = withEnv(fakeHostEnv());
});
afterEach(() => {
  restoreEnv();
  vi.unstubAllGlobals();
});

async function filesFor(c: HostCase, placement?: TempPlacement): Promise<SiteFiles> {
  const r = await siteFilesFor(c.host, placement ? { placement } : {});
  if (!r.ok) throw new Error(`expected files for ${c.host}: ${r.error}`);
  return r.files;
}

const failure = (p: Promise<unknown>) => p.then(() => null, (e: unknown) => e as SiteFilesError);

it("both hosts stage outside the web root by default", () => {
  expect(TEMP_PLACEMENT).toEqual({ staging: "outside", custom: "outside" });
});

describe.each(HOSTS)("$name", (c) => {
  it("replaces a live file through a temporary file outside the web root, moved over it in one call", async () => {
    const hosts = c.install();
    const fs = c.fs(hosts);
    fs.put(c.live("index.html"), original);
    const files = await filesFor(c);
    await files.write("index.html", replacement);

    expect(fs.files.get(c.live("index.html"))).toEqual(replacement);
    expect(fs.temps()).toEqual([]);
    const staged = hosts.calls.filter(c.isTempUpload).flatMap((x) => x.changed);
    expect(staged.length).toBeGreaterThan(0);
    for (const p of staged) {
      expect(p.startsWith(`${c.outside}/sedcms-`)).toBe(true);
      expect(p.endsWith(".tmp")).toBe(true);
      expect(p.startsWith(c.live(""))).toBe(false);
    }
    expect(hosts.calls.filter(c.isCheck)).toHaveLength(1);
    // the move is the only call that touched the live path
    const touching = hosts.calls.filter((x) => x.changed.includes(c.live("index.html")));
    expect(touching).toHaveLength(1);
    expect(c.isMove(touching[0])).toBe(true);
  });

  it.each(c.steps)("a failure at $name leaves the live file byte-identical and no temporary file behind", async (step) => {
    const hosts = c.install({ fail: step.matches });
    const fs = c.fs(hosts);
    fs.put(c.live("index.html"), original);
    const files = await filesFor(c);
    const err = await failure(files.write("index.html", replacement));
    expect(err).toBeInstanceOf(SiteFilesError);
    expect(err).toMatchObject({ step: "write", reason: "hosting", path: "index.html" });
    expect(fs.files.get(c.live("index.html"))).toEqual(original);
    expect(fs.temps()).toEqual([]);
    expect(hosts.calls.filter((x) => x.changed.includes(c.live("index.html")))).toEqual([]);
    // as far as the caller can tell, only a failed move may have replaced the file
    expect(err!.maybeWritten).toBe(step.isMove === true);
    // nothing after the failed step but the clean-up
    const at = hosts.calls.findIndex(step.matches);
    expect(hosts.calls.slice(at + 1).every(c.isRemoval)).toBe(true);
  });

  it("a temporary file whose size isn't what was sent is never moved in", async () => {
    const hosts = c.install({ misreport: (abs) => (abs.includes("/sedcms-") ? { size: replacement.length + 1 } : undefined) });
    const fs = c.fs(hosts);
    fs.put(c.live("index.html"), original);
    const files = await filesFor(c);
    expect(await failure(files.write("index.html", replacement))).toMatchObject({ step: "write", reason: "hosting" });
    expect(hosts.calls.filter(c.isMove)).toEqual([]);
    expect(fs.files.get(c.live("index.html"))).toEqual(original);
    expect(fs.temps()).toEqual([]);
  });

  if (c.checksSha256) {
    it("a temporary file whose sha256 isn't the sent bytes' is never moved in", async () => {
      const hosts = c.install({ misreport: (abs) => (abs.includes("/sedcms-") ? { sha256: "0".repeat(64) } : undefined) });
      const fs = c.fs(hosts);
      fs.put(c.live("index.html"), original);
      const files = await filesFor(c);
      expect(await failure(files.write("index.html", replacement))).toMatchObject({ step: "write", reason: "hosting" });
      expect(hosts.calls.filter(c.isMove)).toEqual([]);
      expect(fs.files.get(c.live("index.html"))).toEqual(original);
      expect(fs.temps()).toEqual([]);
    });
  }

  it("into a folder that doesn't exist yet: the folder is made first, writing no file, then the file is moved in", async () => {
    const hosts = c.install();
    const fs = c.fs(hosts);
    fs.put(c.live("index.html"), original);
    const files = await filesFor(c);
    const target = "cms-media/0123456789abcdef.webp";
    await files.write(target, replacement);

    expect(fs.files.get(c.live(target))).toEqual(replacement);
    expect(fs.temps()).toEqual([]);
    expect([...fs.files.keys()].filter((k) => k.endsWith(".zip"))).toEqual([]);
    const touching = hosts.calls.filter((x) => x.changed.includes(c.live(target)));
    expect(touching).toHaveLength(1);
    expect(c.isMove(touching[0])).toBe(true);
    // under the web root, everything else any call changed is a folder
    for (const x of hosts.calls) {
      for (const p of x.changed) if (p.startsWith(c.live("")) && p !== c.live(target)) expect(fs.isDir(p), p).toBe(true);
    }
    expect(fs.files.get(c.live("index.html"))).toEqual(original);
  });

  it("a failed clean-up is reported by name, never content, and the live file is still untouched", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    try {
      const hosts = c.install({ fail: (x) => c.isMove(x) || c.isRemoval(x) });
      const fs = c.fs(hosts);
      fs.put(c.live("index.html"), original);
      const files = await filesFor(c);
      expect(await failure(files.write("index.html", replacement))).toMatchObject({ reason: "hosting" });
      expect(fs.files.get(c.live("index.html"))).toEqual(original);
      expect(fs.temps()).toHaveLength(1);
      expect(fs.temps()[0].startsWith(c.live(""))).toBe(false); // left outside the web root
      const logged = warn.mock.calls.flat().join(" ");
      expect(logged).toContain("sedcms-");
      expect(logged).not.toContain("The new page");
    } finally {
      warn.mockRestore();
    }
  });

  it("where the temporary file can't live outside the web root: a dot-named file beside the live one", async () => {
    const hosts = c.install();
    const fs = c.fs(hosts);
    fs.put(c.live("assets/js/app.js"), original);
    const files = await filesFor(c, "beside");
    await files.write("assets/js/app.js", replacement);
    expect(fs.files.get(c.live("assets/js/app.js"))).toEqual(replacement);
    expect(fs.temps()).toEqual([]);
    const staged = hosts.calls.filter(c.isTempUpload).flatMap((x) => x.changed);
    expect(staged.length).toBeGreaterThan(0);
    for (const p of staged) expect(p.startsWith(`${c.live("assets/js")}/.sedcms-`)).toBe(true);
    const touching = hosts.calls.filter((x) => x.changed.includes(c.live("assets/js/app.js")));
    expect(touching).toHaveLength(1);
    expect(c.isMove(touching[0])).toBe(true);
  });

  it("beside the live file too, a refused move leaves the temporary file removed and the live file as it was", async () => {
    const hosts = c.install({ fail: c.isMove });
    const fs = c.fs(hosts);
    fs.put(c.live("assets/js/app.js"), original);
    const files = await filesFor(c, "beside");
    expect(await failure(files.write("assets/js/app.js", replacement))).toMatchObject({ reason: "hosting", maybeWritten: true });
    expect(fs.files.get(c.live("assets/js/app.js"))).toEqual(original);
    expect(fs.temps()).toEqual([]);
  });

  it("a dot-named temporary file left beside a live one is never listed", async () => {
    const hosts = c.install();
    const fs = c.fs(hosts);
    fs.put(c.live("index.html"), original);
    fs.put(c.live(".sedcms-0123456789abcdef.tmp"), replacement);
    const files = await filesFor(c);
    expect((await files.list(4, 5000)).files.map((f) => f.path)).toEqual(["index.html"]);
  });

  describe("with a deadline, on fake time", () => {
    beforeEach(() => vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "Date"] }));
    afterEach(() => vi.useRealTimers());

    async function writeBy(files: SiteFiles, path: string, deadline: Deadline) {
      const run = failure(files.write(path, replacement, { deadline }));
      await vi.advanceTimersByTimeAsync(200_000);
      return run;
    }

    it("the deadline passes while the temporary file is uploaded: no move, the temporary file removed, not written", async () => {
      const hosts = c.install({ delay: (x) => (c.isTempUpload(x) ? 20_000 : 0) });
      const fs = c.fs(hosts);
      fs.put(c.live("index.html"), original);
      const files = await filesFor(c);
      const deadline = new Deadline(Date.now() + 10_000);
      const err = await writeBy(files, "index.html", deadline);
      expect(err).toMatchObject({ step: "write", reason: "deadline", maybeWritten: false });
      expect(hosts.calls.filter(c.isMove)).toEqual([]);
      expect(fs.files.get(c.live("index.html"))).toEqual(original);
      expect(fs.temps()).toEqual([]);
      // after the deadline only the clean-up started
      const late = hosts.calls.filter((x) => x.at >= deadline.at);
      expect(late.length).toBeGreaterThan(0);
      expect(late.every(c.isRemoval)).toBe(true);
      deadline.dispose();
    });

    it("the deadline passes during the check: no move, the temporary file removed", async () => {
      const hosts = c.install({ delay: (x) => (c.isCheck(x) ? 20_000 : 0) });
      const fs = c.fs(hosts);
      fs.put(c.live("index.html"), original);
      const files = await filesFor(c);
      const deadline = new Deadline(Date.now() + 10_000);
      expect(await writeBy(files, "index.html", deadline)).toMatchObject({ step: "write", reason: "deadline", maybeWritten: false });
      expect(hosts.calls.filter(c.isMove)).toEqual([]);
      expect(fs.files.get(c.live("index.html"))).toEqual(original);
      expect(fs.temps()).toEqual([]);
      expect(hosts.calls.filter((x) => x.at >= deadline.at).every(c.isRemoval)).toBe(true);
      deadline.dispose();
    });

    it("a check answered just as the deadline passes: the move never starts, the temporary file is removed", async () => {
      let jumpTo = 0;
      const hosts = c.install({
        delay: (x) => {
          // the clock reaches the deadline while the check is answered
          if (jumpTo && c.isCheck(x)) vi.setSystemTime(jumpTo);
          return 0;
        },
      });
      const fs = c.fs(hosts);
      fs.put(c.live("index.html"), original);
      const files = await filesFor(c);
      const deadline = new Deadline(Date.now() + 10_000);
      jumpTo = deadline.at;
      expect(await writeBy(files, "index.html", deadline)).toMatchObject({ step: "write", reason: "deadline", maybeWritten: false });
      expect(hosts.calls.filter(c.isMove)).toEqual([]);
      expect(fs.files.get(c.live("index.html"))).toEqual(original);
      expect(fs.temps()).toEqual([]);
      deadline.dispose();
    });

    it("a move started before the deadline is never cut: it finishes, and the file is written", async () => {
      const hosts = c.install({ delay: (x) => (c.isMove(x) ? 20_000 : 0) });
      const fs = c.fs(hosts);
      fs.put(c.live("index.html"), original);
      const files = await filesFor(c);
      const deadline = new Deadline(Date.now() + 10_000);
      expect(await writeBy(files, "index.html", deadline)).toBeNull();
      expect(fs.files.get(c.live("index.html"))).toEqual(replacement);
      expect(fs.temps()).toEqual([]);
      deadline.dispose();
    });
  });
});

describe("Hostinger: the TUS create", () => {
  beforeEach(() => vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "Date"] }));
  afterEach(() => vi.useRealTimers());

  it("never targets a live path (with override=true it empties what it targets)", async () => {
    const [hg] = HOSTS;
    const hosts = hg.install();
    hosts.hostinger.put(hg.live("index.html"), original);
    const files = await filesFor(hg);
    await files.write("index.html", replacement);
    for (const x of hosts.calls.filter((y) => y.url.includes("/api/tus/"))) {
      expect(new URL(x.url).pathname.includes("/api/tus/public_html/")).toBe(false);
    }
  });

  it("the deadline passing between the create and the bytes: the bytes are never sent", async () => {
    const [hg] = HOSTS;
    const hosts = hg.install({ delay: (x) => (x.method === "POST" && x.url.includes("/api/tus/") ? 20_000 : 0) });
    hosts.hostinger.put(hg.live("index.html"), original);
    const files = await filesFor(hg);
    const deadline = new Deadline(Date.now() + 10_000);
    const run = failure(files.write("index.html", replacement, { deadline }));
    await vi.advanceTimersByTimeAsync(200_000);
    expect(await run).toMatchObject({ reason: "deadline" });
    expect(hosts.calls.filter((x) => x.method === "PATCH" && x.url.includes("/api/tus/"))).toEqual([]);
    expect(hosts.hostinger.temps()).toEqual([]);
    expect(hosts.hostinger.files.get(hg.live("index.html"))).toEqual(original);
    deadline.dispose();
  });
});

describe("DirectAdmin: a new folder", () => {
  beforeEach(() => vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "Date"] }));
  afterEach(() => vi.useRealTimers());

  it("the deadline passing while the folder is made: nothing is extracted or written, and its zip is removed", async () => {
    const da = HOSTS[1];
    const hosts = da.install({ delay: (x) => (daUpload(x) ? 20_000 : 0) });
    hosts.da.put(da.live("index.html"), original);
    const files = await filesFor(da);
    const deadline = new Deadline(Date.now() + 10_000);
    const run = failure(files.write("cms-media/0123456789abcdef.webp", replacement, { deadline }));
    await vi.advanceTimersByTimeAsync(200_000);
    expect(await run).toMatchObject({ reason: "deadline", maybeWritten: false });
    expect(hosts.calls.filter((x) => x.url.includes("/extract-archive"))).toEqual([]);
    expect([...hosts.da.files.keys()].filter((k) => k.endsWith(".zip"))).toEqual([]);
    expect(hosts.da.isDir(da.live("cms-media"))).toBe(false);
    expect(hosts.calls.filter((x) => x.at >= deadline.at).every(da.isRemoval)).toBe(true);
    deadline.dispose();
  });
});
