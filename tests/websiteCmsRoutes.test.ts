// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from "vitest";

// The authenticated Website CMS API: permission guards, zod validation,
// the activity log and the publish ping on every save.

const holder = vi.hoisted(() => ({
  user: { id: "u1" } as { id: string } | null,
  perms: new Set<string>(),
  inserted: [] as { table: string; row: Record<string, unknown> }[],
  updated: [] as { table: string; patch: Record<string, unknown> }[],
  deleted: [] as { table: string }[],
  updateHits: true,
  publishCalls: [] as (string[] | undefined)[],
}));

vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({ auth: { getUser: async () => ({ data: { user: holder.user } }) } }),
}));
vi.mock("@/lib/permissions/resolver", () => ({ getUserPermissions: async () => holder.perms }));
vi.mock("@/lib/website-cms/publish", () => ({
  notifyWebsite: vi.fn(async (tags?: string[]) => {
    holder.publishCalls.push(tags);
    return { ok: true, tags: tags ?? [] };
  }),
}));
vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => ({
    from: (table: string) => ({
      select: () => {
        const b: Record<string, unknown> = {};
        b.order = () => b;
        b.then = (resolve: (v: unknown) => unknown) => Promise.resolve({ data: [], error: null }).then(resolve);
        return b;
      },
      insert: (row: Record<string, unknown>) => {
        holder.inserted.push({ table, row });
        return {
          select: () => ({ single: async () => ({ data: { id: "new-id" }, error: null }) }),
          then: (resolve: (v: unknown) => unknown) => Promise.resolve({ error: null }).then(resolve),
        };
      },
      update: (patch: Record<string, unknown>) => ({
        eq: () => ({
          select: () => ({
            maybeSingle: async () => {
              holder.updated.push({ table, patch });
              return { data: holder.updateHits ? { id: "row-1" } : null, error: null };
            },
          }),
        }),
      }),
      delete: () => ({
        eq: () => ({
          select: () => ({
            maybeSingle: async () => {
              holder.deleted.push({ table });
              return { data: { id: "row-1" }, error: null };
            },
          }),
        }),
      }),
      upsert: async () => ({ error: null }),
    }),
  }),
}));

import { GET as listRows, POST as createRow } from "@/app/api/website/[collection]/route";
import { PUT as updateRow, DELETE as deleteRow } from "@/app/api/website/[collection]/[id]/route";
import { PUT as putSettings } from "@/app/api/website/settings/route";
import { POST as publishAll } from "@/app/api/website/publish/route";

const ctx = (collection: string, id?: string) => ({
  params: Promise.resolve(id ? { collection, id } : { collection }),
}) as never;
const json = (body: unknown, method = "POST") =>
  method === "GET" || method === "DELETE"
    ? new Request("http://t/x", { method })
    : new Request("http://t/x", { method, headers: { "content-type": "application/json" }, body: JSON.stringify(body) });

const validOffer = { title: "Fall promo", banner_text: "Save big", service_slug: null, active: true, sort_order: 0 };

beforeEach(() => {
  holder.user = { id: "u1" };
  holder.perms = new Set(["website.manage"]);
  holder.inserted = [];
  holder.updated = [];
  holder.deleted = [];
  holder.updateHits = true;
  holder.publishCalls = [];
});

describe("guards", () => {
  it("401 signed out, 403 without the permission, list needs only view", async () => {
    holder.user = null;
    expect((await listRows(json(null, "GET"), ctx("offers"))).status).toBe(401);
    holder.user = { id: "u1" };
    holder.perms = new Set();
    expect((await listRows(json(null, "GET"), ctx("offers"))).status).toBe(403);
    holder.perms = new Set(["website.view"]);
    expect((await listRows(json(null, "GET"), ctx("offers"))).status).toBe(200);
    // ...but writing demands manage
    expect((await createRow(json(validOffer), ctx("offers"))).status).toBe(403);
  });

  it("an unknown collection is a 404, never a table name passthrough", async () => {
    expect((await listRows(json(null, "GET"), ctx("profiles"))).status).toBe(404);
    expect((await createRow(json({}), ctx("drop table"))).status).toBe(404);
  });
});

describe("create / update / delete", () => {
  it("creates a row, logs activity, pings the website with the collection's tags", async () => {
    const res = await createRow(json(validOffer), ctx("offers"));
    expect(res.status).toBe(201);
    expect((await res.json()).publish).toMatchObject({ ok: true });
    expect(holder.inserted.map((i) => i.table)).toEqual(["website_offers", "activity_log"]);
    expect(holder.publishCalls).toEqual([["offers"]]);
  });

  it("rejects bad payloads with zod issues", async () => {
    const res = await createRow(json({ title: "" }), ctx("offers"));
    expect(res.status).toBe(422);
    expect((await res.json()).issues.fieldErrors.title).toBeTruthy();
  });

  it("coupon saves normalise the code and never ping the site (validated live)", async () => {
    const res = await createRow(
      json({ code: "save20", label: "", discount_type: "percent", amount: 20, service_slugs: [], active: true, expires_at: null }),
      ctx("coupons")
    );
    expect(res.status).toBe(201);
    expect(holder.inserted[0].row.code).toBe("SAVE20");
    expect(holder.publishCalls).toEqual([]);
  });

  it("updates hit the row or 404", async () => {
    expect((await updateRow(json(validOffer, "PUT"), ctx("offers", "row-1"))).status).toBe(200);
    holder.updateHits = false;
    expect((await updateRow(json(validOffer, "PUT"), ctx("offers", "missing"))).status).toBe(404);
  });

  it("deletes log and publish", async () => {
    const res = await deleteRow(json(null, "DELETE"), ctx("services", "row-1"));
    expect(res.status).toBe(200);
    expect(holder.deleted).toEqual([{ table: "website_services" }]);
    expect(holder.publishCalls).toEqual([["site-content"]]);
  });
});

describe("settings + publish", () => {
  const settings = {
    stats: { sitesLaunched: 120, activeClients: 90, statesServed: 14, yearsActive: 3 },
    revalidate_url: "https://socialexpertdigitalllc.com/api/revalidate",
    revalidate_secret: "s",
    api_key: "k",
  };

  it("settings PUT demands manage and keeps secrets out of the activity log", async () => {
    holder.perms = new Set(["website.view"]);
    expect((await putSettings(json(settings, "PUT"))).status).toBe(403);
    holder.perms = new Set(["website.manage"]);
    expect((await putSettings(json(settings, "PUT"))).status).toBe(200);
    const log = holder.inserted.find((i) => i.table === "activity_log");
    expect(JSON.stringify(log)).not.toContain('"s"');
    expect(JSON.stringify(log)).not.toContain("api_key");
  });

  it("publish-all pings every tag", async () => {
    const res = await publishAll(json({}));
    expect(res.status).toBe(200);
    expect(holder.publishCalls).toEqual([undefined]);
  });
});
