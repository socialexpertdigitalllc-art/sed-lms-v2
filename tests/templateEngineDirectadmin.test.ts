import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  daConfigured,
  parseDaResponse,
  daCall,
  createSubdomain,
  subdomainExists,
  uploadZipAndExtract,
} from "@/lib/template-engine/directadmin";

const KEYS = ["DA_HOST", "DA_USERNAME", "DA_LOGIN_KEY", "DA_DOMAIN"] as const;
let saved: Record<string, string | undefined>;

const setEnv = () => {
  process.env.DA_HOST = "https://server.example.com:2222";
  process.env.DA_USERNAME = "sedadmin";
  process.env.DA_LOGIN_KEY = "loginkey";
  process.env.DA_DOMAIN = "dmviral.com";
};

beforeEach(() => {
  saved = {};
  for (const k of KEYS) saved[k] = process.env[k];
});

afterEach(() => {
  for (const k of KEYS) {
    if (saved[k] === undefined) delete process.env[k];
    else process.env[k] = saved[k];
  }
  vi.unstubAllGlobals();
});

describe("daConfigured", () => {
  it("is true only when all four env vars are set", () => {
    setEnv();
    expect(daConfigured()).toBe(true);
    delete process.env.DA_LOGIN_KEY;
    expect(daConfigured()).toBe(false);
    setEnv();
    delete process.env.DA_HOST;
    expect(daConfigured()).toBe(false);
  });
});

describe("parseDaResponse", () => {
  it("parses a legacy url-encoded error", () => {
    expect(parseDaResponse("error=1&text=Error&details=That+domain+already+exists")).toEqual({
      error: true,
      text: "Error",
      details: "That domain already exists",
    });
  });

  it("parses a legacy url-encoded success", () => {
    expect(parseDaResponse("error=0&text=Subdomain+created&details=none")).toEqual({
      error: false,
      text: "Subdomain created",
      details: "none",
    });
  });

  it("treats a list response (no error key) as success", () => {
    const r = parseDaResponse("list[]=blog&list[]=shop");
    expect(r.error).toBe(false);
  });

  it("tolerates JSON bodies", () => {
    expect(parseDaResponse('{"error":1,"text":"Denied","details":"nope"}')).toEqual({
      error: true,
      text: "Denied",
      details: "nope",
    });
    expect(parseDaResponse('{"error":0,"text":"OK"}')).toEqual({ error: false, text: "OK", details: "" });
    expect(parseDaResponse('{"error":"1","text":"Bad"}').error).toBe(true);
  });
});

type FetchCall = { url: string; init?: RequestInit };
const stubFetch = (responder: (url: string, init?: RequestInit) => { ok: boolean; status: number; text: string }) => {
  const calls: FetchCall[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init?: RequestInit) => {
      calls.push({ url, init });
      const r = responder(url, init);
      return { ok: r.ok, status: r.status, text: async () => r.text };
    })
  );
  return calls;
};

describe("daCall / createSubdomain / subdomainExists", () => {
  it("createSubdomain POSTs action=add with basic auth", async () => {
    setEnv();
    const calls = stubFetch(() => ({ ok: true, status: 200, text: "error=0&text=Subdomain+created&details=" }));
    const res = await createSubdomain("acme-x1y2z3");
    expect(res.error).toBe(false);
    expect(res.text).toBe("Subdomain created");
    expect(res.raw).toContain("error=0");
    expect(calls[0].url).toBe("https://server.example.com:2222/CMD_API_SUBDOMAINS");
    const body = String(calls[0].init?.body);
    expect(body).toContain("action=add");
    expect(body).toContain("domain=dmviral.com");
    expect(body).toContain("subdomain=acme-x1y2z3");
    const auth = (calls[0].init?.headers as Record<string, string>).Authorization;
    expect(auth).toMatch(/^Basic /);
  });

  it("subdomainExists checks the url-encoded list[] values", async () => {
    setEnv();
    const calls = stubFetch(() => ({ ok: true, status: 200, text: "list[]=blog&list[]=acme-x1y2z3" }));
    expect(await subdomainExists("acme-x1y2z3")).toBe(true);
    expect(await subdomainExists("missing")).toBe(false);
    expect(calls[0].url).toContain("/CMD_API_SUBDOMAINS?");
    expect(calls[0].url).toContain("domain=dmviral.com");
  });

  it("returns error=true on network failure or http error without throwing", async () => {
    setEnv();
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new Error("ECONNREFUSED");
      })
    );
    const res = await daCall("CMD_API_SUBDOMAINS", { domain: "dmviral.com" });
    expect(res.error).toBe(true);
    expect(await subdomainExists("x")).toBe(false);

    const calls = stubFetch(() => ({ ok: false, status: 401, text: "<html>login</html>" }));
    const res2 = await daCall("CMD_API_SUBDOMAINS", { domain: "dmviral.com" });
    expect(res2.error).toBe(true);
    expect(calls).toHaveLength(1);
  });
});

describe("uploadZipAndExtract", () => {
  it("uploads (multipart), extracts, then deletes the zip", async () => {
    setEnv();
    const calls = stubFetch(() => ({ ok: true, status: 200, text: "error=0&text=done" }));
    const res = await uploadZipAndExtract("acme", new Uint8Array([80, 75, 3, 4]), "site.zip");
    expect(res).toEqual({ ok: true });
    expect(calls).toHaveLength(3);

    const fd = calls[0].init?.body as FormData;
    expect(fd).toBeInstanceOf(FormData);
    expect(fd.get("action")).toBe("upload");
    expect(fd.get("path")).toBe("/domains/dmviral.com/public_html/acme");
    expect((fd.get("file1") as File).name).toBe("site.zip");

    const extractBody = String(calls[1].init?.body);
    expect(extractBody).toContain("action=extract");
    expect(extractBody).toContain(encodeURIComponent("/domains/dmviral.com/public_html/acme/site.zip"));
    expect(extractBody).toContain("directory=" + encodeURIComponent("/domains/dmviral.com/public_html/acme"));

    const delBody = String(calls[2].init?.body);
    expect(delBody).toContain("action=multiple");
    expect(delBody).toContain("button=delete");
    expect(delBody).toContain("select0=" + encodeURIComponent("/domains/dmviral.com/public_html/acme/site.zip"));
  });

  it("reports the failing step and message", async () => {
    setEnv();
    let n = 0;
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        n++;
        const text = n === 2 ? "error=1&text=Cannot+extract&details=bad+zip" : "error=0&text=ok";
        return { ok: true, status: 200, text: async () => text };
      })
    );
    const res = await uploadZipAndExtract("acme", new Uint8Array([1]), "site.zip");
    expect(res.ok).toBe(false);
    expect(res.failedStep).toBe("extract");
    expect(res.message).toMatch(/Cannot extract/);
  });
});
