import { describe, it, expect, vi, beforeEach } from "vitest";
import { memorySupabase, type MemoryDb } from "./helpers/memorySupabase";

const state = vi.hoisted(() => ({
  user: { id: "closer-1" } as { id: string } | null,
  perms: new Set<string>(["hitlist.view"]),
  db: null as unknown as { client: unknown },
}));

vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({ auth: { getUser: async () => ({ data: { user: state.user } }) } }),
}));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => state.db.client }));
vi.mock("@/lib/permissions/resolver", () => ({ getUserPermissions: async () => state.perms }));

import { PUT } from "@/app/api/hitlist/[leadId]/line/route";
import { parseLineType } from "@/lib/hitlist/line";

const LEAD = "11111111-1111-1111-1111-111111111111";
const OFF = "22222222-2222-2222-2222-222222222222";
const put = (body: unknown, leadId = LEAD) =>
  PUT(new Request(`http://x/api/hitlist/${leadId}/line`, { method: "PUT", body: JSON.stringify(body) }), { params: Promise.resolve({ leadId }) });

let db: MemoryDb;
beforeEach(() => {
  state.user = { id: "closer-1" };
  state.perms = new Set(["hitlist.view"]);
  db = memorySupabase({
    leads: [
      { id: LEAD, deleted_at: null, line_type: null },
      { id: OFF, deleted_at: null, line_type: null },
    ],
    lead_hitlist: [{ lead_id: LEAD, priority: 4 }],
    activity_log: [],
  });
  state.db = db;
});

describe("/api/hitlist/[leadId]/line", () => {
  it("anyone who sees the HitList tags a lead Direct Line, and it's logged", async () => {
    const res = await put({ line_type: "direct" });
    expect(res.status).toBe(200);
    expect(db.tables.leads[0].line_type).toBe("direct");
    expect(db.tables.activity_log).toEqual([
      expect.objectContaining({ user_id: "closer-1", action: "lead.line_type", entity_id: LEAD, old_value: { line_type: null }, new_value: { line_type: "direct" } }),
    ]);
  });

  it("switches to Not Direct Line, and clears", async () => {
    await put({ line_type: "direct" });
    await put({ line_type: "not_direct" });
    expect(db.tables.leads[0].line_type).toBe("not_direct");
    await put({ line_type: null });
    expect(db.tables.leads[0].line_type).toBeNull();
  });

  it("the same value again changes nothing and logs nothing", async () => {
    await put({ line_type: "direct" });
    await put({ line_type: "direct" });
    expect(db.tables.activity_log).toHaveLength(1);
  });

  it("refuses people without HitList access", async () => {
    state.perms = new Set(["leads.view", "leads.edit"]);
    const res = await put({ line_type: "direct" });
    expect(res.status).toBe(403);
    expect(db.tables.leads[0].line_type).toBeNull();
  });

  it("refuses signed-out requests, bad values, unknown leads and leads not on the HitList", async () => {
    expect((await put({ line_type: "maybe" })).status).toBe(400);
    expect((await put({ line_type: "direct" }, "33333333-3333-3333-3333-333333333333")).status).toBe(404);
    expect((await put({ line_type: "direct" }, OFF)).status).toBe(409);
    state.user = null;
    expect((await put({ line_type: "direct" })).status).toBe(401);
  });

  it("parses only the two values (or a clear)", () => {
    expect(parseLineType("direct")).toBe("direct");
    expect(parseLineType("not_direct")).toBe("not_direct");
    expect(parseLineType(null)).toBeNull();
    expect(parseLineType("")).toBeNull();
    expect(parseLineType("Direct Line")).toBeUndefined();
  });
});
