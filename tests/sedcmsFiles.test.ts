// @vitest-environment node
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { SiteFilesError, siteFilesFor, type SiteFiles } from "@/lib/sedcms/files";
import { DA_HOST, HG_FILES, HG_ROOT, daDocroot, daSiteFolder, fakeHostEnv, installFakeHosts, withEnv, type FakeHosts } from "./helpers/fakeSiteHosts";

/**
 * SED CMS reads and writes single files of a client site (launch plan, L2),
 * through the same two hosts the LMS already uses:
 *   - staging subdomains: DirectAdmin's file manager;
 *   - custom domains: Hostinger's File Browser (raw reads, TUS writes).
 * Same branching as liveFiles.ts: staging first, then protected, then
 * Hostinger static websites only. Both hosts are faked in memory behind a
 * stubbed fetch, in the request shapes the existing clients use.
 */

let restoreEnv: () => void;
let hosts: FakeHosts;

beforeEach(() => {
  restoreEnv = withEnv(fakeHostEnv());
});
afterEach(() => {
  restoreEnv();
  vi.unstubAllGlobals();
});

const bytesOf = (s: string) => new TextEncoder().encode(s);
const allByteValues = () => Uint8Array.from({ length: 512 }, (_, i) => i % 256);

async function filesFor(host: string): Promise<SiteFiles> {
  const r = await siteFilesFor(host);
  if (!r.ok) throw new Error(`expected files for ${host}, got ${r.status} ${r.error}`);
  return r.files;
}

describe("siteFilesFor: which host, and what is refused", () => {
  it("refuses a protected company domain (403), before any hosting call", async () => {
    hosts = installFakeHosts({ websites: [{ domain: "sedsolutions.online", username: "u1" }] });
    for (const host of ["sedsolutions.online", "www.sedsolutions.online", "lms.sedsolutions.online", "aqhsn.com"]) {
      const r = await siteFilesFor(host);
      expect(r).toMatchObject({ ok: false, status: 403, code: "PROTECTED" });
    }
    expect(hosts.calls).toHaveLength(0);
  });

  it("checks for a staging subdomain before the protected list, which always holds DA_DOMAIN", async () => {
    hosts = installFakeHosts();
    const r = await siteFilesFor("acme-roofing.dmviral.com");
    expect(r).toMatchObject({ ok: true, kind: "staging", key: "staging:acme-roofing" });
    // the staging apex itself and nested names are not client sites: protected
    expect(await siteFilesFor("dmviral.com")).toMatchObject({ ok: false, status: 403 });
    expect(await siteFilesFor("a.b.dmviral.com")).toMatchObject({ ok: false, status: 403 });
  });

  it("refuses a website that isn't plain static files (422), before opening its file server", async () => {
    hosts = installFakeHosts({ websites: [{ domain: "wp-client.com", username: "u1", website_type: "wordpress" }] });
    expect(await siteFilesFor("wp-client.com")).toMatchObject({ ok: false, status: 422, code: "NOT_STATIC" });
    expect(hosts.calls.some((c) => c.url.endsWith("/files/upload-urls"))).toBe(false);
  });

  it("refuses a site the company doesn't host (422), and says when Hostinger can't be read (502) or is still setting up (409)", async () => {
    hosts = installFakeHosts({ websites: [] });
    expect(await siteFilesFor("elsewhere.com")).toMatchObject({ ok: false, status: 422, code: "NOT_STATIC" });
    vi.unstubAllGlobals();
    hosts = installFakeHosts({ hostingerDown: true });
    expect(await siteFilesFor("client.com")).toMatchObject({ ok: false, status: 502, code: "HOSTING" });
    vi.unstubAllGlobals();
    hosts = installFakeHosts({ websites: [{ domain: "client.com", username: "u1" }], hostingerPending: true });
    expect(await siteFilesFor("client.com")).toMatchObject({ ok: false, status: 409, code: "HOSTING_PENDING" });
  });

  it("finds an addon website by its apex when the link says www", async () => {
    hosts = installFakeHosts({ websites: [{ domain: "client.com", username: "u447231526" }] });
    expect(await siteFilesFor("www.client.com")).toMatchObject({ ok: true, kind: "custom", key: "custom:client.com" });
  });

  it("refuses anything that isn't a plain, normalized host name (422), before any call", async () => {
    hosts = installFakeHosts();
    for (const host of ["", "Client.com", "client.com.", "client.com/x", "https://client.com", "client", "a_b.dmviral.com", "-x.dmviral.com", "client.com:443", `${"a".repeat(64)}.com`]) {
      expect(await siteFilesFor(host), host).toMatchObject({ ok: false, status: 422 });
    }
    expect(hosts.calls).toHaveLength(0);
  });

  it("answers HOSTING (502) for a staging site while DirectAdmin isn't configured, and a custom one while Hostinger isn't", async () => {
    hosts = installFakeHosts();
    const restore = withEnv({ DA_LOGIN_KEY: undefined, HOSTINGER_API_TOKEN: undefined });
    try {
      expect(await siteFilesFor("acme.dmviral.com")).toMatchObject({ ok: false, status: 502, code: "HOSTING" });
      expect(await siteFilesFor("client.com")).toMatchObject({ ok: false, status: 502, code: "HOSTING" });
      expect(hosts.calls).toHaveLength(0);
    } finally {
      restore();
    }
  });
});

describe("custom domains: Hostinger's File Browser", () => {
  const site = { domain: "client.com", username: "u447231526" };
  const abs = (p: string) => `${HG_ROOT}/${p}`;

  it("reads a file's exact bytes from the raw endpoint, with the file server's keys", async () => {
    hosts = installFakeHosts({ websites: [site] });
    hosts.hostinger.put(abs("index.html"), "<h1>Hi</h1>");
    hosts.hostinger.put(abs("assets/img/logo.png"), allByteValues());
    const files = await filesFor("client.com");

    expect(await files.read("assets/img/logo.png", 1024)).toEqual(allByteValues());
    const raw = hosts.calls.find((c) => c.url.includes("/api/raw/"))!;
    expect(raw.url).toBe(`${HG_FILES}/api/raw/public_html/assets/img/logo.png`);
    expect(raw.headers["x-auth"]).toBe("AK");
    expect(raw.headers["x-auth-rest"]).toBe("RK");
  });

  it("answers null for a missing file (or a missing folder) from the listing, without a raw read", async () => {
    hosts = installFakeHosts({ websites: [site] });
    hosts.hostinger.put(abs("index.html"), "x");
    const files = await filesFor("client.com");
    expect(await files.read("about.html", 1024)).toBeNull();
    expect(await files.read("blog/post.html", 1024)).toBeNull();
    expect(hosts.calls.some((c) => c.url.includes("/api/raw/"))).toBe(false);
  });

  it("refuses to read a directory or a symbolic link as if it were a file", async () => {
    hosts = installFakeHosts({ websites: [site] });
    hosts.hostinger.put(abs("old.html/inner.txt"), "x");
    hosts.hostinger.links.add(abs("linked.html"));
    const files = await filesFor("client.com");
    await expect(files.read("old.html", 1024)).rejects.toMatchObject({ step: "read", reason: "not_a_file" });
    await expect(files.read("linked.html", 1024)).rejects.toMatchObject({ step: "read", reason: "not_a_file" });
    expect(hosts.calls.some((c) => c.url.includes("/api/raw/"))).toBe(false);
  });

  it("refuses past maxBytes: from the listing before reading, and while streaming when the listing is wrong", async () => {
    hosts = installFakeHosts({ websites: [site], chunkBytes: 16 * 1024 });
    const big = new Uint8Array(300 * 1024).fill(7);
    hosts.hostinger.put(abs("big.jpg"), big);
    hosts.hostinger.put(abs("liar.jpg"), big);
    hosts.hostinger.listedSize.set(abs("liar.jpg"), 10);
    const files = await filesFor("client.com");

    await expect(files.read("big.jpg", 100 * 1024)).rejects.toMatchObject({ step: "read", reason: "too_large" });
    expect(hosts.calls.some((c) => c.url.includes("/api/raw/"))).toBe(false);

    await expect(files.read("liar.jpg", 100 * 1024)).rejects.toMatchObject({ step: "read", reason: "too_large" });
    // stopped soon after the cap, not after the whole body
    expect(hosts.chunksPulled).toBeLessThanOrEqual(8);
    expect(hosts.chunksOffered).toBe(19);
  });

  it("refuses a read whose size isn't the listed size", async () => {
    hosts = installFakeHosts({ websites: [site], shortRead: "index.html" });
    hosts.hostinger.put(abs("index.html"), "<h1>Hello</h1>");
    const files = await filesFor("client.com");
    await expect(files.read("index.html", 1024)).rejects.toMatchObject({ step: "read", reason: "hosting" });
  });

  it("writes by TUS to a temporary file beside public_html, checks it, renames it over the live one, and reads the new bytes back", async () => {
    hosts = installFakeHosts({ websites: [site] });
    hosts.hostinger.put(abs("assets/js/components.js"), "old();");
    const files = await filesFor("client.com");
    expect(await files.read("assets/js/components.js", 1024)).toEqual(bytesOf("old();"));

    await files.write("assets/js/components.js", bytesOf("next();"));
    const tus = hosts.calls.filter((c) => c.url.includes("/api/tus/"));
    expect(tus.map((c) => c.method)).toEqual(["POST", "PATCH"]);
    const temp = new URL(tus[0].url).pathname.slice(new URL(HG_FILES).pathname.length + "/api/tus".length);
    expect(temp).toMatch(/^[/]sedcms-[0-9a-f]{16}[.]tmp$/);
    for (const c of tus) {
      expect(c.url).toBe(`${HG_FILES}/api/tus${temp}?override=true`);
      expect(c.headers["tus-resumable"]).toBe("1.0.0");
      expect(c.headers["x-auth"]).toBe("AK");
    }
    expect(tus[0].headers["upload-length"]).toBe("7");
    expect(tus[1].headers["content-type"]).toBe("application/offset+octet-stream");
    const check = hosts.calls.find((c) => c.url.includes("checksum=sha256"))!;
    expect(check.url).toBe(`${HG_FILES}/api/resources${temp}?checksum=sha256`);
    const move = hosts.calls.find((c) => c.method === "PATCH" && c.url.includes("/api/resources/"))!;
    expect(new URL(move.url).pathname).toBe(`${new URL(HG_FILES).pathname}/api/resources${temp}`);
    expect(Object.fromEntries(new URL(move.url).searchParams)).toEqual({ action: "rename", destination: "/public_html/assets/js/components.js", override: "true" });
    expect(hosts.hostinger.text(abs("assets/js/components.js"))).toBe("next();");
    expect(hosts.hostinger.temps()).toEqual([]);
    // the folder listing it cached is forgotten, so the next read sees the write
    expect(await files.read("assets/js/components.js", 1024)).toEqual(bytesOf("next();"));
  });

  it("writes into a folder that doesn't exist yet", async () => {
    hosts = installFakeHosts({ websites: [site] });
    hosts.hostinger.put(abs("index.html"), "x");
    const files = await filesFor("client.com");
    await files.write("cms-media/0123456789abcdef.webp", allByteValues());
    expect(hosts.hostinger.files.get(abs("cms-media/0123456789abcdef.webp"))).toEqual(allByteValues());
  });

  it("a failed upload is a write error", async () => {
    hosts = installFakeHosts({ websites: [site], fail: (c) => c.method === "PATCH" && c.url.includes("/api/tus/") });
    hosts.hostinger.put(abs("index.html"), "x");
    const files = await filesFor("client.com");
    await expect(files.write("index.html", bytesOf("y"))).rejects.toMatchObject({ step: "write", reason: "hosting" });
    expect(hosts.hostinger.text(abs("index.html"))).toBe("x");
  });

  it("refuses a path that breaks cmsPathAllowed, an oversized file, or a folder in the way, before any request", async () => {
    hosts = installFakeHosts({ websites: [site] });
    hosts.hostinger.put(abs("old.html/inner.txt"), "x");
    const files = await filesFor("client.com");
    const before = hosts.calls.length;
    for (const path of ["../index.html", "/index.html", ".htaccess", "index.php", "x.php.html", "cgi-bin/a.html", "a%2fb.html", "index.HTML"]) {
      await expect(files.write(path, bytesOf("x")), path).rejects.toMatchObject({ step: "write", reason: "refused" });
      await expect(files.read(path, 1024), path).rejects.toMatchObject({ step: "read", reason: "refused" });
    }
    await expect(files.write("big.jpg", new Uint8Array(5 * 1024 * 1024 + 1))).rejects.toMatchObject({ reason: "refused" });
    expect(hosts.calls.length).toBe(before);

    await expect(files.write("old.html", bytesOf("x"))).rejects.toMatchObject({ step: "write", reason: "not_a_file" });
    await expect(files.write("old.html/inner.txt/x.html", bytesOf("x"))).rejects.toMatchObject({ step: "write", reason: "not_a_file" });
    expect(hosts.calls.some((c) => c.url.includes("/api/tus/"))).toBe(false);
  });

  it("lists files to a depth and a count, sorted, skipping hidden names, links and cgi-bin", async () => {
    hosts = installFakeHosts({ websites: [site] });
    const fs = hosts.hostinger;
    fs.put(abs("index.html"), "12345");
    fs.put(abs("about.html"), "1");
    fs.put(abs("assets/css/site.css"), "123");
    fs.put(abs("a/b/c/four.html"), "1234");
    fs.put(abs("a/b/c/d/five.html"), "1");
    fs.put(abs(".htaccess"), "x");
    fs.put(abs(".git/config"), "x");
    fs.put(abs("assets/.cache/x.js"), "x");
    fs.put(abs("cgi-bin/run.html"), "x");
    fs.put(abs("lms-deploy-1.zip"), "PK");
    fs.links.add(abs("shared.html"));
    const files = await filesFor("client.com");

    const listed = await files.list(4, 5000);
    expect(listed).toEqual({
      files: [
        { path: "a/b/c/four.html", size: 4 },
        { path: "about.html", size: 1 },
        { path: "assets/css/site.css", size: 3 },
        { path: "index.html", size: 5 },
        { path: "lms-deploy-1.zip", size: 2 },
      ],
      truncated: false,
    });
    // never walked into hidden folders or cgi-bin
    expect(hosts.calls.some((c) => c.url.includes("/.git") || c.url.includes("/.cache") || c.url.includes("/cgi-bin"))).toBe(false);

    const capped = await files.list(4, 2);
    expect(capped.files).toHaveLength(2);
    expect(capped.truncated).toBe(true);
  });
});

describe("staging subdomains: DirectAdmin's file manager", () => {
  const docroot = daDocroot("acme");

  it("lists through /api/filemanager/list with Basic auth, into the subdomain's own docroot", async () => {
    hosts = installFakeHosts();
    hosts.da.put(`${docroot}/index.html`, "<p>x</p>");
    hosts.da.put(`${docroot}/assets/js/components.js`, "a();");
    const files = await filesFor("acme.dmviral.com");
    expect(await files.list(4, 5000)).toEqual({
      files: [
        { path: "assets/js/components.js", size: 4 },
        { path: "index.html", size: 8 },
      ],
      truncated: false,
    });
    const first = new URL(hosts.calls[0].url);
    expect(first.origin + first.pathname).toBe(`${DA_HOST}/api/filemanager/list`);
    expect(first.searchParams.get("path")).toBe(docroot);
  });

  it("reads exact bytes through the single-file download (the one call the live spike must confirm)", async () => {
    hosts = installFakeHosts();
    hosts.da.put(`${docroot}/images/logo.png`, allByteValues());
    const files = await filesFor("acme.dmviral.com");
    expect(await files.read("images/logo.png", 1024)).toEqual(allByteValues());
    const dl = hosts.calls.find((c) => c.url.includes("/api/filemanager/download"))!;
    expect(new URL(dl.url).searchParams.get("path")).toBe(`${docroot}/images/logo.png`);
    expect(await files.read("images/missing.png", 1024)).toBeNull();
    expect(hosts.calls.filter((c) => c.url.includes("/api/filemanager/download"))).toHaveLength(1);
  });

  it("refuses a 200 that isn't the file (DirectAdmin's error bodies), by its size", async () => {
    hosts = installFakeHosts({ shortRead: "index.html" });
    hosts.da.put(`${docroot}/index.html`, "<html>a real page, longer than the error</html>");
    const files = await filesFor("acme.dmviral.com");
    await expect(files.read("index.html", 1024)).rejects.toMatchObject({ step: "read", reason: "hosting" });
  });

  it("writes by an upload to a temporary file beside public_html, checked, then moved over the live file", async () => {
    hosts = installFakeHosts();
    hosts.da.put(`${docroot}/assets/js/components.js`, "old();");
    const files = await filesFor("acme.dmviral.com");
    await files.write("assets/js/components.js", bytesOf("next();"));
    const actions = hosts.calls.filter((c) => c.url.includes("/api/filemanager-actions/"));
    expect(actions.map((c) => new URL(c.url).pathname)).toEqual(["/api/filemanager-actions/upload", "/api/filemanager-actions/move"]);
    const q = Object.fromEntries(new URL(actions[0].url).searchParams);
    expect(q.dir).toBe(daSiteFolder("acme"));
    expect(q.name).toMatch(/^sedcms-[0-9a-f]{16}[.]tmp$/);
    expect(q.overwrite).toBe("true");
    expect(JSON.parse(String(actions[1].body))).toEqual({
      source: `${daSiteFolder("acme")}/${q.name}`,
      destination: `${docroot}/assets/js/components.js`,
      overwrite: true,
    });
    expect(hosts.da.text(`${docroot}/assets/js/components.js`)).toBe("next();");
    expect(hosts.da.temps()).toEqual([]);
  });

  it("writes into a new folder: the folder made by mkdir ({ path }), then the file staged and moved in", async () => {
    hosts = installFakeHosts();
    hosts.da.put(`${docroot}/index.html`, "x");
    const files = await filesFor("acme.dmviral.com");
    await files.write("cms-media/0123456789abcdef.webp", allByteValues());
    expect(hosts.da.files.get(`${docroot}/cms-media/0123456789abcdef.webp`)).toEqual(allByteValues());
    const actions = hosts.calls.filter((c) => c.url.includes("/api/filemanager-actions/"));
    expect(actions.map((c) => new URL(c.url).pathname)).toEqual([
      "/api/filemanager-actions/mkdir",
      "/api/filemanager-actions/upload",
      "/api/filemanager-actions/move",
    ]);
    expect(JSON.parse(String(actions[0].body))).toEqual({ path: `${docroot}/cms-media` });
    expect(hosts.da.temps()).toEqual([]);
  });

  it("a failed upload is a write error", async () => {
    hosts = installFakeHosts({ fail: (c) => c.url.includes("/api/filemanager-actions/upload") });
    hosts.da.put(`${docroot}/index.html`, "x");
    const files = await filesFor("acme.dmviral.com");
    await expect(files.write("index.html", bytesOf("y"))).rejects.toBeInstanceOf(SiteFilesError);
    expect(hosts.da.text(`${docroot}/index.html`)).toBe("x");
  });

  it("refuses a bad path before any request", async () => {
    hosts = installFakeHosts();
    const files = await filesFor("acme.dmviral.com");
    const before = hosts.calls.length;
    await expect(files.write("../../other/public_html/index.html", bytesOf("x"))).rejects.toMatchObject({ reason: "refused" });
    await expect(files.read("../../other/public_html/index.html", 10)).rejects.toMatchObject({ reason: "refused" });
    expect(hosts.calls.length).toBe(before);
  });
});
