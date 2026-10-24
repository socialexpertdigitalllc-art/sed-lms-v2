// @vitest-environment node
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { createHash } from "node:crypto";
import { memorySupabase, type MemoryDb } from "./helpers/memorySupabase";
import { HG_ROOT, daDocroot, fakeHostEnv, installFakeHosts, withEnv, type FakeHosts } from "./helpers/fakeSiteHosts";
import { SEDCMS_DEFAULTS, SEDCMS_UNIQUE, TEST_SECRET, leadPath, linkRow, routeCtx, signedRequest } from "./helpers/sedcmsRoutes";

/**
 * Which leads SED CMS may touch, and where (lib/sedcms/links.ts, migration
 * 0094): the security review's I1 and I2. leads.website_link alone never
 * authorises a read or a write; a manager's link does, at one host, and a
 * changed host stops everything until a manager confirms it. Real
 * siteFilesFor, real DirectAdmin and Hostinger clients, the repo's fake hosts.
 */

const state = vi.hoisted(() => ({ db: null as MemoryDb | null }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => ({ from: (t: string) => state.db!.client.from(t) }) }));
vi.mock("@/lib/tickets/notify", () => ({ notifyTicket: async () => {} }));

import { POST as summaryPOST } from "@/app/api/internal/sedcms/leads/[id]/summary/route";
import { POST as liveFilesPOST } from "@/app/api/internal/sedcms/leads/[id]/live-files/route";
import { POST as checksumsPOST } from "@/app/api/internal/sedcms/leads/[id]/checksums/route";
import { POST as applyPOST } from "@/app/api/internal/sedcms/leads/[id]/apply/route";
import { POST as ticketsPOST } from "@/app/api/internal/sedcms/leads/[id]/tickets/route";
import { moveLink, readLink, siteHolder } from "@/lib/sedcms/links";

const VICTIM_LEAD = "11111111-1111-4111-8111-111111111111"; // the real owner of both sites
const OTHER_LEAD = "22222222-2222-4222-8222-222222222222"; // another client's lead
const STAGING = "acme-roofing.dmviral.com";
const CUSTOM = "acme-roofing.com";
const OTHER_STAGING = "other-co.dmviral.com";
const sha = (s: string) => createHash("sha256").update(s).digest("hex");
const b64 = (s: string) => Buffer.from(s).toString("base64");
const dec = (b: Uint8Array | undefined) => new TextDecoder().decode(b);

type Handler = (req: Request, ctx: { params: Promise<{ id: string }> }) => Promise<Response>;
const call = (handler: Handler, id: string, endpoint: string, body: unknown) => handler(signedRequest(leadPath(id, endpoint), body), routeCtx(id));

let restore: () => void;
let hosts: FakeHosts;
beforeEach(() => {
  restore = withEnv({ ...fakeHostEnv(), SEDCMS_LMS_SECRET: TEST_SECRET });
  hosts = installFakeHosts({ websites: [{ domain: CUSTOM, username: "u100" }] });
  hosts.da.put(`${daDocroot("acme-roofing")}/index.html`, "<h1>Acme Roofing</h1>");
  hosts.da.put(`${daDocroot("other-co")}/index.html`, "<h1>Other Co</h1>");
  hosts.hostinger.put(`${HG_ROOT}/index.html`, "<h1>Acme Roofing (live)</h1>");
});
afterEach(() => {
  restore();
  vi.unstubAllGlobals();
});

function world(otherLink: string, links: ReturnType<typeof linkRow>[]) {
  state.db = memorySupabase(
    {
      leads: [
        { id: VICTIM_LEAD, business_name: "Acme Roofing", business_email: null, status: "Closed", website_link: `https://${STAGING}`, deleted_at: null },
        { id: OTHER_LEAD, business_name: "Other Co", business_email: null, status: "Ready", website_link: otherLink, deleted_at: null },
      ],
      client_domains: [],
      activity_log: [],
      lead_tickets: [],
      ticket_items: [],
      sedcms_links: links,
    },
    SEDCMS_DEFAULTS,
    SEDCMS_UNIQUE,
  );
}

const applyBody = (host: string, before: string, requestId = "cccccccc-cccc-4ccc-8ccc-cccccccccccc") => ({
  host,
  requestId,
  changes: [{ path: "index.html", expectedSha256: sha(before), contentBase64: b64("<h1>Other Co was here</h1>") }],
});

describe("probe-lead-binding, inverted: website_link alone authorises nothing", () => {
  it("an apply for an unlinked lead whose website_link names another client's site is a 404, and nothing is written", async () => {
    world(`https://${STAGING}/`, [linkRow(VICTIM_LEAD, STAGING)]);
    const res = await call(applyPOST, OTHER_LEAD, "apply", applyBody(STAGING, "<h1>Acme Roofing</h1>"));
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ code: "NO_LEAD", message: expect.stringContaining("Open in CMS") });
    expect(hosts.da.text(`${daDocroot("acme-roofing")}/index.html`)).toBe("<h1>Acme Roofing</h1>");
    expect(hosts.calls).toHaveLength(0);
    expect(state.db!.tables.activity_log).toEqual([]);
  });

  it("a linked lead whose website_link was re-pointed at another client's site is a 409 until a manager confirms; nothing is written", async () => {
    world(`https://${STAGING}/`, [linkRow(VICTIM_LEAD, STAGING), linkRow(OTHER_LEAD, OTHER_STAGING)]);
    for (const host of [STAGING, OTHER_STAGING]) {
      const res = await call(applyPOST, OTHER_LEAD, "apply", applyBody(host, "<h1>Acme Roofing</h1>"));
      expect(res.status, host).toBe(409);
      expect(await res.json()).toEqual({
        code: "HOST_CHANGED",
        host: STAGING,
        linkedHost: OTHER_STAGING,
        needsConfirmation: true,
        message: `The website address changed from ${OTHER_STAGING} to ${STAGING}. A manager must confirm the new address.`,
      });
    }
    expect(hosts.da.text(`${daDocroot("acme-roofing")}/index.html`)).toBe("<h1>Acme Roofing</h1>");
    expect(hosts.calls).toHaveLength(0);
    // ...and the victim's site can't be confirmed for it: one site, one lead
    expect(await siteHolder(state.db!.client, STAGING, OTHER_LEAD)).toEqual({ ok: true, holder: { link: expect.objectContaining({ leadId: VICTIM_LEAD, host: STAGING }), leadDeleted: false } });
    expect((await moveLink(state.db!.client, (await linked(OTHER_LEAD))!, STAGING, "manager-1")).ok).toBe(false);
  });

  it("a linked lead naming another site in the request is a 409 carrying its own linked host", async () => {
    world(`https://${OTHER_STAGING}`, [linkRow(VICTIM_LEAD, STAGING), linkRow(OTHER_LEAD, OTHER_STAGING)]);
    const res = await call(applyPOST, OTHER_LEAD, "apply", applyBody(STAGING, "<h1>Acme Roofing</h1>"));
    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({ code: "HOST_CHANGED", host: OTHER_STAGING, message: expect.any(String) });
    expect(hosts.da.text(`${daDocroot("acme-roofing")}/index.html`)).toBe("<h1>Acme Roofing</h1>");
  });

  it("the same for a custom domain on Hostinger", async () => {
    world(`https://www.${CUSTOM}`, [linkRow(VICTIM_LEAD, CUSTOM)]);
    const res = await call(applyPOST, OTHER_LEAD, "apply", applyBody(`www.${CUSTOM}`, "<h1>Acme Roofing (live)</h1>"));
    expect(res.status).toBe(404);
    expect(dec(hosts.hostinger.files.get(`${HG_ROOT}/index.html`))).toBe("<h1>Acme Roofing (live)</h1>");
    expect(hosts.calls).toHaveLength(0);
  });
});

async function linked(leadId: string) {
  const read = await readLink(state.db!.client, leadId);
  return read.ok ? read.link : null;
}

describe("an unlinked lead is a 404 NO_LEAD on every route", () => {
  const routes: [string, Handler, unknown][] = [
    ["summary", summaryPOST, {}],
    ["live-files", liveFilesPOST, { host: STAGING }],
    ["checksums", checksumsPOST, { host: STAGING, paths: ["index.html"] }],
    ["apply", applyPOST, applyBody(STAGING, "<h1>Acme Roofing</h1>")],
    ["tickets", ticketsPOST, { requestId: "dddddddd-dddd-4ddd-8ddd-dddddddddddd", title: "Fix it", items: ["The phone"], requestedBy: { name: "Owner", email: "o@example.com" } }],
  ];

  it.each(routes)("%s", async (endpoint, handler, body) => {
    world(`https://${OTHER_STAGING}`, [linkRow(OTHER_LEAD, OTHER_STAGING)]);
    const res = await call(handler, VICTIM_LEAD, endpoint, body);
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ code: "NO_LEAD", message: "This lead isn't turned on for SED CMS in the LMS. Ask a manager to press Open in CMS on the lead." });
    expect(hosts.calls).toHaveLength(0);
    expect(state.db!.writes).toEqual([]);
  });

  it.each(routes)("%s: a revoked link is no link", async (endpoint, handler, body) => {
    world(`https://${OTHER_STAGING}`, [linkRow(VICTIM_LEAD, STAGING, { revoked_at: "2026-10-23T00:00:00.000Z" })]);
    expect((await call(handler, VICTIM_LEAD, endpoint, body)).status).toBe(404);
  });

  it.each(routes)("%s: a 503 NOT_CONFIGURED while migration 0094 isn't applied", async (endpoint, handler, body) => {
    world(`https://${OTHER_STAGING}`, []);
    const quiet = vi.spyOn(console, "error").mockImplementation(() => {});
    const real = state.db!;
    const missing = { data: null, error: { message: 'relation "public.sedcms_links" does not exist' } };
    state.db = {
      ...real,
      client: {
        from: (t: string) =>
          t === "sedcms_links" ? { select: () => ({ eq: () => ({ is: () => ({ maybeSingle: async () => missing }) }) }) } : real.client.from(t),
      } as never,
    };
    const res = await call(handler, VICTIM_LEAD, endpoint, body);
    expect(res.status).toBe(503);
    expect((await res.json()).code).toBe("NOT_CONFIGURED");
    expect(hosts.calls).toHaveLength(0);
    quiet.mockRestore();
  });
});

describe("a host change blocks reads and writes until a manager confirms it", () => {
  it("then works at the new host only", async () => {
    world(`https://${OTHER_STAGING}`, [linkRow(OTHER_LEAD, OTHER_STAGING)]);
    // the lead's website moves (a shuffle, say): other-co -> other-cov2
    hosts.da.put(`${daDocroot("other-cov2")}/index.html`, "<h1>Other Co</h1>");
    state.db!.tables.leads.find((l) => l.id === OTHER_LEAD)!.website_link = "https://other-cov2.dmviral.com";

    for (const [handler, endpoint, body] of [
      [summaryPOST, "summary", {}],
      [liveFilesPOST, "live-files", { host: "other-cov2.dmviral.com" }],
      [checksumsPOST, "checksums", { host: "other-cov2.dmviral.com", paths: ["index.html"] }],
      [applyPOST, "apply", applyBody("other-cov2.dmviral.com", "<h1>Other Co</h1>")],
      [applyPOST, "apply", applyBody(OTHER_STAGING, "<h1>Other Co</h1>")],
    ] as const) {
      const res = await call(handler, OTHER_LEAD, endpoint, body);
      expect(res.status, endpoint).toBe(409);
      expect(await res.json()).toMatchObject({ code: "HOST_CHANGED", host: "other-cov2.dmviral.com", linkedHost: OTHER_STAGING, needsConfirmation: true });
    }
    expect(hosts.calls).toHaveLength(0);
    // a change request still reaches the staff: it changes no file
    const ticket = await call(ticketsPOST, OTHER_LEAD, "tickets", {
      requestId: "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee",
      title: "Fix it",
      items: ["The phone"],
      requestedBy: { name: "Owner", email: "o@example.com" },
    });
    expect(ticket.status).toBe(201);

    // a manager confirms the new address (Open in CMS, tests/sedcmsOpen.test.ts)
    expect(await moveLink(state.db!.client, (await linked(OTHER_LEAD))!, "other-cov2.dmviral.com", "manager-1")).toEqual({ ok: true });
    const old = await call(applyPOST, OTHER_LEAD, "apply", applyBody(OTHER_STAGING, "<h1>Other Co</h1>", "ffffffff-ffff-4fff-8fff-ffffffffffff"));
    expect(old.status).toBe(409);
    expect(await old.json()).toEqual({ code: "HOST_CHANGED", host: "other-cov2.dmviral.com", message: expect.any(String) });
    const res = await call(applyPOST, OTHER_LEAD, "apply", applyBody("other-cov2.dmviral.com", "<h1>Other Co</h1>", "abababab-abab-4bab-8bab-abababababab"));
    expect(res.status).toBe(200);
    expect(hosts.da.text(`${daDocroot("other-cov2")}/index.html`)).toBe("<h1>Other Co was here</h1>");
    expect(hosts.da.text(`${daDocroot("other-co")}/index.html`)).toBe("<h1>Other Co</h1>");
  });
});
