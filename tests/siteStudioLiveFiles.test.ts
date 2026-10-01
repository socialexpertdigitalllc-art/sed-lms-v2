import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  siteHostFrom,
  hostCandidates,
  siteZipFilename,
  fetchLiveSiteZip,
  prepareSiteZip,
  overrideLiveSite,
} from "@/lib/site-studio/deploy/liveFiles";
import { unzipToMap, zipFromMap } from "@/lib/template-engine/zip";

const KEYS = ["DA_HOST", "DA_USERNAME", "DA_LOGIN_KEY", "DA_DOMAIN", "HOSTINGER_API_TOKEN", "PROTECTED_DOMAINS"] as const;
let saved: Record<string, string | undefined>;

const setEnv = () => {
  process.env.DA_HOST = "https://server.example.com:2222";
  process.env.DA_USERNAME = "sedadmin";
  process.env.DA_LOGIN_KEY = "loginkey";
  process.env.DA_DOMAIN = "dmviral.com";
  process.env.HOSTINGER_API_TOKEN = "token";
  process.env.PROTECTED_DOMAINS = "sedlms.com";
};

beforeEach(() => {
  saved = {};
  for (const k of KEYS) saved[k] = process.env[k];
  setEnv();
});

afterEach(() => {
  for (const k of KEYS) {
    if (saved[k] === undefined) delete process.env[k];
    else process.env[k] = saved[k];
  }
  vi.unstubAllGlobals();
});

describe("siteHostFrom", () => {
  it("parses full URLs, bare hosts, and paths down to a lowercase hostname", () => {
    expect(siteHostFrom("https://Foo.dmviral.com/page?a=1")).toBe("foo.dmviral.com");
    expect(siteHostFrom("foo.dmviral.com")).toBe("foo.dmviral.com");
    expect(siteHostFrom("http://www.client.com/about")).toBe("www.client.com");
    expect(siteHostFrom("client.com.")).toBe("client.com");
  });

  it("rejects empties, garbage, and dotless hosts", () => {
    expect(siteHostFrom("")).toBeNull();
    expect(siteHostFrom("   ")).toBeNull();
    expect(siteHostFrom("ht tp://x")).toBeNull();
    expect(siteHostFrom("localhost")).toBeNull();
  });
});

describe("hostCandidates", () => {
  it("adds the apex when the host has a www prefix", () => {
    expect(hostCandidates("www.client.com")).toEqual(["www.client.com", "client.com"]);
    expect(hostCandidates("client.com")).toEqual(["client.com"]);
  });
});

describe("siteZipFilename", () => {
  it("sanitizes the host and stamps the day", () => {
    expect(siteZipFilename("foo.dmviral.com", new Date("2026-08-13T10:00:00Z"))).toBe(
      "foo.dmviral.com-files-2026-08-13.zip",
    );
    expect(siteZipFilename('we"ird host', new Date("2026-08-13T10:00:00Z"))).toBe("we_ird_host-files-2026-08-13.zip");
  });
});

/** fetch stub routing by URL substring — DA archive vs Hostinger website list. */
function stubFetch(routes: { match: string; respond: () => Response }[]) {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      const hit = routes.find((r) => url.includes(r.match));
      if (!hit) throw new Error(`unexpected fetch: ${url}`);
      return hit.respond();
    }),
  );
}

// valid-enough archive: PK magic + padding past the 100-byte sanity floor.
// Inferred return type keeps the backing buffer as ArrayBuffer — the
// annotation-free form BodyInit accepts (same quirk as directadmin.ts's upload).
function zipBytes() {
  const b = new Uint8Array(200);
  b[0] = 0x50;
  b[1] = 0x4b;
  return b;
}

describe("fetchLiveSiteZip", () => {
  it("pulls staging subdomains through the DirectAdmin archive", async () => {
    stubFetch([
      {
        match: "/api/filemanager/download-archive",
        respond: () => new Response(zipBytes(), { status: 200 }),
      },
    ]);
    const res = await fetchLiveSiteZip("https://greenlawn.dmviral.com/");
    expect(res).toMatchObject({ ok: true, host: "greenlawn.dmviral.com", source: "staging" });
  });

  it("refuses protected domains, including the DA apex itself and subdomains of protected entries", async () => {
    for (const site of ["sedlms.com", "www.sedlms.com", "dmviral.com"]) {
      const res = await fetchLiveSiteZip(site);
      expect(res).toMatchObject({ ok: false, status: 403 });
    }
  });

  it("422s for a domain that is not on the company hosting", async () => {
    stubFetch([
      {
        match: "developers.hostinger.com/api/hosting/v1/websites",
        respond: () => Response.json({ data: [] }),
      },
    ]);
    const res = await fetchLiveSiteZip("https://elsewhere.com");
    expect(res).toMatchObject({ ok: false, status: 422 });
  });

  it("downloads a custom domain's live files over the Hostinger file server, falling back from www to the apex", async () => {
    // The client sites live on a different hosting account than the LMS, so
    // the local disk can't reach them — the bogus root_directory proves the
    // read never goes near the filesystem.
    const live = zipFromMap({ "index.html": enc("<p>live</p>") });
    stubFetch([
      { match: "domain=www.client.com", respond: () => Response.json({ data: [] }) },
      {
        match: "domain=client.com",
        respond: () =>
          Response.json({
            data: [{ domain: "client.com", username: "u447231526", root_directory: "Z:/not-a-real-dir", website_type: "other" }],
          }),
      },
      {
        match: "/api/hosting/v1/files/upload-urls",
        respond: () =>
          Response.json({ url: "https://srv-files.hstgr.io/rest/x/api/tus/public_html", auth_key: "AK", rest_auth_key: "RK" }),
      },
      { match: "srv-files.hstgr.io/rest/x/api/raw/public_html?algo=zip", respond: () => new Response(new Uint8Array(live), { status: 200 }) },
    ]);
    const res = await fetchLiveSiteZip("https://www.client.com");
    expect(res).toMatchObject({ ok: true, host: "client.com", source: "custom" });
    if (res.ok) {
      expect(new TextDecoder().decode(unzipToMap(res.zip)["index.html"])).toBe("<p>live</p>");
    }
  });

  it("refuses WordPress sites — they are not a folder of site files", async () => {
    stubFetch([
      {
        match: "domain=client.com",
        respond: () => Response.json({ data: [{ domain: "client.com", username: "u1", root_directory: "/x", website_type: "wordpress" }] }),
      },
    ]);
    const res = await fetchLiveSiteZip("client.com");
    expect(res).toMatchObject({ ok: false, status: 422 });
    if (!res.ok) expect(res.error).toMatch(/WordPress/);
  });

  it("names the unconfigured platform instead of a generic failure", async () => {
    delete process.env.DA_HOST;
    const staging = await fetchLiveSiteZip("foo.dmviral.com");
    expect(staging).toMatchObject({ ok: false, status: 422, error: "DirectAdmin is not configured." });

    delete process.env.HOSTINGER_API_TOKEN;
    const custom = await fetchLiveSiteZip("client.com");
    expect(custom).toMatchObject({ ok: false, status: 422, error: "Hostinger is not configured." });
  });

  it("rejects unparseable input", async () => {
    const res = await fetchLiveSiteZip("not a url");
    expect(res).toMatchObject({ ok: false, status: 422 });
  });
});

const enc = (s: string) => new TextEncoder().encode(s);

describe("prepareSiteZip", () => {
  it("strips a folder-zipped site's shared root so files land at the docroot", () => {
    const zipped = zipFromMap({ "my-site/index.html": enc("<h1>hi</h1>"), "my-site/css/a.css": enc("body{}") });
    const res = prepareSiteZip(zipped);
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.files).toBe(2);
    expect(Object.keys(unzipToMap(res.zip)).sort()).toEqual(["css/a.css", "index.html"]);
  });

  it("refuses archives that do not look like a website", () => {
    expect(prepareSiteZip(zipFromMap({ "notes.txt": enc("hello") }))).toMatchObject({
      ok: false,
      message: expect.stringContaining("index.html"),
    });
    expect(prepareSiteZip(enc("this is not a zip")).ok).toBe(false);
    expect(prepareSiteZip(zipFromMap({})).ok).toBe(false);
  });
});

describe("overrideLiveSite", () => {
  const siteZip = () => {
    const prepared = prepareSiteZip(zipFromMap({ "index.html": enc("<p>v2</p>") }));
    if (!prepared.ok) throw new Error("fixture zip failed");
    return prepared;
  };

  it("overrides a staging subdomain in place through DirectAdmin (clear, upload, extract)", async () => {
    const calls: string[] = [];
    stubFetch([
      { match: "/api/filemanager/list", respond: () => Response.json({ files: [{ name: "old.html", type: "file" }] }) },
      { match: "/api/filemanager-actions/remove", respond: () => Response.json({}) },
      { match: "/api/filemanager-actions/upload", respond: () => Response.json({}) },
      { match: "/api/filemanager-actions/extract-archive", respond: () => Response.json({}) },
    ]);
    const inner = global.fetch as ReturnType<typeof vi.fn>;
    const prepared = siteZip();
    const res = await overrideLiveSite("https://greenlawn.dmviral.com", prepared.zip, prepared.files);
    for (const c of inner.mock.calls) calls.push(String(c[0]));
    expect(res).toMatchObject({ ok: true, host: "greenlawn.dmviral.com", source: "staging", sub: "greenlawn" });
    expect(calls.some((u) => u.includes("extract-archive"))).toBe(true);
  });

  it("deploys a custom domain over the Hostinger API (upload URL, TUS upload, deploy-from-archive)", async () => {
    // Since the plan migration, custom domains can live on a DIFFERENT hosting
    // account than the LMS — a disk write can't reach them. The override must
    // go through the API deploy flow instead of ever touching the filesystem
    // (the bogus root_directory would explode if it did).
    stubFetch([
      {
        match: "domain=client.com",
        respond: () =>
          Response.json({
            data: [
              {
                domain: "client.com",
                username: "u447231526",
                root_directory: "Z:/not-a-real-dir/public_html",
                vhost_type: "addon",
                order_id: 1,
                is_enabled: true,
              },
            ],
          }),
      },
      {
        match: "/api/hosting/v1/files/upload-urls",
        respond: () => Response.json({ url: "https://srv-files.hstgr.io/", auth_key: "AK", rest_auth_key: "RK" }),
      },
      // settle check: the archive is gone from public_html → deploy finished
      { match: "srv-files.hstgr.io/api/resources/public_html/", respond: () => Response.json({ items: [{ name: "index.html" }] }) },
      { match: "srv-files.hstgr.io", respond: () => new Response(null, { status: 204 }) },
      { match: "/websites/client.com/deploy", respond: () => Response.json({ message: "ok" }) },
    ]);
    const prepared = siteZip();
    const res = await overrideLiveSite("client.com", prepared.zip, prepared.files);
    expect(res).toMatchObject({ ok: true, host: "client.com", source: "custom", sub: null, settled: true });
    const urls = (global.fetch as ReturnType<typeof vi.fn>).mock.calls.map((c) => String(c[0]));
    expect(urls.some((u) => u.includes("/accounts/u447231526/websites/client.com/deploy"))).toBe(true);
  });

  it("refuses protected domains and off-hosting domains", async () => {
    const prepared = siteZip();
    expect(await overrideLiveSite("sedlms.com", prepared.zip, prepared.files)).toMatchObject({ ok: false, status: 403 });
    stubFetch([{ match: "developers.hostinger.com", respond: () => Response.json({ data: [] }) }]);
    expect(await overrideLiveSite("elsewhere.com", prepared.zip, prepared.files)).toMatchObject({
      ok: false,
      status: 422,
    });
  });
});
