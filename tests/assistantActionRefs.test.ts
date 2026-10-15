// @vitest-environment node
import { describe, it, expect } from "vitest";
import { resolveRef, searchRefs } from "@/lib/assistant/actions/refs";
import type { ActionContext } from "@/lib/assistant/actions/types";
import { memorySupabase } from "./helpers/memorySupabase";

/**
 * Naming records through SED AI follows the app's own rules: a record whose
 * screen the person cannot open cannot be named or found, and within a screen
 * only the rows that screen would show them (Tickets' and Forms' lead scope).
 */

const L_SAM = "00000000-0000-4000-8000-0000000000a1";
const L_ALI = "00000000-0000-4000-8000-0000000000a2";

function setup(perms: string[], userId = "sam") {
  const mem = memorySupabase({
    leads: [
      { id: L_SAM, business_name: "Jumbo's Pizza", agent_id: "sam", closed_by: null, deleted_at: null },
      { id: L_ALI, business_name: "Old Town Grill", agent_id: "ali", closed_by: null, deleted_at: null },
    ],
    client_domains: [{ id: "00000000-0000-4000-8000-0000000000d1", domain: "jumbospizza.com", status: "live", lead_id: L_SAM }],
    form_submissions: [
      { id: "00000000-0000-4000-8000-0000000000f1", subject: "Quote", submitter_name: "Sara Khan", submitter_email: "sara@x.com", delivery_status: "sent", created_at: "2026-10-01", lead_id: L_SAM },
      { id: "00000000-0000-4000-8000-0000000000f2", subject: "Hours", submitter_name: "Sara Lee", submitter_email: "lee@x.com", delivery_status: "sent", created_at: "2026-10-02", lead_id: L_ALI },
    ],
    lead_tickets: [
      { id: "00000000-0000-4000-8000-0000000000c1", title: "Logo change", status: "Open", lead_id: L_ALI, created_by: "ali", assigned_to: null, created_at: "2026-10-01" },
    ],
    site_agent_runs: [
      { id: "00000000-0000-4000-8000-0000000000e1", status: "review", lead_id: L_ALI, ticket_id: "00000000-0000-4000-8000-0000000000c1", site_host: "oldtown.example.com", created_at: "2026-10-03" },
      { id: "00000000-0000-4000-8000-0000000000e2", status: "review", lead_id: null, ticket_id: null, site_host: "standalone.example.com", created_at: "2026-10-04" },
    ],
    profiles: [{ id: "u-sara", display_name: "Sara", email: "sara@company.com", username: "sara", full_name: "Sara Ahmed", is_active: true }],
  });
  const ctx: ActionContext = { userId, displayName: userId, perms: new Set(perms), db: mem.client, admin: mem.client, timezone: "UTC", now: new Date(), isAdmin: false };
  return ctx;
}

describe("record lookups follow the app's screens", () => {
  it("a record whose screen the person cannot open cannot be named or searched", async () => {
    const out = await resolveRef("domain", "jumbospizza.com", setup([]));
    expect(out).toMatchObject({ ok: false, message: expect.stringMatching(/can't see domains/) });
    await expect(searchRefs("domain", "jumbo", setup([]))).rejects.toMatchObject({ status: 403 });
    // Same id, by id: still nothing.
    expect(await resolveRef("domain", "00000000-0000-4000-8000-0000000000d1", setup([]))).toMatchObject({ ok: false });

    expect(await resolveRef("domain", "jumbospizza.com", setup(["domains.view"]))).toMatchObject({ ok: true, hit: { label: "jumbospizza.com" } });
  });

  it("form submissions: only those on the person's own leads, unless they see every lead", async () => {
    const mine = await searchRefs("form_submission", "sara", setup(["forms.view"]));
    expect(mine.map((h) => h.id)).toEqual(["00000000-0000-4000-8000-0000000000f1"]);
    const all = await searchRefs("form_submission", "sara", setup(["forms.view", "leads.view_all"]));
    expect(all).toHaveLength(2);
  });

  it("tickets and AI developer runs: only those within the person's ticket reach", async () => {
    expect(await resolveRef("ticket", "Logo change", setup(["tickets.view"]))).toMatchObject({ ok: false });
    expect(await resolveRef("ticket", "Logo change", setup(["tickets.view"], "ali"))).toMatchObject({ ok: true });

    // A tech user resolving tickets reaches a ticketless run, not one on someone else's ticket.
    const runs = await searchRefs("agent_run", "example.com", setup(["tickets.resolve"]));
    expect(runs.map((h) => h.id)).toEqual(["00000000-0000-4000-8000-0000000000e2"]);
    const every = await searchRefs("agent_run", "example.com", setup(["studio.manage"]));
    expect(every).toHaveLength(2);
  });

  it("colleagues' names for everyone, their email addresses only for user admins", async () => {
    const [plain] = await searchRefs("user", "sara", setup([]));
    expect(plain.label).toBe("Sara");
    expect(plain.detail ?? "").not.toMatch(/@/);
    const [admin] = await searchRefs("user", "sara", setup(["admin.users.view"]));
    expect(admin.detail).toMatch(/sara@company\.com/);
  });
});
