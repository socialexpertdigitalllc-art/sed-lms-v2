// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from "vitest";

const holder = vi.hoisted(() => ({
  user: { id: "u1" } as { id: string } | null,
  perms: new Set<string>(),
  endpoints: [] as Record<string, unknown>[],
  inserted: [] as Record<string, unknown>[],
  updated: [] as Record<string, unknown>[],
  deleted: [] as string[],
}));

vi.mock("@/lib/supabase/server", () => ({ createClient: async () => ({ auth: { getUser: async () => ({ data: { user: holder.user } }) } }) }));
vi.mock("@/lib/permissions/resolver", () => ({ getUserPermissions: async () => holder.perms }));
vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => ({
    from: (table: string) => {
      if (table === "leads") return { select: () => ({ eq: () => ({ is: async () => ({ data: [{ id: "l1" }] }) }) }) };
      if (table === "form_submissions") return { select: () => ({ eq: () => ({ gte: async () => ({ data: [{ endpoint_id: "e1" }, { endpoint_id: "e1" }] }) }) }) };
      return {
        select: () => ({
          order: async () => ({ data: holder.endpoints, error: null }),
          eq: () => ({ maybeSingle: async () => ({ data: holder.endpoints.find(() => true) ?? null, error: null }) }),
        }),
        insert: (row: Record<string, unknown>) => { holder.inserted.push(row); return { select: () => ({ single: async () => ({ data: { id: "new", ...row }, error: null }) }) }; },
        update: (patch: Record<string, unknown>) => ({ eq: () => ({ select: () => ({ single: async () => { holder.updated.push(patch); return { data: { id: "e1", ...patch }, error: null }; } }) }) }),
        delete: () => ({ eq: async (_c: string, id: string) => { holder.deleted.push(id); return { error: null }; } }),
      };
    },
  }),
}));

import { GET, POST } from "@/app/api/forms/endpoints/route";
import { PATCH, DELETE } from "@/app/api/forms/endpoints/[id]/route";

const json = (body: unknown, method = "POST") => new Request("http://t/x", { method, headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
const ctx = { params: Promise.resolve({ id: "e1" }) };

beforeEach(() => {
  holder.user = { id: "u1" };
  holder.perms = new Set(["forms.view"]);
  holder.endpoints = [
    { id: "e1", lead_id: "l1", name: "Mine", access_key: "k1", to_emails: ["a@b.co"], allowed_origins: [], daily_limit: 200, status: "active", mailbox_id: null, subject_template: "", success_redirect_url: null },
    { id: "e2", lead_id: "l9", name: "Theirs", access_key: "k2", to_emails: ["c@d.co"], allowed_origins: [], daily_limit: 200, status: "active", mailbox_id: null, subject_template: "", success_redirect_url: null },
    { id: "e3", lead_id: null, name: "Orphan", access_key: "k3", to_emails: ["e@f.co"], allowed_origins: [], daily_limit: 200, status: "active", mailbox_id: null, subject_template: "", success_redirect_url: null },
  ];
  holder.inserted = []; holder.updated = []; holder.deleted = [];
});

describe("GET /api/forms/endpoints", () => {
  it("401/403 without session or permission", async () => {
    holder.user = null; expect((await GET()).status).toBe(401);
    holder.user = { id: "u1" }; holder.perms = new Set(); expect((await GET()).status).toBe(403);
  });
  it("scopes to my leads and adds today's counts", async () => {
    const res = await GET();
    const body = await res.json();
    expect(body.endpoints.map((e: { id: string }) => e.id)).toEqual(["e1"]);
    expect(body.endpoints[0].today_count).toBe(2);
  });
  it("managers with view_all see everything including lead-less endpoints", async () => {
    holder.perms = new Set(["forms.manage", "leads.view_all"]);
    const body = await (await GET()).json();
    expect(body.endpoints).toHaveLength(3);
  });
});

describe("POST /api/forms/endpoints", () => {
  it("needs forms.manage and validates", async () => {
    expect((await POST(json({ name: "x", to_emails: ["a@b.co"] }))).status).toBe(403);
    holder.perms = new Set(["forms.manage"]);
    expect((await POST(json({ name: "", to_emails: [] }))).status).toBe(422);
  });
  it("creates with a generated key", async () => {
    holder.perms = new Set(["forms.manage"]);
    const res = await POST(json({ name: "Acme", to_emails: ["a@b.co"], lead_id: null }));
    expect(res.status).toBe(201);
    expect(holder.inserted[0]).toMatchObject({ name: "Acme", created_by: "u1" });
    expect(String(holder.inserted[0].access_key)).toHaveLength(32);
  });
});

describe("lead scope on create/patch", () => {
  const foreignLead = "9b2e6a1c-3f4d-4e5a-8b6c-7d8e9f0a1b2c"; // valid v4, not in the mocked scope
  it("403s creating an endpoint for a lead outside the caller's scope", async () => {
    holder.perms = new Set(["forms.manage"]);
    const res = await POST(json({ name: "Sneaky", to_emails: ["a@b.co"], lead_id: foreignLead }));
    expect(res.status).toBe(403);
    expect(holder.inserted).toEqual([]);
  });
  it("403s re-pointing an endpoint at a foreign lead", async () => {
    holder.perms = new Set(["forms.manage"]);
    const res = await PATCH(json({ lead_id: foreignLead }, "PATCH"), ctx);
    expect(res.status).toBe(403);
    expect(holder.updated).toEqual([]);
  });
});

describe("PATCH/DELETE /api/forms/endpoints/[id]", () => {
  it("patches and deletes with forms.manage", async () => {
    holder.perms = new Set(["forms.manage", "leads.view_all"]);
    const res = await PATCH(json({ status: "paused" }, "PATCH"), ctx);
    expect(res.status).toBe(200);
    expect(holder.updated[0]).toMatchObject({ status: "paused" });
    expect((await DELETE(new Request("http://t/x", { method: "DELETE" }), ctx)).status).toBe(200);
    expect(holder.deleted).toEqual(["e1"]);
  });
  it("404s an endpoint outside my scope", async () => {
    holder.perms = new Set(["forms.manage"]);
    holder.endpoints = [holder.endpoints[1]];
    expect((await PATCH(json({ status: "paused" }, "PATCH"), ctx)).status).toBe(404);
  });
});
