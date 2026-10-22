// @vitest-environment node
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { memorySupabase, type MemoryDb } from "./helpers/memorySupabase";
import { withEnv } from "./helpers/fakeSiteHosts";
import { CMS_MINT_PATH, CMS_MINT_TIMEOUT_MS, cmsConfig, mintCmsLink } from "@/lib/sedcms/cms";

/**
 * "Open in CMS" on a lead (launch plan L7): POST /api/sedcms/open { leadId },
 * with the developer's own LMS session. The LMS asks SED CMS for a one-time
 * sign-in link for that developer (POST {SEDCMS_URL}/api/auth/lms-sso/mint
 * with its API key), and hands the browser only a link on the CMS's own
 * address. The CMS is a stubbed fetch here.
 */

const state = vi.hoisted(() => ({
  user: null as { id: string } | null,
  perms: new Set<string>(),
  rls: null as MemoryDb | null,
  admin: null as MemoryDb | null,
}));

vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({
    auth: { getUser: async () => ({ data: { user: state.user }, error: null }) },
    from: (table: string) => state.rls!.client.from(table),
  }),
}));
vi.mock("@/lib/permissions/resolver", () => ({ getUserPermissions: async () => state.perms }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => state.admin!.client }));

import { POST as openPOST } from "@/app/api/sedcms/open/route";

const CMS = "https://cms.sedsolutions.online";
const API_KEY = "sedcms-test-api-key-not-a-real-one";
const USER = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const LEAD = "11111111-1111-4111-8111-111111111111";
const HIDDEN_LEAD = "22222222-2222-4222-8222-222222222222";
const DELETED_LEAD = "33333333-3333-4333-8333-333333333333";
const TOKEN = "q8Zr1tZ7m3X0kVYp2L5nA9sD4fG6hJ8kL0zX2cV4bN6";
const LINK = `${CMS}/api/auth/lms-sso/redeem?token=${TOKEN}`;

interface Call {
  url: string;
  init: RequestInit;
}

function cms(answer: (call: Call) => Response | Promise<Response>) {
  const calls: Call[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init: RequestInit) => {
      const call = { url: String(url), init };
      calls.push(call);
      return answer(call);
    }),
  );
  return calls;
}

const minted = (url: unknown = LINK) => Response.json({ url, expiresAt: "2026-10-23T03:00:00.000Z" });

function open(body: unknown, contentType = "application/json") {
  return openPOST(
    new Request("https://lms.sedsolutions.online/api/sedcms/open", {
      method: "POST",
      headers: { "content-type": contentType },
      body: typeof body === "string" ? body : JSON.stringify(body),
    }),
  );
}

let restoreEnv: () => void;

beforeEach(() => {
  restoreEnv = withEnv({ SEDCMS_URL: CMS, SEDCMS_API_KEY: API_KEY, NODE_ENV: "test" });
  state.user = { id: USER };
  state.perms = new Set(["leads.view", "studio.manage"]);
  // what this user's row-level security lets them see
  state.rls = memorySupabase({
    leads: [
      { id: LEAD, business_name: "Acme", website_link: "https://acme.dmviral.com", deleted_at: null },
      { id: DELETED_LEAD, business_name: "Gone", website_link: null, deleted_at: "2026-10-01T00:00:00Z" },
    ],
  });
  state.admin = memorySupabase({ activity_log: [] });
});
afterEach(() => {
  restoreEnv();
  vi.unstubAllGlobals();
});

const opened = () => state.admin!.tables.activity_log.filter((r) => r.action === "cms.opened");

describe("who may open the CMS", () => {
  it("signed out is a 401 and no permission is a 403, before the CMS is called", async () => {
    const calls = cms(() => minted());
    state.user = null;
    expect((await open({ leadId: LEAD })).status).toBe(401);
    state.user = { id: USER };
    state.perms = new Set(["leads.view", "tickets.view", "tickets.create"]);
    expect((await open({ leadId: LEAD })).status).toBe(403);
    expect(calls).toHaveLength(0);
  });

  it("studio.manage or tickets.resolve is enough", async () => {
    cms(() => minted());
    for (const perm of ["studio.manage", "tickets.resolve"]) {
      state.perms = new Set([perm]);
      expect((await open({ leadId: LEAD })).status, perm).toBe(200);
    }
  });

  it("a lead the user can't see (or a deleted one) is a 404; a malformed body is a 400 or 415", async () => {
    const calls = cms(() => minted());
    expect((await open({ leadId: HIDDEN_LEAD })).status).toBe(404);
    expect((await open({ leadId: DELETED_LEAD })).status).toBe(404);
    expect((await open({ leadId: "not-a-uuid" })).status).toBe(400);
    expect((await open({ leadId: LEAD, extra: 1 })).status).toBe(400);
    expect((await open("not json")).status).toBe(400);
    expect((await open({ leadId: LEAD }, "text/plain")).status).toBe(415);
    expect(calls).toHaveLength(0);
  });
});

describe("the mint call", () => {
  it("carries the key and the user's own LMS id, to the CMS's mint path, following no redirect", async () => {
    const calls = cms(() => minted());
    const res = await open({ leadId: LEAD });
    expect(res.status).toBe(200);
    expect(calls).toHaveLength(1);
    const [call] = calls;
    expect(call.url).toBe(`${CMS}${CMS_MINT_PATH}`);
    expect(CMS_MINT_PATH).toBe("/api/auth/lms-sso/mint");
    expect(call.init.method).toBe("POST");
    const headers = new Headers(call.init.headers);
    expect(headers.get("x-api-key")).toBe(API_KEY);
    expect(headers.get("content-type")).toBe("application/json");
    expect(JSON.parse(String(call.init.body))).toEqual({ lmsUserId: USER, leadId: LEAD });
    expect(call.init.redirect).toBe("error");
    expect(call.init.signal).toBeInstanceOf(AbortSignal);
  });

  it("answers { url } with the CMS's link, never cached, and logs cms.opened without the link", async () => {
    cms(() => minted());
    const log = vi.spyOn(console, "warn");
    const res = await open({ leadId: LEAD });
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toBe("no-store");
    expect(await res.json()).toEqual({ url: LINK });
    expect(opened()).toHaveLength(1);
    expect(opened()[0]).toMatchObject({ user_id: USER, action: "cms.opened", entity_type: "lead", entity_id: LEAD, new_value: { leadId: LEAD } });
    expect(JSON.stringify(state.admin!.tables.activity_log)).not.toContain(TOKEN);
    expect(log.mock.calls.flat().join(" ")).not.toContain(TOKEN);
    log.mockRestore();
  });

  it("UNKNOWN_DEVELOPER tells the developer to ask Aqib, with their LMS id", async () => {
    cms(() => Response.json({ code: "UNKNOWN_DEVELOPER", message: "No linked staff account" }, { status: 404 }));
    const res = await open({ leadId: LEAD });
    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ code: "UNKNOWN_DEVELOPER", error: `Ask Aqib to link your LMS account (your LMS id: ${USER})` });
    expect(opened()).toHaveLength(0);
  });

  it("a link that isn't on SEDCMS_URL's own address is a 502: the LMS never redirects anywhere else", async () => {
    const quiet = vi.spyOn(console, "warn").mockImplementation(() => {});
    for (const url of [
      `https://evil.example/api/auth/lms-sso/redeem?token=${TOKEN}`,
      `https://cms.sedsolutions.online.evil.example/x?token=${TOKEN}`,
      `http://cms.sedsolutions.online/api/auth/lms-sso/redeem?token=${TOKEN}`,
      `https://user:pw@cms.sedsolutions.online/api/auth/lms-sso/redeem?token=${TOKEN}`,
      `https://cms.sedsolutions.online:8443/api/auth/lms-sso/redeem?token=${TOKEN}`,
      `//evil.example/x`,
      `/api/auth/lms-sso/redeem?token=${TOKEN}`,
      `javascript:alert(1)//${CMS}/`,
      `${CMS}`,
      `${CMS}/${"a".repeat(2048)}`,
      42,
      null,
    ]) {
      cms(() => minted(url));
      const res = await open({ leadId: LEAD });
      expect(res.status, String(url).slice(0, 60)).toBe(502);
      expect(await res.json()).toEqual({ code: "CMS_UNAVAILABLE", error: expect.any(String) });
    }
    expect(opened()).toHaveLength(0);
    quiet.mockRestore();
  });

  it("a rate-limited key is a 429; any other answer, a redirect, or an oversized answer is a 502", async () => {
    const quiet = vi.spyOn(console, "warn").mockImplementation(() => {});
    cms(() => Response.json({ code: "LMS_KEY_RATE_LIMITED", message: "Too many" }, { status: 429 }));
    expect((await open({ leadId: LEAD })).status).toBe(429);
    for (const answer of [
      () => Response.json({ code: "INVALID_LMS_KEY", message: "Not authorised" }, { status: 401 }),
      () => Response.json({ code: "UNKNOWN_TENANT" }, { status: 404 }),
      () => new Response("<html>bad gateway</html>", { status: 502 }),
      () => new Response("not json", { status: 200 }),
      () => Response.json({ url: LINK, pad: "x".repeat(70 * 1024) }),
      (call: Call) => {
        // what fetch does with redirect: "error" when the CMS answers a redirect
        if (call.init.redirect === "error") throw new TypeError("fetch failed: unexpected redirect");
        return minted();
      },
    ]) {
      cms(answer);
      const res = await open({ leadId: LEAD });
      expect(res.status).toBe(502);
    }
    expect(opened()).toHaveLength(0);
    quiet.mockRestore();
  });
});

describe("the CMS link's configuration (lib/sedcms/cms.ts)", () => {
  it("is off (503) while SEDCMS_URL or SEDCMS_API_KEY is missing or malformed, and says why without the values", async () => {
    const calls = cms(() => minted());
    const err = vi.spyOn(console, "error").mockImplementation(() => {});
    for (const env of [
      { SEDCMS_URL: undefined },
      { SEDCMS_API_KEY: undefined },
      { SEDCMS_API_KEY: ` ${API_KEY}` },
      { SEDCMS_URL: `${CMS} ` },
      { SEDCMS_URL: `${CMS}/studio` },
      { SEDCMS_URL: `${CMS}/?x=1` },
      { SEDCMS_URL: "http://cms.sedsolutions.online" },
      { SEDCMS_URL: "https://user:pw@cms.sedsolutions.online" },
      { SEDCMS_URL: "not a url" },
    ]) {
      const restore = withEnv(env);
      try {
        const res = await open({ leadId: LEAD });
        expect(res.status, JSON.stringify(env)).toBe(503);
      } finally {
        restore();
      }
    }
    expect(calls).toHaveLength(0);
    const logged = err.mock.calls.flat().join(" ");
    expect(logged).not.toContain(API_KEY);
    expect(logged).toContain("SEDCMS_URL");
    expect(logged).toContain("SEDCMS_API_KEY");
    err.mockRestore();
  });

  it("takes an origin, with or without its slash; http only for localhost outside production", () => {
    expect(cmsConfig({ SEDCMS_URL: `${CMS}/`, SEDCMS_API_KEY: API_KEY })).toEqual({ ok: true, origin: CMS, apiKey: API_KEY });
    expect(cmsConfig({ SEDCMS_URL: "http://localhost:3000", SEDCMS_API_KEY: API_KEY, NODE_ENV: "development" })).toMatchObject({ ok: true, origin: "http://localhost:3000" });
    expect(cmsConfig({ SEDCMS_URL: "http://localhost:3000", SEDCMS_API_KEY: API_KEY, NODE_ENV: "production" })).toMatchObject({ ok: false });
    expect(cmsConfig({ SEDCMS_URL: "http://127.0.0.1:3000", SEDCMS_API_KEY: API_KEY, NODE_ENV: "test" })).toMatchObject({ ok: true });
  });

  it("gives up after 10 s", async () => {
    expect(CMS_MINT_TIMEOUT_MS).toBe(10_000);
    vi.stubGlobal(
      "fetch",
      vi.fn(
        (_url: string, init: RequestInit) =>
          new Promise((_resolve, reject) => init.signal?.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError")))),
      ),
    );
    const result = await mintCmsLink({ origin: CMS, apiKey: API_KEY }, { lmsUserId: USER, leadId: LEAD }, { timeoutMs: 20 });
    expect(result).toMatchObject({ ok: false, kind: "unavailable" });
  });
});
