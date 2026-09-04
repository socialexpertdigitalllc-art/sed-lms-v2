/**
 * Who can read the Site Builder template catalogue.
 *
 * The lead form's template picker is used by SALES — people who hold
 * `leads.create` and never `studio.manage`. Before this, every catalogue
 * read was gated on `studio.manage` alone, so the picker showed "Could not
 * load the templates" for the whole sales department (403 on the list). The
 * in-service list, a template's cover and its preview are open to anyone
 * who can create a lead; the full catalogue and every write stay studio-only.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const holder: { user: { id: string } | null; perms: Set<string> } = { user: { id: "u-sales" }, perms: new Set() };

vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({ auth: { getUser: async () => ({ data: { user: holder.user } }) } }),
}));
vi.mock("@/lib/permissions/resolver", () => ({ getUserPermissions: async () => holder.perms }));

const ROWS = [
  { id: "t-live", name: "Roof Smart", storage_path: "t-live/source.zip", page_files: ["index.html"], asset_files: [], cover_image_path: "t-live/cover.png", in_service: true, created_by: null, created_at: "2026-09-04" },
  { id: "t-off", name: "Old one", storage_path: "t-off/source.zip", page_files: ["index.html"], asset_files: [], cover_image_path: null, in_service: false, created_by: null, created_at: "2026-09-01" },
];

/** A just-enough admin client: a filterable query over ROWS plus a cover download. */
function query(rows: Record<string, unknown>[]) {
  const q = {
    select: () => q,
    order: () => q,
    eq: (k: string, v: unknown) => query(rows.filter((r) => r[k] === v)),
    maybeSingle: async () => ({ data: rows[0] ?? null, error: null }),
    then: (res: (v: unknown) => unknown, rej?: (e: unknown) => unknown) =>
      Promise.resolve({ data: rows, error: null }).then(res, rej),
  };
  return q;
}
vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => ({
    from: () => query(ROWS),
    // A plain object rather than a Blob: jsdom's Blob has no arrayBuffer().
    storage: { from: () => ({ download: async () => ({ data: { arrayBuffer: async () => new Uint8Array([137, 80, 78, 71]).buffer }, error: null }) }) },
  }),
}));

import { guard, guardAny } from "@/lib/site-studio/service/guard";
import { GET as listTemplates } from "@/app/api/site-builder/templates/route";
import { GET as getCover } from "@/app/api/site-builder/templates/[id]/cover/route";

const sales = () => (holder.perms = new Set(["leads.view", "leads.create"]));
const studio = () => (holder.perms = new Set(["studio.manage"]));
const ctx = (id: string) => ({ params: Promise.resolve({ id }) });

beforeEach(() => {
  holder.user = { id: "u-sales" };
  holder.perms = new Set();
});

describe("guardAny", () => {
  it("401s a visitor with no session", async () => {
    holder.user = null;
    expect(await guardAny(["leads.create"])).toEqual({ error: 401 });
  });
  it("403s a user holding none of the permissions", async () => {
    holder.perms = new Set(["leads.view"]);
    expect(await guardAny(["studio.manage", "leads.create"])).toEqual({ error: 403 });
  });
  it("passes a user holding any one of them", async () => {
    sales();
    expect(await guardAny(["studio.manage", "leads.create"])).toEqual({ userId: "u-sales" });
  });
  it("guard() is still studio.manage only", async () => {
    sales();
    expect(await guard()).toEqual({ error: 403 });
    studio();
    expect(await guard()).toEqual({ userId: "u-sales" });
  });
});

describe("GET /api/site-builder/templates", () => {
  it("a salesperson gets the in-service catalogue the lead form asks for", async () => {
    sales();
    const res = await listTemplates(new Request("http://x/api/site-builder/templates?in_service=1"));
    expect(res.status).toBe(200);
    const body = (await res.json()) as { templates: { id: string }[] };
    expect(body.templates.map((t) => t.id)).toEqual(["t-live"]);
  });
  it("a salesperson may NOT list the full catalogue", async () => {
    sales();
    const res = await listTemplates(new Request("http://x/api/site-builder/templates"));
    expect(res.status).toBe(403);
  });
  it("a studio manager still gets the full catalogue", async () => {
    studio();
    const res = await listTemplates(new Request("http://x/api/site-builder/templates"));
    expect(res.status).toBe(200);
    const body = (await res.json()) as { templates: { id: string }[] };
    expect(body.templates.map((t) => t.id)).toEqual(["t-live", "t-off"]);
  });
  it("someone with neither permission gets nothing either way", async () => {
    holder.perms = new Set(["leads.view"]);
    expect((await listTemplates(new Request("http://x/api/site-builder/templates?in_service=1"))).status).toBe(403);
  });
});

describe("GET /api/site-builder/templates/[id]/cover", () => {
  it("a salesperson can see a template's cover — the picker is pictures", async () => {
    sales();
    const res = await getCover(new Request("http://x"), ctx("t-live"));
    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Type")).toBe("image/png");
  });
  it("still refuses someone who cannot create leads", async () => {
    holder.perms = new Set(["leads.view"]);
    const res = await getCover(new Request("http://x"), ctx("t-live"));
    expect(res.status).toBe(403);
  });
});
