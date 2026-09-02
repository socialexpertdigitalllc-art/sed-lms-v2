// @vitest-environment node
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { deployZipToWebsite, getHostingOrderId } from "@/lib/hostinger/client";

/**
 * The hosting-plan migration split the fleet across two Linux accounts, so the
 * old "write into the addon docroot on the shared disk" deploy path
 * (fsDeploy.deployZipToDir) can no longer reach sites on the other account.
 * deployZipToWebsite replaces it with Hostinger's own API flow, verified
 * against the published OpenAPI spec (hostinger/api):
 *   1. POST /api/hosting/v1/files/upload-urls {username, domain}
 *        -> { url, auth_key, rest_auth_key }
 *   2. TUS upload of the zip into public_html:
 *        POST  {url}/{name}?override=true   (create, expect 201)
 *        PATCH {url}/{name}?override=true   (bytes, expect 204)
 *   3. POST /api/hosting/v1/accounts/{username}/websites/{domain}/deploy
 *        { archive_path } — server clears the docroot and extracts.
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

const site = { domain: "client.com", username: "u447231526" };
const zip = new Uint8Array([0x50, 0x4b, 3, 4, 9, 9, 9, 9]);

const uploadUrlOk = () =>
  new Response(JSON.stringify({ url: "https://srv-files.hstgr.io/", auth_key: "AK", rest_auth_key: "RK" }), {
    status: 200,
  });

describe("deployZipToWebsite", () => {
  it("uploads the zip via TUS and deploys it from the archive", async () => {
    const calls = stubFetch((call) => {
      if (call.url.includes("/files/upload-urls")) return uploadUrlOk();
      if (call.method === "POST" && call.url.startsWith("https://srv-files.hstgr.io/")) {
        return new Response(null, { status: 201 });
      }
      if (call.method === "PATCH" && call.url.startsWith("https://srv-files.hstgr.io/")) {
        return new Response(null, { status: 204, headers: { "Upload-Offset": String(zip.length) } });
      }
      if (call.url.includes("/deploy")) return new Response(JSON.stringify({ message: "ok" }), { status: 200 });
      throw new Error(`unexpected fetch: ${call.method} ${call.url}`);
    });

    const res = await deployZipToWebsite(site, zip);
    expect(res).toEqual({ ok: true });

    expect(calls).toHaveLength(4);

    const [genCall, createCall, patchCall, deployCall] = calls;
    expect(genCall.url).toBe("https://developers.hostinger.com/api/hosting/v1/files/upload-urls");
    expect(genCall.method).toBe("POST");
    expect(genCall.headers.authorization).toBe("Bearer test-token");
    expect(JSON.parse(String(genCall.body))).toEqual({ username: "u447231526", domain: "client.com" });

    // TUS create + data on the same object path, with the returned auth keys.
    expect(createCall.url).toBe(patchCall.url);
    expect(createCall.url).toMatch(/^https:\/\/srv-files\.hstgr\.io\/[^/?]+\.zip\?override=true$/);
    for (const c of [createCall, patchCall]) {
      expect(c.headers["x-auth"]).toBe("AK");
      expect(c.headers["x-auth-rest"]).toBe("RK");
      expect(c.headers["tus-resumable"]).toBe("1.0.0");
    }
    expect(createCall.headers["upload-length"]).toBe(String(zip.length));
    expect(createCall.headers["upload-offset"]).toBe("0");
    expect(patchCall.headers["content-type"]).toBe("application/offset+octet-stream");
    expect(patchCall.headers["upload-offset"]).toBe("0");
    expect(new Uint8Array(patchCall.body as ArrayBufferLike | Uint8Array as Uint8Array)).toEqual(zip);

    // Deploy names the exact archive that was uploaded.
    const archiveName = new URL(createCall.url).pathname.slice(1);
    expect(deployCall.url).toBe(
      "https://developers.hostinger.com/api/hosting/v1/accounts/u447231526/websites/client.com/deploy",
    );
    expect(JSON.parse(String(deployCall.body))).toEqual({ archive_path: archiveName });
  });

  it("fails cleanly when the upload URL cannot be generated", async () => {
    const calls = stubFetch(() => new Response(JSON.stringify({ message: "unauthorized" }), { status: 401 }));
    const res = await deployZipToWebsite(site, zip);
    expect(res.ok).toBe(false);
    expect(res.message).toContain("unauthorized");
    expect(calls).toHaveLength(1); // never proceeds to TUS or deploy
  });

  it("stops before deploying when the TUS upload is rejected", async () => {
    const calls = stubFetch((call) => {
      if (call.url.includes("/files/upload-urls")) return uploadUrlOk();
      return new Response("storage full", { status: 500 });
    });
    const res = await deployZipToWebsite(site, zip);
    expect(res.ok).toBe(false);
    expect(calls.some((c) => c.url.includes("/deploy"))).toBe(false);
  });

  it("surfaces the deploy error message", async () => {
    const res = await (async () => {
      stubFetch((call) => {
        if (call.url.includes("/files/upload-urls")) return uploadUrlOk();
        if (call.method === "POST" && call.url.startsWith("https://srv-files.hstgr.io/")) {
          return new Response(null, { status: 201 });
        }
        if (call.method === "PATCH" && call.url.startsWith("https://srv-files.hstgr.io/")) {
          return new Response(null, { status: 204, headers: { "Upload-Offset": String(zip.length) } });
        }
        return new Response(JSON.stringify({ message: "Only static websites can be deployed" }), { status: 422 });
      });
      return deployZipToWebsite(site, zip);
    })();
    expect(res.ok).toBe(false);
    expect(res.message).toContain("Only static websites can be deployed");
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
