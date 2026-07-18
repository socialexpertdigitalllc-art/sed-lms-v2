// @vitest-environment node
import { describe, it, expect, afterEach } from "vitest";
import { mkdtemp, rm, readFile, writeFile, mkdir, readdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { deployZipToDir } from "@/lib/template-engine/fsDeploy";
import { zipFromMap } from "@/lib/template-engine/zip";

const enc = (s: string) => new TextEncoder().encode(s);
let dirs: string[] = [];
async function temp() { const d = await mkdtemp(join(tmpdir(), "fsdeploy-")); dirs.push(d); return d; }
afterEach(async () => { for (const d of dirs) await rm(d, { recursive: true, force: true }); dirs = []; });

describe("deployZipToDir", () => {
  it("writes every zip entry to disk under the target, nested dirs included", async () => {
    const target = await temp();
    const zip = zipFromMap({ "index.html": enc("<h1>hi</h1>"), "assets/app.js": enc("x=1"), "css/site.css": enc("a{}") });
    const res = await deployZipToDir(zip, target);
    expect(res.files).toBe(3);
    expect(await readFile(join(target, "index.html"), "utf8")).toBe("<h1>hi</h1>");
    expect(await readFile(join(target, "assets/app.js"), "utf8")).toBe("x=1");
    expect(await readFile(join(target, "css/site.css"), "utf8")).toBe("a{}");
  });

  it("clears stale files already in the target (a fresh addon docroot placeholder)", async () => {
    const target = await temp();
    await writeFile(join(target, "old-placeholder.html"), "default page");
    await mkdir(join(target, "stale"), { recursive: true });
    await writeFile(join(target, "stale/gone.txt"), "old");
    await deployZipToDir(zipFromMap({ "index.html": enc("new") }), target);
    const entries = await readdir(target);
    expect(entries).toEqual(["index.html"]); // everything else cleared
  });

  it("strips the DirectAdmin archive's public_html/ wrapper (files land at the docroot root)", async () => {
    // download-archive nests every entry under the docroot folder name; a
    // transferred site is broken if public_html/ survives into the target.
    const target = await temp();
    const zip = zipFromMap({
      "public_html/index.html": enc("home"),
      "public_html/style.css": enc("a{}"),
      "public_html/assets/app.js": enc("x=1"),
    });
    const res = await deployZipToDir(zip, target);
    expect(res.files).toBe(3);
    expect(await readFile(join(target, "index.html"), "utf8")).toBe("home");
    expect(await readFile(join(target, "assets/app.js"), "utf8")).toBe("x=1");
  });

  it("returns the created directory even when the target did not exist yet", async () => {
    const base = await temp();
    const target = join(base, "domains", "acme.com", "public_html"); // not created
    const res = await deployZipToDir(zipFromMap({ "index.html": enc("ok") }), target);
    expect(res.files).toBe(1);
    expect(await readFile(join(target, "index.html"), "utf8")).toBe("ok");
  });
});
