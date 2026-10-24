import { describe, it, expect, vi, beforeEach } from "vitest";
import { memorySupabase, type MemoryDb } from "./helpers/memorySupabase";

const state = vi.hoisted(() => ({
  user: { id: "admin-1" } as { id: string } | null,
  perms: new Set<string>(["hitlist.view", "hitlist.manage"]),
  db: null as unknown as { client: unknown },
}));

vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({ auth: { getUser: async () => ({ data: { user: state.user } }) } }),
}));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => state.db.client }));
vi.mock("@/lib/permissions/resolver", () => ({ getUserPermissions: async () => state.perms }));

import { PUT, DELETE } from "@/app/api/hitlist/[leadId]/route";

const LEAD = "11111111-1111-1111-1111-111111111111";
const params = (leadId = LEAD) => ({ params: Promise.resolve({ leadId }) });
const put = (body: unknown, leadId = LEAD) =>
  PUT(new Request(`http://x/api/hitlist/${leadId}`, { method: "PUT", body: JSON.stringify(body) }), params(leadId));
const del = (leadId = LEAD) => DELETE(new Request(`http://x/api/hitlist/${leadId}`, { method: "DELETE" }), params(leadId));

let db: MemoryDb;
beforeEach(() => {
  state.user = { id: "admin-1" };
  state.perms = new Set(["hitlist.view", "hitlist.manage"]);
  db = memorySupabase({ leads: [{ id: LEAD, deleted_at: null }], lead_hitlist: [] });
  state.db = db;
});

describe("/api/hitlist/[leadId]", () => {
  it("PUT adds the lead with its stars", async () => {
    const res = await put({ priority: 5 });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ leadId: LEAD, priority: 5 });
    expect(db.tables.lead_hitlist).toEqual([expect.objectContaining({ lead_id: LEAD, priority: 5, added_by: "admin-1" })]);
  });

  it("DELETE takes it off", async () => {
    db.tables.lead_hitlist.push({ lead_id: LEAD, priority: 2 });
    const res = await del();
    expect(res.status).toBe(200);
    expect(db.tables.lead_hitlist).toEqual([]);
  });

  it("a closer (view only) can't change it", async () => {
    state.perms = new Set(["hitlist.view"]);
    expect((await put({ priority: 3 })).status).toBe(403);
    expect((await del()).status).toBe(403);
    expect(db.tables.lead_hitlist).toEqual([]);
  });

  it("signed-out is 401", async () => {
    state.user = null;
    expect((await put({ priority: 3 })).status).toBe(401);
    expect((await del()).status).toBe(401);
  });

  it("a priority outside 1–5 is 400, before anything is written", async () => {
    for (const p of [0, 6, 2.5, "five", null]) expect((await put({ priority: p })).status).toBe(400);
    expect((await PUT(new Request("http://x", { method: "PUT", body: "not json" }), params())).status).toBe(400);
    expect(db.tables.lead_hitlist).toEqual([]);
  });

  it("an unknown or archived lead is 404", async () => {
    expect((await put({ priority: 3 }, "99999999-9999-9999-9999-999999999999")).status).toBe(404);
    db.tables.leads[0].deleted_at = "2026-10-01T00:00:00Z";
    expect((await put({ priority: 3 })).status).toBe(404);
  });
});
