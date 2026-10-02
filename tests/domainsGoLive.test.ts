// @vitest-environment node
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

/**
 * 2026-10-02, GG Tile: the lead's site lived at ggtile.dmviral.com, but only as
 * a link typed onto the lead — no deployment row — so the domain waited
 * forever; then the files were uploaded to the domain by hand and the
 * dashboard still waited. What must hold now:
 *   - the lead's dmviral link is enough to find (and start tracking) its
 *     staging site — but never a staging site tracked for ANOTHER lead;
 *   - a site found already on the domain is recorded as the lead's: link,
 *     log, notice — and nothing is copied, overwritten or deleted.
 */

const da = vi.hoisted(() => ({ subdomainExists: vi.fn(async () => true), deleteSubdomain: vi.fn() }));
const notifications = vi.hoisted(() => ({ notify: vi.fn(async () => {}) }));
vi.mock("@/lib/template-engine/directadmin", async (importOriginal) => ({ ...(await importOriginal<object>()), ...da }));
vi.mock("@/lib/notifications/notify", () => notifications);
vi.mock("@/lib/notifications/rules", () => ({ getRule: vi.fn(async () => ({ event_key: "website_custom_domain" })) }));
vi.mock("@/lib/site-studio/deploy/transfer", () => ({ pushStagingToDomain: vi.fn(), probeSite: vi.fn() }));

import { findOrTrackStaging, recordSiteOnDomain, stagingSubFromLink } from "@/lib/site-studio/deploy/golive";

type Rec = Record<string, unknown>;
let seq = 0;
function fakeDb(tables: Record<string, Rec[]>) {
  function q(table: string, op: "select" | "update", patch?: Rec) {
    const filters: ((r: Rec) => boolean)[] = [];
    const run = () => {
      const rows = (tables[table] ??= []).filter((r) => filters.every((f) => f(r)));
      if (op === "update") for (const r of rows) Object.assign(r, patch);
      return rows.map((r) => ({ ...r }));
    };
    const b: Rec = {
      eq: (k: string, v: unknown) => (filters.push((r) => r[k] === v), b),
      is: (k: string, v: unknown) => (filters.push((r) => (r[k] ?? null) === v), b),
      order: () => b,
      select: () => b,
      maybeSingle: async () => ({ data: run()[0] ?? null, error: null }),
      then: (res: (v: unknown) => unknown, rej?: (e: unknown) => unknown) => Promise.resolve({ data: run(), error: null }).then(res, rej),
    };
    return b;
  }
  const admin = {
    from: (table: string) => ({
      select: () => q(table, "select"),
      update: (patch: Rec) => q(table, "update", patch),
      insert: (row: Rec) => {
        const created = { id: `row-${++seq}`, ...row };
        (tables[table] ??= []).push(created);
        const res = { data: { ...created }, error: null };
        return { select: () => ({ single: async () => res }), then: (r: (v: unknown) => unknown) => Promise.resolve(res).then(r) };
      },
    }),
  };
  return { admin: admin as never, tables };
}

const LEAD = "9e3991c2-dd99-46e2-bc3a-6a31d149b025";
const ENV = process.env.DA_DOMAIN;
beforeEach(() => {
  vi.clearAllMocks();
  da.subdomainExists.mockResolvedValue(true);
  process.env.DA_DOMAIN = "dmviral.com";
});
afterEach(() => {
  process.env.DA_DOMAIN = ENV;
});

describe("stagingSubFromLink", () => {
  it("reads the staging label off a link, with or without https://", () => {
    expect(stagingSubFromLink("https://ggtile.dmviral.com/")).toBe("ggtile");
    expect(stagingSubFromLink("ggtile.dmviral.com")).toBe("ggtile");
    expect(stagingSubFromLink("https://ggtileinc.com")).toBeNull();
    expect(stagingSubFromLink(null)).toBeNull();
  });
});

describe("findOrTrackStaging", () => {
  it("a tracked staging deployment of the lead wins", async () => {
    const db = fakeDb({
      studio_deployments: [{ id: "dep-1", lead_id: LEAD, subdomain: "ggtile", url: "https://ggtile.dmviral.com", status: "live", deployed_at: "2026-10-01" }],
      leads: [{ id: LEAD, website_link: "https://ggtile.dmviral.com/" }],
    });
    expect(await findOrTrackStaging(db.admin, LEAD, "u1")).toEqual({ id: "dep-1", url: "https://ggtile.dmviral.com" });
    expect(da.subdomainExists).not.toHaveBeenCalled();
  });

  it("only a dmviral LINK on the lead (the GG Tile case): the staging site starts being tracked for the lead", async () => {
    const db = fakeDb({ studio_deployments: [], leads: [{ id: LEAD, website_link: "https://ggtile.dmviral.com/" }], activity_log: [] });
    const found = await findOrTrackStaging(db.admin, LEAD, "u1");
    expect(found).toEqual({ id: expect.any(String), url: "https://ggtile.dmviral.com" });
    expect(da.subdomainExists).toHaveBeenCalledWith("ggtile");
    expect(db.tables.studio_deployments[0]).toMatchObject({ subdomain: "ggtile", status: "live", origin: "manual", lead_id: LEAD });
    expect(db.tables.activity_log[0]).toMatchObject({ action: "studio.deployment.tracked", new_value: expect.objectContaining({ subdomain: "ggtile", lead_id: LEAD }) });
  });

  it("an untracked staging row with no lead is given this lead", async () => {
    const db = fakeDb({
      studio_deployments: [{ id: "dep-9", lead_id: null, subdomain: "ggtile", url: "https://ggtile.dmviral.com", status: "live" }],
      leads: [{ id: LEAD, website_link: "ggtile.dmviral.com" }],
    });
    expect(await findOrTrackStaging(db.admin, LEAD, "u1")).toEqual({ id: "dep-9", url: "https://ggtile.dmviral.com" });
    expect(db.tables.studio_deployments[0].lead_id).toBe(LEAD);
  });

  it("never takes a staging site tracked for another lead", async () => {
    const db = fakeDb({
      studio_deployments: [{ id: "dep-2", lead_id: "other-lead", subdomain: "ggtile", url: "https://ggtile.dmviral.com", status: "live" }],
      leads: [{ id: LEAD, website_link: "https://ggtile.dmviral.com/" }],
    });
    expect(await findOrTrackStaging(db.admin, LEAD, "u1")).toBeNull();
    expect(db.tables.studio_deployments[0].lead_id).toBe("other-lead");
  });

  it("no staging link, or a subdomain that's gone from the hosting: nothing to move", async () => {
    const custom = fakeDb({ studio_deployments: [], leads: [{ id: LEAD, website_link: "https://ggtileinc.com" }] });
    expect(await findOrTrackStaging(custom.admin, LEAD, "u1")).toBeNull();
    expect(da.subdomainExists).not.toHaveBeenCalled();
    da.subdomainExists.mockResolvedValue(false);
    const gone = fakeDb({ studio_deployments: [], leads: [{ id: LEAD, website_link: "https://ggtile.dmviral.com/" }] });
    expect(await findOrTrackStaging(gone.admin, LEAD, "u1")).toBeNull();
    expect(gone.tables.studio_deployments).toEqual([]);
  });
});

describe("recordSiteOnDomain", () => {
  it("points the lead's website link at the domain, logs it and tells the lead's people — copies nothing", async () => {
    const db = fakeDb({
      leads: [{ id: LEAD, business_name: "GG Tile Inc", agent_id: "agent-1", closed_by: null, website_link: "https://ggtile.dmviral.com/" }],
      activity_log: [],
    });
    await recordSiteOnDomain({ admin: db.admin, leadId: LEAD, domain: "ggtileinc.com", actorId: "u1", how: "found_on_domain" });
    expect(db.tables.leads[0].website_link).toBe("https://ggtileinc.com");
    expect(db.tables.activity_log[0]).toMatchObject({
      action: "lead.website_on_domain",
      entity_id: LEAD,
      new_value: { from: "https://ggtile.dmviral.com/", to: "https://ggtileinc.com", how: "found_on_domain" },
    });
    expect(notifications.notify).toHaveBeenCalledWith(
      "website_custom_domain",
      expect.objectContaining({ leadId: LEAD }),
      expect.objectContaining({ dedupKey: `website_custom_domain:${LEAD}:ggtileinc.com`, websiteUrl: "https://ggtileinc.com" }),
    );
    expect(da.deleteSubdomain).not.toHaveBeenCalled();
  });

  it("a lead already pointing at the domain is left as it is", async () => {
    const db = fakeDb({ leads: [{ id: LEAD, business_name: "GG Tile Inc", agent_id: null, closed_by: null, website_link: "https://www.ggtileinc.com/" }], activity_log: [] });
    await recordSiteOnDomain({ admin: db.admin, leadId: LEAD, domain: "ggtileinc.com", actorId: "u1", how: "marked_by_hand" });
    expect(db.tables.activity_log).toEqual([]);
    expect(notifications.notify).not.toHaveBeenCalled();
  });
});
