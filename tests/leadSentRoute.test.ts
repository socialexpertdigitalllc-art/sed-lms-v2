import { describe, it, expect, vi, beforeEach } from "vitest";
import { memorySupabase, type MemoryDb } from "./helpers/memorySupabase";

const state = vi.hoisted(() => ({
  user: { id: "dev-1" } as { id: string } | null,
  perms: new Set<string>(["tickets.resolve"]),
  db: null as unknown as { client: unknown },
  notified: [] as string[],
}));

vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({ auth: { getUser: async () => ({ data: { user: state.user } }) } }),
}));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => state.db.client }));
vi.mock("@/lib/permissions/resolver", () => ({ getUserPermissions: async () => state.perms }));
vi.mock("@/lib/notifications/notify", () => ({ notify: async (key: string) => void state.notified.push(key) }));
vi.mock("@/lib/sedcms/links", () => ({ noteWebsiteLinkChange: async () => {} }));
vi.mock("@/lib/domains/leadCheck", () => ({ kickLeadDomainChecks: () => {} }));

import { POST } from "@/app/api/leads/[id]/sent/route";

const WITH_LINK = "11111111-1111-1111-1111-111111111111";
const IN_REVIEW = "22222222-2222-2222-2222-222222222222";
const NO_SITE = "33333333-3333-3333-3333-333333333333";
const LONG_TERM = "44444444-4444-4444-4444-444444444444";
const post = (id: string) => POST(new Request(`http://x/api/leads/${id}/sent`, { method: "POST" }), { params: Promise.resolve({ id }) });
const base = { business_name: "Biz", agent_id: "agent-1", closed_by: null, deleted_at: null };

let db: MemoryDb;
beforeEach(() => {
  state.user = { id: "dev-1" };
  state.perms = new Set(["tickets.resolve"]);
  state.notified = [];
  db = memorySupabase({
    leads: [
      { id: WITH_LINK, status: "Not Ready", website_link: "https://biz.dmviral.com", ...base },
      { id: IN_REVIEW, status: "Not Ready", website_link: null, ...base },
      { id: NO_SITE, status: "Not Ready", website_link: null, ...base },
      { id: LONG_TERM, status: "Long Term", website_link: "https://lt.dmviral.com", ...base },
    ],
    lead_site_reviews: [{ lead_id: IN_REVIEW, url: "https://review.dmviral.com", source: "site_builder", published_at: "2026-11-20T21:00:00Z" }],
    activity_log: [],
    lead_status_events: [],
  });
  state.db = db;
});

const leadRow = (id: string) => db.tables.leads.find((l) => l.id === id)!;

describe("POST /api/leads/[id]/sent", () => {
  it("Tech marks the website sent: the lead turns Ready, with history and notifications", async () => {
    const res = await post(WITH_LINK);
    expect(res.status).toBe(200);
    expect(leadRow(WITH_LINK).status).toBe("Ready");
    expect(db.tables.activity_log).toEqual([expect.objectContaining({ action: "lead.status_changed", entity_id: WITH_LINK, new_value: { status: "Ready", via: "sent_button" } })]);
    expect(db.tables.lead_status_events).toEqual([expect.objectContaining({ lead_id: WITH_LINK, from_status: "Not Ready", to_status: "Ready", changed_by: "dev-1" })]);
    expect(state.notified).toEqual(["lead_status_changed", "website_ready"]);
  });

  it("a site waiting for review is finalized in the same click", async () => {
    const res = await post(IN_REVIEW);
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ ok: true, finalized: true, websiteLink: "https://review.dmviral.com" });
    expect(leadRow(IN_REVIEW)).toMatchObject({ status: "Ready", website_link: "https://review.dmviral.com" });
    expect(db.tables.lead_site_reviews).toHaveLength(0);
    expect(state.notified).toEqual(["website_link_added", "lead_status_changed", "website_ready"]);
  });

  it("no website at all: nothing changes, and it says why", async () => {
    const res = await post(NO_SITE);
    expect(res.status).toBe(409);
    expect((await res.json()).error).toMatch(/No website yet/);
    expect(leadRow(NO_SITE).status).toBe("Not Ready");
  });

  it("already Ready is fine; other statuses are left alone", async () => {
    await post(WITH_LINK);
    const again = await post(WITH_LINK);
    expect(again.status).toBe(200);
    expect(await again.json()).toMatchObject({ already: true });
    expect((await post(LONG_TERM)).status).toBe(409);
    expect(leadRow(LONG_TERM).status).toBe("Long Term");
  });

  it("only Tech and Admin may press it", async () => {
    state.perms = new Set(["leads.view", "leads.edit", "leads.status_change"]);
    expect((await post(WITH_LINK)).status).toBe(403);
    expect(leadRow(WITH_LINK).status).toBe("Not Ready");
    state.perms = new Set(["studio.manage"]);
    expect((await post(WITH_LINK)).status).toBe(200);
  });

  it("signed out, or an unknown lead", async () => {
    expect((await post("55555555-5555-5555-5555-555555555555")).status).toBe(404);
    state.user = null;
    expect((await post(WITH_LINK)).status).toBe(401);
  });
});
