// @vitest-environment node
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { SiteFilesError, siteFilesFor, type SiteFiles } from "@/lib/sedcms/files";
import { HG_ROOT, daDocroot, fakeHostEnv, installFakeHosts, withEnv, type FakeHosts } from "./helpers/fakeSiteHosts";

/**
 * Hardened ahead of the live spike (the security review's last section):
 *   - what a file is fails CLOSED on both hosts: an entry whose kind is
 *     unknown or missing, or that is marked a link in any way, is neither
 *     followed, listed, read nor written over;
 *   - a website inside another's folder (Hostinger: a subdomain made inside
 *     public_html) is that other website's: its folder is never listed, read
 *     or written as part of the outer site.
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
/** The entry without one of its fields. */
const without = (key: string) => (e: Record<string, unknown>) => Object.fromEntries(Object.entries(e).filter(([k]) => k !== key));
const text = (b: Uint8Array | undefined) => new TextDecoder().decode(b);
const ROOT = "/home/u1/domains/client.com/public_html";
const client = { domain: "client.com", username: "u1", root_directory: ROOT };

async function filesFor(host: string): Promise<SiteFiles> {
  const r = await siteFilesFor(host);
  if (!r.ok) throw new Error(`expected files for ${host}, got ${r.status} ${r.error}`);
  return r.files;
}

describe("Hostinger's File Browser: a file is a file only when it says so", () => {
  const reshaped = (change: (entry: Record<string, unknown>) => Record<string, unknown>, only: string) =>
    installFakeHosts({ websites: [client], reshape: (host, abs, e) => (host === "hostinger" && abs === `${HG_ROOT}/${only}` ? change(e) : e) });

  for (const [why, change] of [
    ["no isSymlink", without("isSymlink")],
    ["isSymlink that isn't false", (e: Record<string, unknown>) => ({ ...e, isSymlink: "false" })],
    ["no isDir", without("isDir")],
    ["a link's mode bits", (e: Record<string, unknown>) => ({ ...e, mode: 134218239 })], // os.ModeSymlink | 0777
    ["a device's mode bits", (e: Record<string, unknown>) => ({ ...e, mode: 67109284 })], // os.ModeDevice | 0644
  ] as const) {
    it(`an entry with ${why} is not listed, read or written over`, async () => {
      hosts = reshaped(change as (e: Record<string, unknown>) => Record<string, unknown>, "about.html");
      hosts.hostinger.put(`${HG_ROOT}/index.html`, "<h1>Home</h1>");
      hosts.hostinger.put(`${HG_ROOT}/about.html`, "<h1>About</h1>");
      const files = await filesFor("client.com");
      expect((await files.list(4, 100)).files.map((f) => f.path)).toEqual(["index.html"]);
      await expect(files.read("about.html", 1024)).rejects.toMatchObject({ step: "read", reason: "not_a_file" });
      await expect(files.write("about.html", bytesOf("x"))).rejects.toMatchObject({ step: "write", reason: "not_a_file" });
      expect(text(hosts.hostinger.files.get(`${HG_ROOT}/about.html`))).toBe("<h1>About</h1>");
    });
  }

  it("a folder that isn't plainly a folder is never walked into", async () => {
    hosts = reshaped(without("isSymlink"), "assets");
    hosts.hostinger.put(`${HG_ROOT}/assets/app.js`, "app();");
    const files = await filesFor("client.com");
    expect((await files.list(4, 100)).files).toEqual([]);
    await expect(files.read("assets/app.js", 1024)).rejects.toMatchObject({ reason: "not_a_file" });
    await expect(files.write("assets/app.js", bytesOf("x"))).rejects.toMatchObject({ reason: "not_a_file" });
  });

  it("a staged file the File Browser doesn't call a plain file is never moved over the live one", async () => {
    hosts = installFakeHosts({
      websites: [client],
      reshape: (host, abs, e) => (host === "hostinger" && abs.endsWith(".tmp") ? without("isSymlink")(e) : e),
    });
    hosts.hostinger.put(`${HG_ROOT}/index.html`, "<h1>Home</h1>");
    const files = await filesFor("client.com");
    await expect(files.write("index.html", bytesOf("<h1>New</h1>"))).rejects.toBeInstanceOf(SiteFilesError);
    expect(text(hosts.hostinger.files.get(`${HG_ROOT}/index.html`))).toBe("<h1>Home</h1>");
    expect(hosts.calls.some((c) => c.method === "PATCH" && c.url.includes("action=rename"))).toBe(false);
    expect(hosts.hostinger.temps()).toEqual([]);
  });
});

describe("DirectAdmin's file manager: a file is a file only when it says so", () => {
  const docroot = daDocroot("acme-roofing");
  for (const [why, change] of [
    ["no type, only isDir", (e: Record<string, unknown>) => ({ ...without("type")(e), isDir: false })],
    ["a type no one named", (e: Record<string, unknown>) => ({ ...e, type: "fifo" })],
    ["a link target beside type file", (e: Record<string, unknown>) => ({ ...e, link: "/etc/passwd" })],
    ["isLink: 1", (e: Record<string, unknown>) => ({ ...e, isLink: 1 })],
    ["an ls-style mode of a link", (e: Record<string, unknown>) => ({ ...e, permissions: "lrwxrwxrwx" })],
    ["type file and isDir true", (e: Record<string, unknown>) => ({ ...e, isDir: true })],
  ] as const) {
    it(`an entry with ${why} is not listed, read or written over`, async () => {
      hosts = installFakeHosts({ reshape: (host, abs, e) => (host === "da" && abs === `${docroot}/about.html` ? (change as (x: Record<string, unknown>) => Record<string, unknown>)(e) : e) });
      hosts.da.put(`${docroot}/index.html`, "<h1>Home</h1>");
      hosts.da.put(`${docroot}/about.html`, "<h1>About</h1>");
      const files = await filesFor("acme-roofing.dmviral.com");
      expect((await files.list(4, 100)).files.map((f) => f.path)).toEqual(["index.html"]);
      await expect(files.read("about.html", 1024)).rejects.toMatchObject({ reason: "not_a_file" });
      await expect(files.write("about.html", bytesOf("x"))).rejects.toMatchObject({ reason: "not_a_file" });
      expect(hosts.da.text(`${docroot}/about.html`)).toBe("<h1>About</h1>");
    });
  }

  it("falsy link flags are not links", async () => {
    hosts = installFakeHosts({ reshape: (host, _abs, e) => (host === "da" ? { ...e, isLink: false, symlink: 0, link: "" } : e) });
    hosts.da.put(`${docroot}/index.html`, "<h1>Home</h1>");
    const files = await filesFor("acme-roofing.dmviral.com");
    expect((await files.list(4, 100)).files.map((f) => f.path)).toEqual(["index.html"]);
  });
});

describe("Hostinger: a website inside another's folder is its own", () => {
  const blog = { domain: "blog.client.com", username: "u1", root_directory: `${ROOT}/blog` };

  beforeEach(() => {
    hosts = installFakeHosts({ websites: [client, blog, { domain: "elsewhere.com", username: "u2", root_directory: `${ROOT}/shop` }] });
    hosts.hostinger.put(`${HG_ROOT}/index.html`, "<h1>Client</h1>");
    hosts.hostinger.put(`${HG_ROOT}/blog/index.html`, "<h1>Blog</h1>");
    hosts.hostinger.put(`${HG_ROOT}/blogs/index.html`, "<h1>Blogs</h1>");
    hosts.hostinger.put(`${HG_ROOT}/shop/index.html`, "<h1>Shop</h1>");
  });

  it("its folder is not listed, and nothing in it is read or written, before any request", async () => {
    const files = await filesFor("client.com");
    expect((await files.list(4, 100)).files.map((f) => f.path)).toEqual(["blogs/index.html", "index.html", "shop/index.html"]);
    const before = hosts.calls.length;
    await expect(files.read("blog/index.html", 1024)).rejects.toMatchObject({ step: "read", reason: "refused" });
    await expect(files.write("blog/index.html", bytesOf("x"))).rejects.toMatchObject({ step: "write", reason: "refused" });
    await expect(files.write("blog/new/page.html", bytesOf("x"))).rejects.toMatchObject({ step: "write", reason: "refused" });
    expect(hosts.calls.length).toBe(before);
    expect(text(hosts.hostinger.files.get(`${HG_ROOT}/blog/index.html`))).toBe("<h1>Blog</h1>");
    // a folder that only shares the name's start, and another account's website, are the site's own
    expect(text((await files.read("blogs/index.html", 1024)) ?? undefined)).toBe("<h1>Blogs</h1>");
  });

  it("the account's websites are asked for by username", async () => {
    await filesFor("client.com");
    expect(hosts.calls.some((c) => c.url.includes("/api/hosting/v1/websites?") && c.url.includes("username=u1"))).toBe(true);
  });

  it("when the account's websites can't be read, or the site's own folder is unknown, the site is refused (502)", async () => {
    vi.unstubAllGlobals();
    hosts = installFakeHosts({
      websites: [client],
      answer: (c) => (c.url.includes("username=") ? new Response("boom", { status: 500 }) : undefined),
    });
    expect(await siteFilesFor("client.com")).toMatchObject({ ok: false, status: 502, code: "HOSTING" });
    vi.unstubAllGlobals();
    hosts = installFakeHosts({ websites: [{ ...client, root_directory: "" }] });
    expect(await siteFilesFor("client.com")).toMatchObject({ ok: false, status: 502, code: "HOSTING" });
  });
});
