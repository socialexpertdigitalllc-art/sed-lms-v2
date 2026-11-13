import { beforeEach, describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { memorySupabase, type MemoryDb } from "./helpers/memorySupabase";

const notify = vi.fn<(...args: unknown[]) => Promise<void>>(async () => {});
const noteWebsiteLinkChange = vi.fn<(...args: unknown[]) => Promise<void>>(async () => {});
vi.mock("@/lib/notifications/notify", () => ({ notify: (...a: unknown[]) => notify(...a) }));
vi.mock("@/lib/sedcms/links", () => ({ noteWebsiteLinkChange: (...a: unknown[]) => noteWebsiteLinkChange(...a) }));

import {
  clearSiteReview,
  currentSiteLink,
  finalizeSiteReview,
  isSiteDeveloper,
  loadSiteReview,
  putSiteInReview,
  repointSiteReview,
  sameSite,
} from "@/lib/leads/siteReview";

const LEAD = { id: "lead-1", business_name: "Acme Plumbing", agent_id: "agent-1", closed_by: "closer-1", website_link: null };

let db: MemoryDb;
const admin = () => db.client as unknown as SupabaseClient;
const eventKeys = () => notify.mock.calls.map((c) => c[0]);

beforeEach(() => {
  notify.mockClear();
  noteWebsiteLinkChange.mockClear();
  db = memorySupabase({ leads: [{ ...LEAD }], lead_site_reviews: [], activity_log: [] });
});

describe("publishing a website: it waits for the developer", () => {
  it("saves the link for developers only — the lead's website link is untouched — and tells the developers", async () => {
    const r = await putSiteInReview(admin(), { lead: LEAD, url: "https://acme.dmviral.com", source: "site_builder", runId: "run-1", actorId: "dev-1" });
    expect(r).toEqual({ inReview: true });
    expect(db.tables.leads[0].website_link).toBeNull();
    expect(db.tables.lead_site_reviews).toEqual([
      expect.objectContaining({ lead_id: "lead-1", url: "https://acme.dmviral.com", source: "site_builder", run_id: "run-1", published_by: "dev-1" }),
    ]);
    expect(eventKeys()).toEqual(["website_in_review"]);
    expect(db.tables.activity_log.map((a) => a.action)).toEqual(["lead.website_in_review"]);
    expect(noteWebsiteLinkChange).not.toHaveBeenCalled();
  });

  it("a second publish replaces the one in review (one per lead)", async () => {
    await putSiteInReview(admin(), { lead: LEAD, url: "https://acme.dmviral.com", source: "site_builder", actorId: "dev-1" });
    await putSiteInReview(admin(), { lead: LEAD, url: "https://acmev2.dmviral.com", source: "site_studio", actorId: "dev-2" });
    expect(db.tables.lead_site_reviews).toHaveLength(1);
    expect(db.tables.lead_site_reviews[0]).toMatchObject({ url: "https://acmev2.dmviral.com", source: "site_studio" });
  });

  it("before migration 0101 is applied, publishes the old way instead of failing", async () => {
    const real = db.client.from.bind(db.client);
    (db.client as unknown as { from: (t: string) => unknown }).from = (t: string) =>
      t === "lead_site_reviews"
        ? { upsert: async () => ({ data: null, error: { message: 'relation "public.lead_site_reviews" does not exist' } }) }
        : real(t);
    const r = await putSiteInReview(admin(), { lead: LEAD, url: "https://acme.dmviral.com", source: "site_builder", actorId: "dev-1" });
    expect(r).toEqual({ inReview: false, fallback: true });
    expect(db.tables.leads[0].website_link).toBe("https://acme.dmviral.com");
    expect(eventKeys()).toEqual(["website_link_added"]);
  });

  it("any other error is reported, and nothing reaches the lead", async () => {
    const real = db.client.from.bind(db.client);
    (db.client as unknown as { from: (t: string) => unknown }).from = (t: string) =>
      t === "lead_site_reviews" ? { upsert: async () => ({ data: null, error: { message: "permission denied" } }) } : real(t);
    const r = await putSiteInReview(admin(), { lead: LEAD, url: "https://acme.dmviral.com", source: "site_builder", actorId: "dev-1" });
    expect(r).toEqual({ error: "permission denied" });
    expect(db.tables.leads[0].website_link).toBeNull();
    expect(notify).not.toHaveBeenCalled();
  });
});

describe("Finalize", () => {
  it("moves the link onto the lead for everyone, tells the agent and closer, and clears the review", async () => {
    await putSiteInReview(admin(), { lead: LEAD, url: "https://acme.dmviral.com", source: "site_builder", actorId: "dev-1" });
    notify.mockClear();
    const r = await finalizeSiteReview(admin(), { leadId: "lead-1", actorId: "dev-2" });
    expect(r).toEqual({ ok: true, url: "https://acme.dmviral.com" });
    expect(db.tables.leads[0].website_link).toBe("https://acme.dmviral.com");
    expect(db.tables.lead_site_reviews).toHaveLength(0);
    expect(eventKeys()).toEqual(["website_link_added"]);
    const ctx = notify.mock.calls[0][1] as { lead: { agent_id: string; closed_by: string } };
    expect(ctx.lead).toEqual({ agent_id: "agent-1", closed_by: "closer-1" });
    expect(noteWebsiteLinkChange).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ leadId: "lead-1", before: null, after: "https://acme.dmviral.com" }));
    expect(db.tables.activity_log.map((a) => a.action)).toContain("lead.website_finalized");
  });

  it("with nothing in review says so and changes nothing", async () => {
    const r = await finalizeSiteReview(admin(), { leadId: "lead-1", actorId: "dev-1" });
    expect(r).toMatchObject({ status: 404 });
    expect(db.tables.leads[0].website_link).toBeNull();
    expect(notify).not.toHaveBeenCalled();
  });
});

describe("the site's address for a redeploy", () => {
  it("is the one in review first, else the finished link", async () => {
    expect(await currentSiteLink(admin(), { id: "lead-1", website_link: "https://old.dmviral.com" })).toBe("https://old.dmviral.com");
    expect(await currentSiteLink(admin(), { id: "lead-1", website_link: null })).toBeNull();
    await putSiteInReview(admin(), { lead: LEAD, url: "https://acme.dmviral.com", source: "site_builder", actorId: "dev-1" });
    expect(await currentSiteLink(admin(), { id: "lead-1", website_link: "https://old.dmviral.com" })).toBe("https://acme.dmviral.com");
  });
});

describe("moving or removing a site in review", () => {
  beforeEach(async () => {
    await putSiteInReview(admin(), { lead: LEAD, url: "https://acme.dmviral.com", source: "site_builder", actorId: "dev-1" });
  });

  it("a moved site is followed (matched on its host)", async () => {
    await repointSiteReview(admin(), { leadId: "lead-1", fromUrl: "acme.dmviral.com/", toUrl: "https://acmev2.dmviral.com" });
    expect((await loadSiteReview(admin(), "lead-1"))?.url).toBe("https://acmev2.dmviral.com");
  });

  it("moving a different site leaves the review alone", async () => {
    await repointSiteReview(admin(), { leadId: "lead-1", fromUrl: "https://other.dmviral.com", toUrl: "https://x.dmviral.com" });
    expect((await loadSiteReview(admin(), "lead-1"))?.url).toBe("https://acme.dmviral.com");
  });

  it("taking down the site in review clears it; taking down another site doesn't", async () => {
    await clearSiteReview(admin(), { leadId: "lead-1", site: "https://other.dmviral.com" });
    expect(await loadSiteReview(admin(), "lead-1")).not.toBeNull();
    await clearSiteReview(admin(), { leadId: "lead-1", site: "HTTPS://ACME.dmviral.com/" });
    expect(await loadSiteReview(admin(), "lead-1")).toBeNull();
  });

  it("going live on the client's own domain clears whatever was in review", async () => {
    await clearSiteReview(admin(), { leadId: "lead-1" });
    expect(await loadSiteReview(admin(), "lead-1")).toBeNull();
  });
});

describe("helpers", () => {
  it("developers are whoever resolves tickets or manages the studio", () => {
    expect(isSiteDeveloper(new Set(["tickets.resolve"]))).toBe(true);
    expect(isSiteDeveloper(new Set(["studio.manage"]))).toBe(true);
    expect(isSiteDeveloper(new Set(["leads.edit", "leads.view"]))).toBe(false);
  });

  it("sameSite ignores scheme, case and path, and never matches nothing", () => {
    expect(sameSite("https://Acme.com/a", "acme.com")).toBe(true);
    expect(sameSite("https://acme.com", "https://acmev2.com")).toBe(false);
    expect(sameSite("", "")).toBe(false);
    expect(sameSite(null, null)).toBe(false);
  });
});
