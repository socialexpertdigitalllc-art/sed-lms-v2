// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from "vitest";

/**
 * The AI developer's team settings: everyone who sends work reads them (the
 * send dialog starts from them); only operators and admins change them.
 */

const state = vi.hoisted(() => ({
  user: { id: "u-1" } as { id: string } | null,
  perms: new Set<string>(),
  settings: null as Record<string, unknown> | null,
  updateError: null as { code?: string; message: string } | null,
  updates: [] as Record<string, unknown>[],
  inserts: [] as { table: string; values: Record<string, unknown> }[],
}));

vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({ auth: { getUser: async () => ({ data: { user: state.user } }) } }),
}));
vi.mock("@/lib/permissions/resolver", () => ({ getUserPermissions: async () => state.perms }));
vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => ({
    from: (table: string) => {
      const q = {
        select: () => q,
        eq: () => q,
        in: () => q,
        gte: () => q,
        order: () => q,
        limit: () => q,
        maybeSingle: async () => ({ data: table === "app_settings" ? state.settings : null, error: null }),
        update: (values: Record<string, unknown>) => {
          state.updates.push(values);
          return { eq: async () => ({ error: state.updateError }) };
        },
        insert: async (values: Record<string, unknown>) => {
          state.inserts.push({ table, values });
          return { error: null };
        },
        then: (resolve: (v: unknown) => unknown) => resolve({ data: [], error: null }),
      };
      return q;
    },
  }),
}));

import { GET, PUT } from "@/app/api/site-agent/settings/route";

const put = (body: unknown) =>
  PUT(new Request("http://x", { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify(body) }));

beforeEach(() => {
  state.user = { id: "u-1" };
  state.perms = new Set(["studio.manage"]);
  state.settings = {
    agent_worker_seen_at: new Date().toISOString(),
    agent_worker_models: { fetched_at: new Date().toISOString(), models: [{ id: "gemini-3.8-flash-low", label: "Low" }] },
    agent_defaults: { speed: "quick" },
  };
  state.updateError = null;
  state.updates = [];
  state.inserts = [];
});

describe("GET /api/site-agent/settings", () => {
  it("a developer reads the defaults, models and timing, but may not change them", async () => {
    state.perms = new Set(["tickets.resolve"]);
    const res = await GET();
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toMatchObject({
      defaults: { speed: "quick" },
      models: [{ id: "gemini-3.8-flash-low", label: "Low" }],
      canConfigure: false,
      settingsAvailable: true,
      workerOnline: true,
    });
    expect(Array.isArray(body.stats)).toBe(true);
  });

  it("401s a signed-out caller and 403s one without any AI developer permission", async () => {
    state.user = null;
    expect((await GET()).status).toBe(401);
    state.user = { id: "u-1" };
    state.perms = new Set(["leads.view"]);
    expect((await GET()).status).toBe(403);
  });
});

describe("PUT /api/site-agent/settings", () => {
  it("an operator saves the whole set — model, controls, rules — and it is logged", async () => {
    const res = await put({
      model: "gemini-3.8-flash-low", speed: "thorough", time_limit_min: 30, retries: 1, site_map: false,
      house_rules: "  Never touch prices.  ",
    });
    expect(res.status).toBe(200);
    const saved = {
      model: "gemini-3.8-flash-low", speed: "thorough", time_limit_min: 30, retries: 1, site_map: false,
      house_rules: "Never touch prices.",
    };
    expect((await res.json()).defaults).toEqual(saved);
    expect(state.updates[0]).toMatchObject({ agent_defaults: saved, updated_by: "u-1" });
    const log = state.inserts.find((i) => i.values.action === "site_agent.settings.updated");
    expect(log?.values.new_value).toMatchObject({ speed: "thorough", house_rules: "19 chars" });
  });

  it("settings admins may save too; a developer may not", async () => {
    state.perms = new Set(["admin.settings.manage"]);
    expect((await put({ speed: "quick" })).status).toBe(200);
    state.perms = new Set(["tickets.resolve"]);
    expect((await put({ speed: "quick" })).status).toBe(403);
  });

  it("422s bad values and a model the worker doesn't offer", async () => {
    for (const body of [{ speed: "warp" }, { time_limit_min: 90 }, { retries: -1 }, { house_rules: "x".repeat(2001) }, { model: "gemini-3.7-flash-high" }, "nope"]) {
      expect((await put(body)).status, JSON.stringify(body)).toBe(422);
    }
    expect(state.updates).toHaveLength(0);
  });

  it("says plainly when the database update isn't applied yet", async () => {
    state.updateError = { code: "PGRST204", message: "Could not find the 'agent_defaults' column of 'app_settings' in the schema cache" };
    const res = await put({ speed: "quick" });
    expect(res.status).toBe(409);
    expect((await res.json()).error).toMatch(/database needs update 0086/i);
  });
});
