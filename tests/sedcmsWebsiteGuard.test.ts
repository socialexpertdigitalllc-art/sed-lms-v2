// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { memorySupabase, type MemoryDb } from "./helpers/memorySupabase";
import { SEDCMS_DEFAULTS, SEDCMS_UNIQUE, linkRow } from "./helpers/sedcmsRoutes";

/**
 * leads.website_link on a lead SED CMS is turned on for (lib/sedcms/links.ts;
 * the security review's I1): moving it to another host, or replacing or
 * taking down the site, is a manager's call (studio.manage), and the managers
 * are told the CMS is paused for that lead. Unlinked leads are as before.
 * The real safety is in the internal routes (tests/sedcmsLinks.test.ts): a
 * moved host is a 409 there until a manager confirms it.
 */

const state = vi.hoisted(() => ({
  db: null as MemoryDb | null,
  perms: new Set<string>(),
  notified: [] as { event: string; ctx: Record<string, unknown>; opts: Record<string, unknown> }[],
  hosting: [] as string[],
}));

vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({ auth: { getUser: async () => ({ data: { user: { id: "agent-1" } } }) } }),
}));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => state.db!.client }));
vi.mock("@/lib/permissions/resolver", () => ({ getUserPermissions: async () => state.perms }));
vi.mock("@/lib/permissions/isAdminMember", () => ({ isAdminMember: async () => false }));
vi.mock("@/lib/notifications/notify", () => ({
  notify: async (event: string, ctx: Record<string, unknown>, opts: Record<string, unknown>) => void state.notified.push({ event, ctx, opts }),
}));
vi.mock("@/lib/leads/statusEvents", () => ({ recordStatusChange: async () => {} }));
vi.mock("@/lib/template-engine/forceResolve", () => ({ cancelGenerationsForLeads: async () => {} }));
vi.mock("@/lib/receipts/notify", () => ({ notifyReceiptNeeded: async () => {} }));
vi.mock("@/lib/domains/service", () => ({ nudgeWaitingDomain: async () => null }));
vi.mock("@/lib/domains/processor", () => ({ processDomains: async () => ({}) }));
vi.mock("@/lib/domains/leadCheck", () => ({ kickLeadDomainChecks: () => {} }));
vi.mock("@/lib/domains/deps", () => ({ realPipelineDeps: () => ({}) }));
vi.mock("@/lib/teams/closers", () => ({ canActForAgent: async () => false, actingAs: () => null }));
vi.mock("@/lib/template-engine/directadmin", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/template-engine/directadmin")>();
  const hosting = (name: string) => async () => {
    state.hosting.push(name);
    throw new Error(`${name} must not be called`);
  };
  return {
    ...actual,
    daConfigured: () => true,
    createSubdomain: hosting("createSubdomain"),
    subdomainExists: hosting("subdomainExists"),
    deleteSubdomain: hosting("deleteSubdomain"),
    uploadZipAndExtract: hosting("uploadZipAndExtract"),
    archiveDocroot: hosting("archiveDocroot"),
    clearDocroot: hosting("clearDocroot"),
  };
});
vi.mock("@/lib/hostinger/client", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/hostinger/client")>()),
  hostingerConfigured: () => true,
}));
vi.mock("@/lib/site-studio/deploy/transfer", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/site-studio/deploy/transfer")>()),
  pushStagingToDomain: async () => {
    state.hosting.push("pushStagingToDomain");
    throw new Error("pushStagingToDomain must not be called");
  },
}));

import { PATCH } from "@/app/api/leads/[id]/route";
import { POST as shufflePOST } from "@/app/api/site-studio/deployments/shuffle/route";
import { POST as deployPOST } from "@/app/api/template-engine/generations/[id]/deploy/route";
import { POST as takedownPOST } from "@/app/api/template-engine/generations/[id]/takedown/route";
import { POST as transferPOST } from "@/app/api/template-engine/generations/[id]/transfer/route";
import { MOVE_NEEDS_MANAGER, linkedSiteRefusal, noteWebsiteLinkChange, websiteMoveRefusal } from "@/lib/sedcms/links";

const LINKED = "11111111-1111-4111-8111-111111111111";
const UNLINKED = "22222222-2222-4222-8222-222222222222";
const GEN_LINKED = "33333333-3333-4333-8333-333333333333";
const GEN_UNLINKED = "44444444-4444-4444-8444-444444444444";

beforeEach(() => {
  process.env.DA_DOMAIN = "dmviral.com";
  state.perms = new Set(["leads.status_change"]); // no leads.edit, no studio.manage
  state.notified = [];
  state.hosting = [];
  const lead = (id: string, name: string, link: string) => ({
    id,
    agent_id: "agent-1",
    closed_by: null,
    status: "Ready",
    business_name: name,
    website_link: link,
    deleted_at: null,
  });
  state.db = memorySupabase(
    {
      leads: [lead(LINKED, "Other Co", "https://other-co.dmviral.com"), lead(UNLINKED, "Plain Co", "https://plain-co.dmviral.com")],
      sedcms_links: [linkRow(LINKED, "other-co.dmviral.com")],
      activity_log: [],
      studio_deployments: [
        { id: "dep-linked", lead_id: LINKED, subdomain: "other-co", url: "https://other-co.dmviral.com", status: "live", leads: { business_name: "Other Co", agent_id: "agent-1", closed_by: null } },
      ],
      template_generations: [
        { id: GEN_LINKED, lead_id: LINKED, status: "deployed", steps: [], site_slug: "other-co-1a2b", zip_path: "x.zip", gate_results: { ok: true }, deployed_url: "https://other-co.dmviral.com" },
        { id: GEN_UNLINKED, lead_id: UNLINKED, status: "deployed", steps: [], site_slug: "plain-co-1a2b", zip_path: "x.zip", gate_results: { ok: true }, deployed_url: "https://plain-co.dmviral.com" },
      ],
    },
    SEDCMS_DEFAULTS,
    SEDCMS_UNIQUE,
  );
});

const patch = (id: string, body: Record<string, unknown>) =>
  PATCH(new Request(`http://test.local/api/leads/${id}`, { method: "PATCH", body: JSON.stringify(body) }), { params: Promise.resolve({ id }) });
const websiteOf = (id: string) => state.db!.tables.leads.find((l) => l.id === id)!.website_link;
const paused = () => state.notified.filter((n) => n.event === "sedcms_host_changed");

describe("probe-website-link-retarget, inverted: the leads PATCH", () => {
  it("a status-only PATCH can't re-point a linked lead's website with leads.status_change alone", async () => {
    const res = await patch(LINKED, { status: "Ready", website_link: "https://acme-roofing.dmviral.com" });
    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ error: MOVE_NEEDS_MANAGER });
    expect(websiteOf(LINKED)).toBe("https://other-co.dmviral.com");
    expect(paused()).toEqual([]);
  });

  it("nor with leads.edit: moving a linked lead's website needs studio.manage", async () => {
    state.perms = new Set(["leads.edit", "leads.view_all"]);
    expect((await patch(LINKED, { website_link: "https://acme-roofing.dmviral.com" })).status).toBe(403);
    expect(websiteOf(LINKED)).toBe("https://other-co.dmviral.com");
  });

  it("the same host written another way is no move, and is allowed", async () => {
    const res = await patch(LINKED, { status: "Ready", website_link: "https://other-co.dmviral.com/" });
    expect(res.status).toBe(200);
    expect(websiteOf(LINKED)).toBe("https://other-co.dmviral.com/");
    expect(paused()).toEqual([]);
  });

  it("an unlinked lead is as before: leads.status_change may set it, and nobody is told about SED CMS", async () => {
    const res = await patch(UNLINKED, { status: "Ready", website_link: "https://plain-cov2.dmviral.com" });
    expect(res.status).toBe(200);
    expect(websiteOf(UNLINKED)).toBe("https://plain-cov2.dmviral.com");
    expect(paused()).toEqual([]);
    expect(state.db!.tables.activity_log.filter((r) => r.action === "sedcms.host_changed")).toEqual([]);
  });

  it("a manager may move it: the change is logged and the managers are told the CMS is paused", async () => {
    state.perms = new Set(["leads.status_change", "studio.manage"]);
    const res = await patch(LINKED, { status: "Ready", website_link: "https://other-cov2.dmviral.com" });
    expect(res.status).toBe(200);
    expect(websiteOf(LINKED)).toBe("https://other-cov2.dmviral.com");
    expect(state.db!.tables.activity_log.filter((r) => r.action === "sedcms.host_changed")).toEqual([
      expect.objectContaining({
        user_id: "agent-1",
        entity_type: "lead",
        entity_id: LINKED,
        old_value: { host: "other-co.dmviral.com" },
        new_value: { host: "other-cov2.dmviral.com" },
      }),
    ]);
    expect(paused()).toEqual([
      {
        event: "sedcms_host_changed",
        ctx: { leadId: LINKED, actorId: "agent-1" },
        opts: expect.objectContaining({
          title: "SED CMS paused for a lead",
          body: "Other Co: The website address changed from other-co.dmviral.com to other-cov2.dmviral.com. A manager must confirm the new address. Open the lead and press Open in CMS.",
          dedupKey: expect.stringMatching(/^sedcms_host_changed:11111111-1111-4111-8111-111111111111:other-co[.]dmviral[.]com:other-cov2[.]dmviral[.]com:/),
          targetUrl: `/leads/${LINKED}`,
        }),
      },
    ]);
  });
});

describe("the other ways a website moves", () => {
  it("a shuffle by tickets.resolve alone is refused for a linked lead, before any hosting call", async () => {
    state.perms = new Set(["tickets.resolve"]);
    const res = await shufflePOST(new Request("http://test.local/api/site-studio/deployments/shuffle?site=https://other-co.dmviral.com", { method: "POST" }));
    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ error: MOVE_NEEDS_MANAGER });
    expect(state.hosting).toEqual([]);
    expect(websiteOf(LINKED)).toBe("https://other-co.dmviral.com");
  });

  it("a template deploy, take-down or transfer by templates.deploy alone is refused for a linked lead, before any hosting call", async () => {
    state.perms = new Set(["templates.deploy"]);
    const ctx = { params: Promise.resolve({ id: GEN_LINKED }) };
    const req = (body?: unknown) => new Request("http://test.local/x", { method: "POST", body: body ? JSON.stringify(body) : undefined });
    for (const res of [await deployPOST(req(), ctx), await takedownPOST(req(), ctx), await transferPOST(req({ domain: "other-co.com" }), ctx)]) {
      expect(res.status).toBe(403);
      expect(await res.json()).toEqual({ error: MOVE_NEEDS_MANAGER });
    }
    expect(state.hosting).toEqual([]);
    expect(websiteOf(LINKED)).toBe("https://other-co.dmviral.com");
  });

  it("an unlinked lead's take-down goes ahead as before (it reaches the hosting)", async () => {
    state.perms = new Set(["templates.deploy"]);
    await expect(takedownPOST(new Request("http://test.local/x", { method: "POST" }), { params: Promise.resolve({ id: GEN_UNLINKED }) })).rejects.toThrow(
      "deleteSubdomain must not be called",
    );
    expect(state.hosting).toEqual(["deleteSubdomain"]);
  });
});

describe("lib/sedcms/links.ts", () => {
  const db = () => state.db!.client;

  it("linkedSiteRefusal: studio.manage, or an unlinked lead, is never refused; a linked one is", async () => {
    expect(await linkedSiteRefusal(db(), LINKED, new Set(["studio.manage"]))).toBeNull();
    expect(await linkedSiteRefusal(db(), UNLINKED, new Set(["tickets.resolve"]))).toBeNull();
    expect(await linkedSiteRefusal(db(), LINKED, new Set(["tickets.resolve"]))).toEqual({ status: 403, error: MOVE_NEEDS_MANAGER });
  });

  it("fails closed when the link can't be read, except while migration 0094 isn't applied", async () => {
    const answering = (error: { message: string }) =>
      ({ from: () => ({ select: () => ({ eq: () => ({ is: () => ({ maybeSingle: async () => ({ data: null, error }) }) }) }) }) }) as never;
    const perms = new Set(["tickets.resolve"]);
    expect(await linkedSiteRefusal(answering({ message: "canceling statement due to statement timeout" }), LINKED, perms)).toMatchObject({ status: 503 });
    expect(await linkedSiteRefusal(answering({ message: 'relation "public.sedcms_links" does not exist' }), LINKED, perms)).toBeNull();
    expect(await linkedSiteRefusal(answering({ message: "Could not find the table 'public.sedcms_links' in the schema cache" }), LINKED, perms)).toBeNull();
    // a row that isn't a link is an error, never "no link"
    const odd = { from: () => ({ select: () => ({ eq: () => ({ is: () => ({ maybeSingle: async () => ({ data: { id: "x" }, error: null }) }) }) }) }) } as never;
    expect(await linkedSiteRefusal(odd, LINKED, perms)).toMatchObject({ status: 503 });
  });

  it("websiteMoveRefusal reads nothing for a same-host edit", async () => {
    const untouchable = { from: () => { throw new Error("read"); } } as never;
    expect(await websiteMoveRefusal(untouchable, LINKED, "https://other-co.dmviral.com", "other-co.dmviral.com/about", new Set())).toBeNull();
  });

  it("noteWebsiteLinkChange tells nobody for an unlinked lead, a same-host edit, or a lead moved back to its linked host; and never throws", async () => {
    await noteWebsiteLinkChange(db(), { leadId: UNLINKED, after: "https://x.dmviral.com", actorId: null });
    await noteWebsiteLinkChange(db(), { leadId: LINKED, before: "https://other-co.dmviral.com", after: "https://other-co.dmviral.com/", actorId: null });
    await noteWebsiteLinkChange(db(), { leadId: LINKED, after: "https://other-co.dmviral.com", actorId: null }); // website_link is still the linked host
    await noteWebsiteLinkChange({ from: () => { throw new Error("down"); } } as never, { leadId: LINKED, actorId: null });
    expect(state.notified).toEqual([]);
    expect(state.db!.tables.activity_log).toEqual([]);
  });

  it("noteWebsiteLinkChange reads where the lead's website is now, so a conditional write that didn't happen tells nobody", async () => {
    await noteWebsiteLinkChange(db(), { leadId: LINKED, actorId: "manager-1" }); // e.g. update ... where website_link = <an old url> matched nothing
    expect(state.notified).toEqual([]);
    state.db!.tables.leads.find((l) => l.id === LINKED)!.website_link = null; // taken down
    await noteWebsiteLinkChange(db(), { leadId: LINKED, actorId: "manager-1" });
    expect(paused()).toHaveLength(1);
    expect(paused()[0].opts.body).toBe(
      "Other Co: The lead has no website address any more (it was other-co.dmviral.com). A manager must give it one and confirm it. Open the lead and press Open in CMS.",
    );
  });
});

describe("every write of leads.website_link", () => {
  function sources(dir: string): string[] {
    return readdirSync(dir).flatMap((name) => {
      const path = join(dir, name);
      if (statSync(path).isDirectory()) return name === "node_modules" ? [] : sources(path);
      return /[.]tsx?$/.test(name) ? [path] : [];
    });
  }

  it("is followed by noteWebsiteLinkChange, so the managers hear when SED CMS pauses (found by reading the source)", () => {
    const writers = [...sources("app"), ...sources("lib")]
      .map((path) => {
        const src = readFileSync(path, "utf8");
        return { path, writes: src.split("update({ website_link").length - 1, notes: src.split("noteWebsiteLinkChange(").length - 1 };
      })
      .filter((f) => f.writes > 0);
    expect(writers.length).toBeGreaterThanOrEqual(12);
    for (const f of writers) expect(f.notes, f.path).toBeGreaterThanOrEqual(f.writes);
  }, 60_000);
});
