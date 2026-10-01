// @vitest-environment node
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { zipSync, strToU8 } from "fflate";
import {
  deployZipToWebsite,
  downloadWebsiteZip,
  ensureSsl,
  ensureWebsite,
  getHostingOrderId,
  getWebsite,
  isStaticWebsite,
  listDomains,
  listWebsites,
} from "@/lib/hostinger/client";

/**
 * The hosting-plan migration split the fleet across two Linux accounts, so the
 * LMS can't touch client sites on disk. Everything goes over Hostinger's API,
 * verified against the published OpenAPI spec and live (2026-10-01):
 *   - writes: POST /files/upload-urls -> TUS upload into public_html ->
 *     POST /accounts/{u}/websites/{d}/deploy (async; we wait for the server
 *     to consume the archive);
 *   - reads: the same upload-URL credentials open the File Browser REST API
 *     ({rest}/api/raw/public_html?algo=zip) — exact bytes incl. binaries;
 *   - a new website's setup is async: GET /onboardings?domain= until completed.
 */

const TOKEN_KEY = "HOSTINGER_API_TOKEN";
const ORDER_KEY = "HOSTINGER_ORDER_ID";
const savedEnv: Record<string, string | undefined> = {};

beforeEach(() => {
  for (const k of [TOKEN_KEY, ORDER_KEY]) savedEnv[k] = process.env[k];
  process.env[TOKEN_KEY] = "test-token";
  delete process.env[ORDER_KEY];
});

afterEach(() => {
  for (const k of [TOKEN_KEY, ORDER_KEY]) {
    if (savedEnv[k] === undefined) delete process.env[k];
    else process.env[k] = savedEnv[k];
  }
  vi.unstubAllGlobals();
});

interface RecordedCall {
  url: string;
  method: string;
  headers: Record<string, string>;
  body: unknown;
}

/** Stub fetch with a per-request dispatcher; records every call it serves. */
function stubFetch(respond: (call: RecordedCall, index: number) => Response) {
  const calls: RecordedCall[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: string | URL, init?: RequestInit) => {
      const call: RecordedCall = {
        url: String(input),
        method: init?.method ?? "GET",
        headers: Object.fromEntries(
          Object.entries((init?.headers ?? {}) as Record<string, string>).map(([k, v]) => [k.toLowerCase(), v]),
        ),
        body: init?.body,
      };
      calls.push(call);
      return respond(call, calls.length - 1);
    }),
  );
  return calls;
}

const noSleep = async () => {};
const site = { domain: "client.com", username: "u447231526" };
const zip = new Uint8Array([0x50, 0x4b, 3, 4, 9, 9, 9, 9]);

/** The real credential shape: a TUS endpoint under a File Browser REST root. */
const FILES = "https://srv955-files.hstgr.io/rest/abc123";
const uploadUrlOk = () =>
  new Response(JSON.stringify({ url: `${FILES}/api/tus/public_html`, auth_key: "AK", rest_auth_key: "RK" }), {
    status: 200,
  });

/** TUS + deploy + listing responder; `listed` decides what public_html shows. */
function deployResponder(listed: (archive: string) => string[]) {
  let archive = "";
  return (call: RecordedCall): Response => {
    if (call.url.endsWith("/files/upload-urls")) return uploadUrlOk();
    if (call.url.startsWith(`${FILES}/api/tus/public_html/`)) {
      archive = new URL(call.url).pathname.split("/").pop() ?? "";
      return new Response(null, { status: call.method === "POST" ? 201 : 204 });
    }
    if (call.url.endsWith("/deploy")) return Response.json({ message: "Request accepted" });
    if (call.url === `${FILES}/api/resources/public_html/`) {
      return Response.json({ items: listed(archive).map((name) => ({ name })) });
    }
    throw new Error(`unexpected fetch: ${call.method} ${call.url}`);
  };
}

describe("deployZipToWebsite", () => {
  it("uploads the zip via TUS, deploys it, and waits until the server consumed the archive", async () => {
    let polls = 0;
    const calls = stubFetch(
      deployResponder((archive) => (++polls < 3 ? ["index.html", archive] : ["index.html", "about.html"])),
    );

    const res = await deployZipToWebsite(site, zip, { sleep: noSleep });
    expect(res).toEqual({ ok: true, settled: true });

    const [genCall, createCall, patchCall, deployCall] = calls;
    expect(genCall.url).toBe("https://developers.hostinger.com/api/hosting/v1/files/upload-urls");
    expect(genCall.method).toBe("POST");
    expect(genCall.headers.authorization).toBe("Bearer test-token");
    expect(JSON.parse(String(genCall.body))).toEqual({ username: "u447231526", domain: "client.com" });

    // TUS create + data on the same object path inside public_html, with the returned auth keys.
    expect(createCall.url).toBe(patchCall.url);
    expect(createCall.url).toMatch(/^https:\/\/srv955-files\.hstgr\.io\/rest\/abc123\/api\/tus\/public_html\/[^/?]+\.zip\?override=true$/);
    for (const c of [createCall, patchCall]) {
      expect(c.headers["x-auth"]).toBe("AK");
      expect(c.headers["x-auth-rest"]).toBe("RK");
      expect(c.headers["tus-resumable"]).toBe("1.0.0");
    }
    expect(createCall.headers["upload-length"]).toBe(String(zip.length));
    expect(createCall.headers["upload-offset"]).toBe("0");
    expect(patchCall.headers["content-type"]).toBe("application/offset+octet-stream");
    expect(new Uint8Array(patchCall.body as Uint8Array)).toEqual(zip);

    // Deploy names the exact archive that was uploaded.
    const archiveName = new URL(createCall.url).pathname.split("/").pop();
    expect(deployCall.url).toBe(
      "https://developers.hostinger.com/api/hosting/v1/accounts/u447231526/websites/client.com/deploy",
    );
    expect(JSON.parse(String(deployCall.body))).toEqual({ archive_path: archiveName });

    // Settle polling lists public_html through the file server with the same keys.
    const listCalls = calls.filter((c) => c.url === `${FILES}/api/resources/public_html/`);
    expect(listCalls).toHaveLength(3);
    expect(listCalls[0].headers["x-auth"]).toBe("AK");
  });

  it("reports settled:false when the archive is still there after the wait (deploy still running)", async () => {
    stubFetch(deployResponder((archive) => ["index.html", archive]));
    const res = await deployZipToWebsite(site, zip, { sleep: noSleep, settleMs: 9000 });
    expect(res).toEqual({ ok: true, settled: false });
  });

  it("refuses WordPress/Node sites without touching the API — the deploy would erase them", async () => {
    const calls = stubFetch(() => {
      throw new Error("must not fetch");
    });
    for (const website_type of ["wordpress", "nodejs", "builder"]) {
      const res = await deployZipToWebsite({ ...site, website_type }, zip, { sleep: noSleep });
      expect(res.ok).toBe(false);
      if (!res.ok) expect(res.message).toMatch(/would erase it/);
    }
    expect(calls).toHaveLength(0);
  });

  it("treats a 409 from upload-urls as 'still being set up' (pending), not a failure", async () => {
    stubFetch(() => new Response(JSON.stringify({ message: "Website setup in progress" }), { status: 409 }));
    const res = await deployZipToWebsite(site, zip, { sleep: noSleep });
    expect(res).toMatchObject({ ok: false, pending: true });
  });

  it("fails cleanly when the upload URL cannot be generated", async () => {
    const calls = stubFetch(() => new Response(JSON.stringify({ message: "unauthorized" }), { status: 401 }));
    const res = await deployZipToWebsite(site, zip, { sleep: noSleep });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.message).toContain("unauthorized");
    expect(calls).toHaveLength(1); // never proceeds to TUS or deploy
  });

  it("stops before deploying when the TUS upload is rejected", async () => {
    const calls = stubFetch((call) => {
      if (call.url.includes("/files/upload-urls")) return uploadUrlOk();
      return new Response("storage full", { status: 500 });
    });
    const res = await deployZipToWebsite(site, zip, { sleep: noSleep });
    expect(res.ok).toBe(false);
    expect(calls.some((c) => c.url.includes("/deploy"))).toBe(false);
  });

  it("surfaces the deploy error message", async () => {
    stubFetch((call) => {
      if (call.url.includes("/files/upload-urls")) return uploadUrlOk();
      if (call.url.includes("/api/tus/")) return new Response(null, { status: call.method === "POST" ? 201 : 204 });
      return new Response(JSON.stringify({ message: "Only static websites can be deployed" }), { status: 422 });
    });
    const res = await deployZipToWebsite(site, zip, { sleep: noSleep });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.message).toContain("Only static websites can be deployed");
  });
});

describe("downloadWebsiteZip", () => {
  it("downloads public_html as a zip through the file server with the upload-URL keys", async () => {
    const siteZip = zipSync({ "index.html": strToU8("<p>live</p>"), "img/logo.png": new Uint8Array([137, 80, 78, 71]) });
    const calls = stubFetch((call) => {
      if (call.url.endsWith("/files/upload-urls")) return uploadUrlOk();
      if (call.url === `${FILES}/api/raw/public_html?algo=zip`) {
        return new Response(siteZip, { status: 200, headers: { "content-type": "application/zip" } });
      }
      throw new Error(`unexpected fetch: ${call.url}`);
    });
    const res = await downloadWebsiteZip(site);
    expect(res).toEqual({ ok: true, zip: siteZip });
    const raw = calls.find((c) => c.url.includes("/api/raw/"));
    expect(raw?.headers["x-auth"]).toBe("AK");
    expect(raw?.headers["x-auth-rest"]).toBe("RK");
  });

  it("refuses a response that is not a zip (e.g. an error page)", async () => {
    stubFetch((call) =>
      call.url.endsWith("/files/upload-urls") ? uploadUrlOk() : new Response("<html>oops</html>", { status: 200 }),
    );
    const res = await downloadWebsiteZip(site);
    expect(res).toMatchObject({ ok: false });
  });

  it("never returns a cut-off zip: a truncated stream is retried once, then refused", async () => {
    const full = zipSync({ "index.html": strToU8("<p>live</p>".repeat(50)), "style.css": strToU8("body{}".repeat(50)) });
    const truncated = full.slice(0, Math.floor(full.length / 2)); // still starts with "PK"
    let rawCalls = 0;
    stubFetch((call) => {
      if (call.url.endsWith("/files/upload-urls")) return uploadUrlOk();
      rawCalls++;
      return new Response(truncated, { status: 200 });
    });
    const res = await downloadWebsiteZip(site);
    expect(res).toMatchObject({ ok: false });
    if (!res.ok) expect(res.message).toMatch(/cut off/);
    expect(rawCalls).toBe(2);
  });

  it("recovers when the retry gets the complete zip", async () => {
    const full = zipSync({ "index.html": strToU8("<p>live</p>") });
    let rawCalls = 0;
    stubFetch((call) => {
      if (call.url.endsWith("/files/upload-urls")) return uploadUrlOk();
      rawCalls++;
      return new Response(rawCalls === 1 ? full.slice(0, 10) : full, { status: 200 });
    });
    expect(await downloadWebsiteZip(site)).toEqual({ ok: true, zip: full });
  });

  it("refuses sites over the size cap instead of buffering them", async () => {
    stubFetch((call) =>
      call.url.endsWith("/files/upload-urls")
        ? uploadUrlOk()
        : new Response(new Uint8Array(64).fill(0x50), { status: 200, headers: { "content-length": "64" } }),
    );
    const res = await downloadWebsiteZip(site, { maxBytes: 32 });
    expect(res).toMatchObject({ ok: false });
    if (!res.ok) expect(res.message).toMatch(/too large/);
  });
});

describe("listDomains", () => {
  it("drops nameless entries — an unclaimed free domain (domain: null) used to crash every transfer", async () => {
    stubFetch(() =>
      Response.json([
        { id: 1, domain: "early.com", type: "domain", status: "active", expires_at: null },
        { id: 2, domain: null, type: "free_domain", status: "pending_setup", expires_at: null },
        { id: 3, domain: "newclient.com", type: "domain", status: "active", expires_at: null },
      ]),
    );
    const domains = await listDomains();
    expect(domains?.map((d) => d.domain)).toEqual(["early.com", "newclient.com"]);
    // the exact check the transfer route used to crash on
    expect(domains?.some((d) => d.domain.toLowerCase() === "newclient.com")).toBe(true);
  });

  it("returns null (not []) when the portfolio can't be read", async () => {
    stubFetch(() => new Response("down", { status: 500 }));
    expect(await listDomains()).toBeNull();
  });
});

describe("listWebsites / getWebsite", () => {
  it("walks every page of the website list", async () => {
    stubFetch((call) => {
      const page = Number(new URL(call.url).searchParams.get("page"));
      return Response.json({
        data: [{ domain: `site${page}.com`, username: "u1", website_type: "other" }],
        meta: { current_page: page, last_page: 2 },
      });
    });
    expect((await listWebsites())?.map((w) => w.domain)).toEqual(["site1.com", "site2.com"]);
  });

  it("picks the exact domain out of the substring-filtered results, case-insensitively", async () => {
    stubFetch(() =>
      Response.json({
        data: [
          { domain: "myclient.com", username: "u1", root_directory: "/a" },
          { domain: "Client.com", username: "u2", root_directory: "/b" },
        ],
      }),
    );
    expect((await getWebsite("client.com"))?.username).toBe("u2");
  });

  it("isStaticWebsite: only plain static sites (or unknown) take archive deploys", () => {
    expect(isStaticWebsite({ website_type: "other" })).toBe(true);
    expect(isStaticWebsite({})).toBe(true);
    expect(isStaticWebsite({ website_type: "wordpress" })).toBe(false);
  });
});

describe("ensureWebsite", () => {
  const ws = { domain: "client.com", username: "u447231526", root_directory: "/home/u/domains/client.com/public_html", website_type: "other" };

  it("returns an existing website with no setup running, without creating anything", async () => {
    const calls = stubFetch((call) => {
      if (call.url.includes("/websites?domain=")) return Response.json({ data: [ws] });
      if (call.url.includes("/onboardings")) return Response.json([]);
      throw new Error(`unexpected fetch: ${call.method} ${call.url}`);
    });
    const res = await ensureWebsite("client.com", { sleep: noSleep });
    expect(res).toMatchObject({ ok: true, created: false });
    expect(calls.some((c) => c.method === "POST")).toBe(false);
  });

  it("creates the website on the pinned plan and waits for its setup to complete", async () => {
    process.env[ORDER_KEY] = "1009861861";
    let created = false;
    let polls = 0;
    const calls = stubFetch((call) => {
      if (call.method === "POST" && call.url.endsWith("/api/hosting/v1/websites")) {
        created = true;
        return Response.json({ message: "Request accepted" });
      }
      if (call.url.includes("/websites?domain=")) return Response.json({ data: created ? [ws] : [] });
      if (call.url.includes("/onboardings")) {
        polls++;
        return Response.json([{ domain: "client.com", username: "u447231526", status: polls < 3 ? "running" : "completed" }]);
      }
      throw new Error(`unexpected fetch: ${call.method} ${call.url}`);
    });
    const res = await ensureWebsite("client.com", { sleep: noSleep });
    expect(res).toMatchObject({ ok: true, created: true });
    const post = calls.find((c) => c.method === "POST");
    expect(JSON.parse(String(post?.body))).toEqual({ domain: "client.com", order_id: 1009861861 });
    expect(polls).toBe(3);
  });

  it("comes back pending (nothing else changed) when the setup outlasts the wait", async () => {
    process.env[ORDER_KEY] = "1";
    stubFetch((call) => {
      if (call.method === "POST") return Response.json({ message: "Request accepted" });
      if (call.url.includes("/websites?domain=")) return Response.json({ data: [] });
      return Response.json([{ domain: "client.com", status: "running" }]);
    });
    const res = await ensureWebsite("client.com", { sleep: noSleep, waitMs: 30000 });
    expect(res).toMatchObject({ ok: false, pending: true });
  });

  it("reports a failed setup", async () => {
    stubFetch((call) => {
      if (call.url.includes("/websites?domain=")) return Response.json({ data: [ws] });
      return Response.json([{ domain: "client.com", status: "failed" }]);
    });
    const res = await ensureWebsite("client.com", { sleep: noSleep });
    expect(res).toMatchObject({ ok: false });
    expect("pending" in res && res.pending).toBeFalsy();
  });
});

describe("ensureSsl", () => {
  it("requests a certificate when none is installed", async () => {
    const calls = stubFetch((call) =>
      call.url.endsWith("/ssl/status") ? Response.json({ status: "not_installed" }) : Response.json({ message: "Request accepted" }),
    );
    expect(await ensureSsl(site)).toBe("installing");
    expect(calls[1].url).toBe("https://developers.hostinger.com/api/hosting/v1/accounts/u447231526/websites/client.com/ssl/setup");
  });

  it("leaves an active certificate alone", async () => {
    const calls = stubFetch(() => Response.json({ status: "active" }));
    expect(await ensureSsl(site)).toBe("active");
    expect(calls).toHaveLength(1);
  });
});

describe("getHostingOrderId", () => {
  it("prefers HOSTINGER_ORDER_ID from the environment, with no API round-trip", async () => {
    process.env[ORDER_KEY] = "1009861861";
    const calls = stubFetch(() => {
      throw new Error("should not fetch when the order id is pinned");
    });
    expect(await getHostingOrderId()).toBe(1009861861);
    expect(calls).toHaveLength(0);
  });

  it("falls back to discovering the order from an existing website", async () => {
    stubFetch(
      () =>
        new Response(JSON.stringify({ data: [{ domain: "x.com", order_id: 42, username: "u1", root_directory: "/x" }] }), {
          status: 200,
        }),
    );
    expect(await getHostingOrderId()).toBe(42);
  });
});
