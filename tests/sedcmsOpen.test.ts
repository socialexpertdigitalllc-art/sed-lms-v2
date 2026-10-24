// @vitest-environment node
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { memorySupabase, type MemoryDb } from "./helpers/memorySupabase";
import { withEnv } from "./helpers/fakeSiteHosts";
import { SEDCMS_DEFAULTS, SEDCMS_UNIQUE, linkRow } from "./helpers/sedcmsRoutes";
import { CMS_MINT_PATH, CMS_MINT_TIMEOUT_MS, cmsConfig, mintCmsLink } from "@/lib/sedcms/cms";

/**
 * "Open in CMS" on a lead (launch plan L7): POST /api/sedcms/open { leadId },
 * with the developer's own LMS session. The LMS asks SED CMS for a one-time
 * sign-in link for that developer (POST {SEDCMS_URL}/api/auth/lms-sso/mint
 * with its API key), and hands the browser only a link on the CMS's own
 * address. The CMS is a stubbed fetch here.
 *
 * It is also where SED CMS is turned on for a lead (lib/sedcms/links.ts):
 * only a manager (studio.manage), after a plain-words confirmation, at the
 * lead's current host; and where a manager confirms a linked lead's new
 * address.
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
const NEW_LEAD = "44444444-4444-4444-8444-444444444444";
const MOVED_LEAD = "55555555-5555-4555-8555-555555555555";
const NO_SITE_LEAD = "66666666-6666-4666-8666-666666666666";
const TWIN_LEAD = "77777777-7777-4777-8777-777777777777";
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
      { id: NEW_LEAD, business_name: "Bright Smile Dental", website_link: "https://www.brightsmile.com/", deleted_at: null },
      { id: MOVED_LEAD, business_name: "Moved Co", website_link: "https://movedv2.dmviral.com", deleted_at: null },
      { id: NO_SITE_LEAD, business_name: "No Site", website_link: null, deleted_at: null },
      { id: TWIN_LEAD, business_name: "Twin", website_link: "https://acme.dmviral.com/", deleted_at: null },
    ],
  });
  // SED CMS is on for LEAD (where the mint tests start) and was on for MOVED_LEAD at its old address
  state.admin = memorySupabase(
    { activity_log: [], sedcms_links: [linkRow(LEAD, "acme.dmviral.com"), linkRow(MOVED_LEAD, "moved.dmviral.com")] },
    SEDCMS_DEFAULTS,
    SEDCMS_UNIQUE,
  );
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

describe("what the CMS answers reaches a log line only as a code", () => {
  it("a code of anything but capitals and underscores is left out of the log", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const LF = String.fromCharCode(10);
    for (const code of [`BAD${LF}[sedcms] forged log line`, "<script>x</script>", "lower_case", "A".repeat(65), 42]) {
      cms(() => Response.json({ code, message: "nope" }, { status: 500 }));
      expect((await open({ leadId: LEAD })).status).toBe(502);
    }
    cms(() => Response.json({ code: "SOME_CODE" }, { status: 500 }));
    await open({ leadId: LEAD });
    const logged = warn.mock.calls.flat().join(" ");
    expect(logged).not.toContain("forged log line");
    expect(logged).not.toContain("<script>");
    expect(logged).not.toContain("lower_case");
    expect(logged).not.toContain("A".repeat(65));
    expect(logged).toContain("HTTP 500 SOME_CODE");
    warn.mockRestore();
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

describe("turning SED CMS on for a lead (lib/sedcms/links.ts)", () => {
  const links = () => state.admin!.tables.sedcms_links.filter((r) => r.revoked_at == null);
  const linkOf = (leadId: string) => links().filter((r) => r.lead_id === leadId);
  const audit = (action: string) => state.admin!.tables.activity_log.filter((r) => r.action === action);

  it("asks a manager to confirm in plain words first, and links nothing until they do", async () => {
    const calls = cms(() => minted());
    const res = await open({ leadId: NEW_LEAD });
    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({
      code: "CONFIRM_LINK",
      host: "www.brightsmile.com",
      message: "Turn on SED CMS for Bright Smile Dental at www.brightsmile.com? The CMS will be able to change this website's files.",
    });
    expect(linkOf(NEW_LEAD)).toHaveLength(0);
    expect(calls).toHaveLength(0);
  });

  it("confirming records the link at the lead's current host, audits it, then mints", async () => {
    const calls = cms(() => minted());
    const res = await open({ leadId: NEW_LEAD, confirmHost: "www.brightsmile.com" });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ url: LINK });
    expect(linkOf(NEW_LEAD)).toEqual([expect.objectContaining({ lead_id: NEW_LEAD, host: "www.brightsmile.com", linked_by: USER, revoked_at: null })]);
    expect(audit("sedcms.linked")).toEqual([
      expect.objectContaining({ user_id: USER, entity_type: "lead", entity_id: NEW_LEAD, new_value: { host: "www.brightsmile.com" } }),
    ]);
    expect(calls).toHaveLength(1);
    expect(JSON.parse(String(calls[0].init.body))).toEqual({ lmsUserId: USER, leadId: NEW_LEAD });
    // and the next open goes straight to the CMS
    expect((await open({ leadId: NEW_LEAD })).status).toBe(200);
    expect(audit("sedcms.linked")).toHaveLength(1);
  });

  it("a confirmation of another host than the lead's current one asks again, about the current one", async () => {
    cms(() => minted());
    const res = await open({ leadId: NEW_LEAD, confirmHost: "old-brightsmile.dmviral.com" });
    expect(res.status).toBe(409);
    expect(await res.json()).toMatchObject({ code: "CONFIRM_LINK", host: "www.brightsmile.com" });
    expect(linkOf(NEW_LEAD)).toHaveLength(0);
  });

  it("only studio.manage may link: tickets.resolve alone is refused, confirmation or not", async () => {
    const calls = cms(() => minted());
    state.perms = new Set(["tickets.resolve"]);
    for (const body of [{ leadId: NEW_LEAD }, { leadId: NEW_LEAD, confirmHost: "www.brightsmile.com" }]) {
      const res = await open(body);
      expect(res.status).toBe(403);
      expect(await res.json()).toEqual({ code: "NOT_LINKED", error: expect.stringContaining("A manager must open it in the CMS first") });
    }
    expect(linkOf(NEW_LEAD)).toHaveLength(0);
    expect(calls).toHaveLength(0);
    // ...while a linked lead whose host still matches opens as before
    expect((await open({ leadId: LEAD })).status).toBe(200);
  });

  it("a site another lead holds can't be linked again, www. or not", async () => {
    const calls = cms(() => minted());
    for (const body of [{ leadId: TWIN_LEAD }, { leadId: TWIN_LEAD, confirmHost: "acme.dmviral.com" }]) {
      const res = await open(body);
      expect(res.status).toBe(409);
      expect(await res.json()).toEqual({ code: "HOST_TAKEN", error: "acme.dmviral.com is already turned on for SED CMS on another lead." });
    }
    // brightsmile.com held by another lead blocks www.brightsmile.com
    state.admin!.tables.sedcms_links.push(linkRow(DELETED_LEAD, "brightsmile.com"));
    const res = await open({ leadId: NEW_LEAD, confirmHost: "www.brightsmile.com" });
    expect(res.status).toBe(409);
    expect((await res.json()).code).toBe("HOST_TAKEN");
    expect(linkOf(TWIN_LEAD)).toHaveLength(0);
    expect(linkOf(NEW_LEAD)).toHaveLength(0);
    expect(calls).toHaveLength(0);
  });

  it("the database refuses a second link to one site, or to one lead, even past the check (the unique indexes)", async () => {
    const { createLink } = await import("@/lib/sedcms/links");
    const db = state.admin!.client;
    expect(await createLink(db, TWIN_LEAD, "www.acme.dmviral.com", USER)).toEqual({ ok: false, taken: true });
    expect(await createLink(db, LEAD, "other.dmviral.com", USER)).toEqual({ ok: false, taken: true });
    expect(await createLink(db, NEW_LEAD, "www.brightsmile.com", USER)).toEqual({ ok: true });
    expect(links()).toHaveLength(3);
  });

  it("a changed address: a developer is told a manager must confirm it, and nothing is minted", async () => {
    const calls = cms(() => minted());
    state.perms = new Set(["tickets.resolve"]);
    const res = await open({ leadId: MOVED_LEAD, confirmHost: "movedv2.dmviral.com" });
    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({
      code: "HOST_CHANGED",
      error: "The website address changed from moved.dmviral.com to movedv2.dmviral.com. A manager must confirm the new address.",
    });
    expect(linkOf(MOVED_LEAD)).toEqual([expect.objectContaining({ host: "moved.dmviral.com" })]);
    expect(calls).toHaveLength(0);
  });

  it("a manager confirms the new address: the link moves, old -> new is audited, then it mints", async () => {
    const calls = cms(() => minted());
    const before = linkOf(MOVED_LEAD)[0].id;
    const asked = await open({ leadId: MOVED_LEAD });
    expect(asked.status).toBe(409);
    expect(await asked.json()).toEqual({
      code: "CONFIRM_HOST_CHANGE",
      host: "movedv2.dmviral.com",
      from: "moved.dmviral.com",
      message:
        "The website address changed from moved.dmviral.com to movedv2.dmviral.com. Confirm the new address? The CMS will be able to change this website's files.",
    });
    expect(calls).toHaveLength(0);
    const res = await open({ leadId: MOVED_LEAD, confirmHost: "movedv2.dmviral.com" });
    expect(res.status).toBe(200);
    expect(linkOf(MOVED_LEAD)).toEqual([expect.objectContaining({ id: before, host: "movedv2.dmviral.com", linked_by: USER })]);
    expect(audit("sedcms.host_confirmed")).toEqual([
      expect.objectContaining({
        user_id: USER,
        entity_id: MOVED_LEAD,
        old_value: { host: "moved.dmviral.com" },
        new_value: { host: "movedv2.dmviral.com" },
      }),
    ]);
    expect(calls).toHaveLength(1);
  });

  it("a protected company website can't be linked (PROTECTED_DOMAINS, www. or not)", async () => {
    const calls = cms(() => minted());
    const restore = withEnv({ PROTECTED_DOMAINS: "sedsolutions.online" });
    try {
      state.rls!.tables.leads.push({ id: "88888888-8888-4888-8888-888888888888", business_name: "SED", website_link: "https://www.sedsolutions.online", deleted_at: null });
      const res = await open({ leadId: "88888888-8888-4888-8888-888888888888", confirmHost: "www.sedsolutions.online" });
      expect(res.status).toBe(422);
      expect(await res.json()).toEqual({ code: "PROTECTED", error: "www.sedsolutions.online is a protected company website: SED CMS can't change it." });
      expect(links()).toHaveLength(2);
      expect(calls).toHaveLength(0);
    } finally {
      restore();
    }
  });

  it("a lead with no website address is a 422, and nothing is minted", async () => {
    const calls = cms(() => minted());
    const res = await open({ leadId: NO_SITE_LEAD });
    expect(res.status).toBe(422);
    expect((await res.json()).code).toBe("NO_SITE");
    expect(calls).toHaveLength(0);
  });

  it("is a 503 while migration 0094 isn't applied, and links nothing", async () => {
    const calls = cms(() => minted());
    const err = vi.spyOn(console, "error").mockImplementation(() => {});
    const real = state.admin!;
    const missing = { data: null, error: { message: 'relation "public.sedcms_links" does not exist' } };
    state.admin = {
      ...real,
      client: {
        from: (table: string) =>
          table === "sedcms_links" ? { select: () => ({ eq: () => ({ is: () => ({ maybeSingle: async () => missing }) }) }) } : real.client.from(table),
      } as never,
    };
    const res = await open({ leadId: NEW_LEAD, confirmHost: "www.brightsmile.com" });
    expect(res.status).toBe(503);
    expect((await res.json()).code).toBe("CMS_NOT_READY");
    expect(calls).toHaveLength(0);
    expect(err.mock.calls.flat().join(" ")).toContain("migration 0094");
    err.mockRestore();
  });
});

describe("a soft-deleted lead's link gives its site up to a manager", () => {
  const GONE = "99999999-9999-4999-8999-999999999999"; // soft-deleted, still linked at reclaim.dmviral.com
  const GONE_TOO = "cdcdcdcd-cdcd-4dcd-8dcd-cdcdcdcdcdcd"; // soft-deleted, still linked at movedv2.dmviral.com
  const NEXT = "abababab-abab-4bab-8bab-abababababab"; // a live lead whose site is reclaim.dmviral.com now
  const SITE = "reclaim.dmviral.com";
  const links = () => state.admin!.tables.sedcms_links;
  const active = () => links().filter((r) => r.revoked_at == null);
  const linkOf = (leadId: string) => links().find((r) => r.lead_id === leadId)!;
  const audit = (action: string) => state.admin!.tables.activity_log.filter((r) => r.action === action);

  /** The next insert or update of sedcms_links fails, as a lost connection would. */
  function failNext(op: "insert" | "update") {
    const db = state.admin!.client as unknown as { from: (t: string) => Record<string, unknown> };
    const real = db.from.bind(db);
    let armed = true;
    db.from = (t: string) => {
      const q = real(t);
      if (t !== "sedcms_links" || !armed) return q;
      return new Proxy(q, {
        get(target, p) {
          if (p !== op || !armed) return target[p as string];
          armed = false;
          const failing: Record<string, unknown> = {};
          for (const m of ["eq", "is", "in", "select"]) failing[m] = () => failing;
          failing.then = (resolve: (v: unknown) => unknown) => Promise.resolve({ data: null, error: { message: "connection lost" } }).then(resolve);
          return () => failing;
        },
      });
    };
  }

  beforeEach(() => {
    state.admin!.tables.leads = [
      { id: GONE, deleted_at: "2026-10-20T00:00:00.000Z" },
      { id: GONE_TOO, deleted_at: "2026-10-21T00:00:00.000Z" },
      { id: LEAD, deleted_at: null },
    ];
    state.admin!.tables.sedcms_links.push(linkRow(GONE, SITE), linkRow(GONE_TOO, "movedv2.dmviral.com"));
    state.rls!.tables.leads.push({ id: NEXT, business_name: "Next Co", website_link: `https://${SITE}`, deleted_at: null });
  });

  it("asks first, and ends nothing until a manager confirms", async () => {
    const calls = cms(() => minted());
    const res = await open({ leadId: NEXT });
    expect(res.status).toBe(409);
    expect(await res.json()).toMatchObject({ code: "CONFIRM_LINK", host: SITE });
    expect(linkOf(GONE).revoked_at).toBeNull();
    expect(calls).toHaveLength(0);
  });

  it("once confirmed, the deleted lead's link is ended first, then the new one made, and the log names both leads", async () => {
    const calls = cms(() => minted());
    const res = await open({ leadId: NEXT, confirmHost: SITE });
    expect(res.status).toBe(200);
    expect(linkOf(GONE)).toMatchObject({ revoked_at: expect.any(String), revoked_by: USER });
    expect(active().filter((r) => r.host === SITE)).toEqual([expect.objectContaining({ lead_id: NEXT, linked_by: USER })]);
    const order = state.admin!.writes.filter(([t]) => t === "sedcms_links").map(([, op]) => op);
    expect(order).toEqual(["update", "insert"]); // ended, then linked: never two active links
    expect(audit("sedcms.link_reclaimed")).toEqual([
      expect.objectContaining({
        user_id: USER,
        entity_type: "lead",
        entity_id: GONE,
        old_value: { leadId: GONE, host: SITE },
        new_value: { leadId: NEXT, host: SITE },
      }),
    ]);
    expect(audit("sedcms.linked")).toEqual([expect.objectContaining({ entity_id: NEXT, new_value: { host: SITE, reclaimedFrom: GONE } })]);
    expect(calls).toHaveLength(1);
  });

  it("when the new link fails, the old one is put back: never two active links, and the old one isn't lost", async () => {
    const calls = cms(() => minted());
    failNext("insert");
    const res = await open({ leadId: NEXT, confirmHost: SITE });
    expect(res.status).toBe(500);
    expect(linkOf(GONE)).toMatchObject({ revoked_at: null, revoked_by: null });
    expect(active().filter((r) => r.host === SITE)).toEqual([expect.objectContaining({ lead_id: GONE })]);
    expect(links().some((r) => r.lead_id === NEXT)).toBe(false);
    expect(audit("sedcms.link_reclaimed")).toEqual([]);
    expect(calls).toHaveLength(0);
  });

  it("when the old link can't be ended, nothing changes and nothing is linked", async () => {
    const calls = cms(() => minted());
    failNext("update");
    const res = await open({ leadId: NEXT, confirmHost: SITE });
    expect(res.status).toBe(500);
    expect(linkOf(GONE).revoked_at).toBeNull();
    expect(links().some((r) => r.lead_id === NEXT)).toBe(false);
    expect(calls).toHaveLength(0);
  });

  it("a site held by a live lead is still refused, and so is one whose lead can't be found", async () => {
    const calls = cms(() => minted());
    state.admin!.tables.leads.find((l) => l.id === GONE)!.deleted_at = null; // the holder is a live lead after all
    for (const body of [{ leadId: NEXT }, { leadId: NEXT, confirmHost: SITE }]) {
      const res = await open(body);
      expect(res.status).toBe(409);
      expect((await res.json()).code).toBe("HOST_TAKEN");
    }
    state.admin!.tables.leads = state.admin!.tables.leads.filter((l) => l.id !== GONE);
    expect((await open({ leadId: NEXT, confirmHost: SITE })).status).toBe(409);
    expect(linkOf(GONE).revoked_at).toBeNull();
    expect(links().some((r) => r.lead_id === NEXT)).toBe(false);
    expect(calls).toHaveLength(0);
  });

  it("a manager confirming a lead's new address reclaims it the same way", async () => {
    const calls = cms(() => minted());
    const res = await open({ leadId: MOVED_LEAD, confirmHost: "movedv2.dmviral.com" });
    expect(res.status).toBe(200);
    expect(linkOf(GONE_TOO)).toMatchObject({ revoked_at: expect.any(String), revoked_by: USER });
    expect(linkOf(MOVED_LEAD)).toMatchObject({ host: "movedv2.dmviral.com", revoked_at: null });
    expect(audit("sedcms.link_reclaimed")).toEqual([
      expect.objectContaining({ entity_id: GONE_TOO, new_value: { leadId: MOVED_LEAD, host: "movedv2.dmviral.com" } }),
    ]);
    expect(audit("sedcms.host_confirmed")).toEqual([
      expect.objectContaining({ entity_id: MOVED_LEAD, new_value: { host: "movedv2.dmviral.com", reclaimedFrom: GONE_TOO } }),
    ]);
    expect(calls).toHaveLength(1);
  });

  it("only a manager can: tickets.resolve alone still can't link at all", async () => {
    const calls = cms(() => minted());
    state.perms = new Set(["tickets.resolve"]);
    expect((await open({ leadId: NEXT, confirmHost: SITE })).status).toBe(403);
    expect(linkOf(GONE).revoked_at).toBeNull();
    expect(calls).toHaveLength(0);
  });
});
