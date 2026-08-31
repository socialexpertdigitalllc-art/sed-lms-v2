import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  daConfigured,
  parseDaResponse,
  daCall,
  createSubdomain,
  deleteSubdomain,
  subdomainExists,
  docrootFor,
  subFromWebsiteLink,
  clearDocroot,
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

describe("docrootFor / subFromWebsiteLink", () => {
  it("docrootFor uses the per-subdomain layout verified on the live server", () => {
    setEnv();
    // NOT /domains/dmviral.com/public_html/acme — each subdomain owns its tree.
    expect(docrootFor("acme")).toBe("/domains/acme.dmviral.com/public_html");
  });

  it("subFromWebsiteLink recovers the subdomain from a lead's website_link", () => {
    expect(subFromWebsiteLink("https://warrior-contracting.dmviral.com", "dmviral.com")).toBe("warrior-contracting");
    expect(subFromWebsiteLink("http://acme.dmviral.com/index.html", "dmviral.com")).toBe("acme");
    expect(subFromWebsiteLink("https://acme.dmviral.com/", "dmviral.com")).toBe("acme");
  });

  it("returns null for links outside our domain, bare domains, or garbage", () => {
    expect(subFromWebsiteLink("https://clientsite.com", "dmviral.com")).toBeNull();
    expect(subFromWebsiteLink("https://dmviral.com", "dmviral.com")).toBeNull();
    expect(subFromWebsiteLink("https://a.b.dmviral.com", "dmviral.com")).toBeNull(); // nested — not ours
    expect(subFromWebsiteLink("", "dmviral.com")).toBeNull();
    expect(subFromWebsiteLink(null, "dmviral.com")).toBeNull();
    expect(subFromWebsiteLink("not a url", "dmviral.com")).toBeNull();
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

describe("daCall / createSubdomain / deleteSubdomain / subdomainExists", () => {
  it("createSubdomain uses action=create (this DA build rejects action=add) in the query string", async () => {
    setEnv();
    const calls = stubFetch(() => ({ ok: true, status: 200, text: "error=0&text=Subdomain+created&details=" }));
    const res = await createSubdomain("acme-x1y2z3");
    expect(res.error).toBe(false);
    expect(res.text).toBe("Subdomain created");
    const url = calls[0].url;
    expect(url).toContain("/CMD_API_SUBDOMAINS?");
    expect(url).toContain("action=create");
    expect(url).toContain("domain=dmviral.com");
    expect(url).toContain("subdomain=acme-x1y2z3");
    const auth = (calls[0].init?.headers as Record<string, string>).Authorization;
    expect(auth).toMatch(/^Basic /);
  });

  /**
   * REGRESSION (prod, 2026-08-27 + 2026-08-31): subdomain creation provisions
   * the vhost AND issues the cert before DA answers — 30-60s on this server,
   * as this module's own header note says — but every call shared one 30s
   * timeout. Auto-deploy aborted the request mid-provision, reported "This
   * operation was aborted", and left the subdomain DA went on to create
   * orphaned on the hosting. Creation gets its own, provisioning-sized budget.
   */
  it("gives subdomain creation a longer timeout than an ordinary DA call", async () => {
    setEnv();
    vi.useFakeTimers();
    try {
      const aborts: string[] = [];
      vi.stubGlobal(
        "fetch",
        vi.fn(
          (url: string, init?: RequestInit) =>
            new Promise((_resolve, reject) => {
              init?.signal?.addEventListener("abort", () => {
                aborts.push(url);
                reject(new Error("This operation was aborted"));
              });
            })
        )
      );

      const list = daCall("CMD_API_SUBDOMAINS", { domain: "dmviral.com" });
      let created = false;
      const create = createSubdomain("acme-x1y2z3").then((r) => {
        created = true;
        return r;
      });

      // 90s in — three times the ordinary budget, and past the slow end of
      // DA's documented 30-60s cert issuance. The list call is long gone; the
      // create must still be waiting, because this is exactly the window the
      // old shared timeout cut off.
      await vi.advanceTimersByTimeAsync(90_000);
      expect((await list).error).toBe(true);
      expect(aborts).toHaveLength(1);
      expect(created).toBe(false);

      // It is still bounded, though — a wedged connection must not hang a
      // deploy forever.
      await vi.advanceTimersByTimeAsync(120_000);
      expect((await create).error).toBe(true);
      expect(aborts).toHaveLength(2);
    } finally {
      vi.useRealTimers();
    }
  });

  it("deleteSubdomain removes the subdomain AND its directory contents", async () => {
    setEnv();
    const calls = stubFetch(() => ({ ok: true, status: 200, text: "error=0&text=Subdomains+deleted" }));
    const res = await deleteSubdomain("acme");
    expect(res.error).toBe(false);
    const url = calls[0].url;
    expect(url).toContain("action=delete");
    expect(url).toContain("select0=acme");
    expect(url).toContain("contents=yes");
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

describe("uploadZipAndExtract (modern filemanager-actions API)", () => {
  it("uploads to the subdomain docroot, extracts, then removes the zip", async () => {
    setEnv();
    const calls = stubFetch(() => ({ ok: true, status: 204, text: "" }));
    const res = await uploadZipAndExtract("acme", new Uint8Array([80, 75, 3, 4]), "site.zip");
    expect(res).toEqual({ ok: true });
    expect(calls).toHaveLength(3);

    // 1. upload: dir/name/overwrite in the QUERY (this build ignores `path`), file as multipart
    const up = calls[0];
    expect(up.url).toContain("/api/filemanager-actions/upload?");
    expect(up.url).toContain("dir=" + encodeURIComponent("/domains/acme.dmviral.com/public_html"));
    expect(up.url).toContain("name=site.zip");
    expect(up.url).toContain("overwrite=true");
    const fd = up.init?.body as FormData;
    expect(fd).toBeInstanceOf(FormData);
    expect((fd.get("file") as File).name).toBe("site.zip");

    // 2. extract-archive: JSON body with the verified required fields
    const ex = calls[1];
    expect(ex.url).toContain("/api/filemanager-actions/extract-archive");
    const exBody = JSON.parse(String(ex.init?.body));
    expect(exBody).toEqual({
      source: "/domains/acme.dmviral.com/public_html/site.zip",
      destinationDir: "/domains/acme.dmviral.com/public_html",
      members: [],
      mergeAndOverwrite: true,
    });

    // 3. remove: JSON paths
    const rm = calls[2];
    expect(rm.url).toContain("/api/filemanager-actions/remove");
    expect(JSON.parse(String(rm.init?.body))).toEqual({
      paths: ["/domains/acme.dmviral.com/public_html/site.zip"],
    });
  });

  it("reports the failing step and the server's JSON error message", async () => {
    setEnv();
    let n = 0;
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        n++;
        if (n === 2) {
          return {
            ok: false,
            status: 409,
            text: async () => '{"errors":[{"path":"x","reason":"NOT_FOUND"}],"type":"FILEMANAGER_MULTI_OP_ERROR"}',
          };
        }
        return { ok: true, status: 204, text: async () => "" };
      })
    );
    const res = await uploadZipAndExtract("acme", new Uint8Array([1]), "site.zip");
    expect(res.ok).toBe(false);
    expect(res.failedStep).toBe("extract");
    expect(res.message).toMatch(/NOT_FOUND|409/);
  });
});

describe("clearDocroot", () => {
  it("removes every docroot entry except cgi-bin (in-place redeploy)", async () => {
    setEnv();
    const calls = stubFetch((url) => {
      if (url.includes("/api/filemanager/list")) {
        return {
          ok: true,
          status: 200,
          text: JSON.stringify({
            files: [
              { name: "cgi-bin", type: "dir" },
              { name: "index.html", type: "file" },
              { name: "service-roofing.html", type: "file" },
              { name: "assets", type: "dir" },
            ],
          }),
        };
      }
      return { ok: true, status: 204, text: "" };
    });
    const res = await clearDocroot("acme");
    expect(res.ok).toBe(true);
    const rm = calls.find((c) => c.url.includes("/remove"));
    expect(rm).toBeDefined();
    const paths = JSON.parse(String(rm!.init?.body)).paths as string[];
    expect(paths).toEqual([
      "/domains/acme.dmviral.com/public_html/index.html",
      "/domains/acme.dmviral.com/public_html/service-roofing.html",
      "/domains/acme.dmviral.com/public_html/assets",
    ]);
  });

  it("is ok on an already-empty docroot without calling remove", async () => {
    setEnv();
    const calls = stubFetch((url) => {
      if (url.includes("/api/filemanager/list")) {
        return { ok: true, status: 200, text: JSON.stringify({ files: [{ name: "cgi-bin", type: "dir" }] }) };
      }
      return { ok: true, status: 204, text: "" };
    });
    const res = await clearDocroot("acme");
    expect(res.ok).toBe(true);
    expect(calls.some((c) => c.url.includes("/remove"))).toBe(false);
  });

  it("fails loudly when the listing fails (never blind-deploys onto unknown contents)", async () => {
    setEnv();
    stubFetch(() => ({ ok: false, status: 500, text: "boom" }));
    const res = await clearDocroot("acme");
    expect(res.ok).toBe(false);
  });
});
