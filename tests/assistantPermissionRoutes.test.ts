// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from "vitest";
import type { ActionDef } from "@/lib/assistant/actions/types";
import { memorySupabase, type MemoryDb } from "./helpers/memorySupabase";

/**
 * The permission-mode routes: a person sets their own mode (never above the
 * company limit), "don't ask again" lands only for what could ever run on
 * its own, and admins set the limit and per-action "always ask".
 */

const state = vi.hoisted(() => ({ db: null as unknown as MemoryDb, manage: true, perms: ["things.create"] as string[] }));

const defs: ActionDef[] = [
  {
    key: "test.create",
    group: "Leads",
    title: "Create a thing",
    description: "",
    confirmLabel: "Create",
    risk: "standard",
    allowed: () => null,
    fields: [{ name: "name", label: "Name", type: "text", required: true }],
    async execute(v) {
      return { message: `Created ${String(v.name)}` };
    },
  },
  {
    key: "test.critical",
    group: "Money",
    title: "Buy a thing",
    description: "",
    confirmLabel: "Buy",
    risk: "critical",
    allowed: () => null,
    fields: [{ name: "name", label: "Name", type: "text", required: true }],
    async execute() {
      return { message: "Bought" };
    },
  },
];

vi.mock("@/lib/assistant/actions/registry", () => ({
  ACTION_DEFS: defs,
  getActionDef: (k: string) => defs.find((d) => d.key === k),
  actionCatalogue: () => "",
}));
vi.mock("@/lib/assistant/actions/http", async (importOriginal) => {
  const real = await importOriginal<typeof import("@/lib/assistant/actions/http")>();
  return {
    ...real,
    actionGuard: async (opts: { manage?: boolean } = {}) => {
      if (opts.manage && !state.manage) return { ok: false, response: new Response(JSON.stringify({ error: "no" }), { status: 403 }) };
      return {
        ok: true,
        value: {
          caller: {},
          ctx: { userId: "sam", displayName: "Sam", perms: new Set(state.perms), db: state.db.client, admin: state.db.client, timezone: "Asia/Karachi", now: new Date(), isAdmin: false },
        },
      };
    },
  };
});

const { GET, PUT } = await import("@/app/api/assistant/actions/permissions/route");
const settings = await import("@/app/api/assistant/actions/settings/route");
const { POST: confirm } = await import("@/app/api/assistant/actions/[id]/confirm/route");
const { prepareAction } = await import("@/lib/assistant/actions/run");
const { clearActionSettingsCache } = await import("@/lib/assistant/actions/store");
const { clearPermissionCapCache } = await import("@/lib/assistant/actions/permissionStore");

const put = (body: unknown) => PUT(new Request("http://lms.test/api/assistant/actions/permissions", { method: "PUT", body: JSON.stringify(body) }));
const prefs = () => (state.db.tables.profiles[0].ui_preferences as Record<string, unknown>).assistantPermissions;

beforeEach(() => {
  state.manage = true;
  state.perms = ["things.create"];
  clearActionSettingsCache();
  clearPermissionCapCache();
  state.db = memorySupabase(
    {
      profiles: [{ id: "sam", ui_preferences: { assistantName: "Nova" } }],
      app_settings: [{ singleton: true, assistant_max_permission_mode: "auto" }],
      assistant_action_settings: [],
      activity_log: [],
    },
    {
      assistant_actions: () => ({
        status: "proposed",
        expires_at: new Date(Date.now() + 86_400_000).toISOString(),
        approver_id: null,
        approval_note: null,
        decided_at: null,
        reported_at: null,
        result: null,
        error: null,
        undo_until: null,
        executed_at: null,
      }),
    },
  );
});

describe("/api/assistant/actions/permissions", () => {
  it("starts in Ask, and saves a new mode without touching other preferences", async () => {
    expect(await (await GET()).json()).toMatchObject({ mode: "ask", effective: "ask", cap: "auto", allow: [] });
    const res = await put({ mode: "auto_safe" });
    expect(res.status).toBe(200);
    expect(state.db.tables.profiles[0].ui_preferences).toEqual({ assistantName: "Nova", assistantPermissions: { mode: "auto_safe", allow: [] } });
    expect(state.db.tables.activity_log.at(-1)).toMatchObject({ action: "assistant.permission_mode_changed", new_value: { mode: "auto_safe" } });
  });

  it("refuses a mode above the company limit", async () => {
    state.db.tables.app_settings[0].assistant_max_permission_mode = "auto_safe";
    const res = await put({ mode: "auto" });
    expect(res.status).toBe(403);
    expect((await res.json()).error).toMatch(/at most “Auto-run safe changes”/);
    const view = await (await GET()).json();
    expect(view.modes.map((m: { allowed: boolean }) => m.allowed)).toEqual([true, true, false]);
  });

  it("a saved mode above a later-lowered limit applies as the limit", async () => {
    await put({ mode: "auto" });
    state.db.tables.app_settings[0].assistant_max_permission_mode = "ask";
    clearPermissionCapCache();
    expect(await (await GET()).json()).toMatchObject({ mode: "auto", effective: "ask" });
  });

  it("\"don't ask again\": never for high-impact or unknown actions; removable", async () => {
    expect((await put({ allow_add: "test.critical" })).status).toBe(422);
    expect((await put({ allow_add: "nope.nope" })).status).toBe(404);
    await put({ allow_add: "test.create" });
    expect(prefs()).toEqual({ mode: "ask", allow: ["test.create"] });
    expect((await (await GET()).json()).allow).toEqual([{ key: "test.create", title: "Create a thing", group: "Leads" }]);
    await put({ allow_remove: "test.create" });
    expect(prefs()).toEqual({ mode: "ask", allow: [] });
  });
});

describe("Confirm with \"don't ask again\"", () => {
  async function card(key: string) {
    const out = await prepareAction({
      key,
      fields: { name: "X" },
      ctx: { userId: "sam", displayName: "Sam", perms: new Set(state.perms), db: state.db.client, admin: state.db.client, timezone: "Asia/Karachi", now: new Date(), isAdmin: false },
      conversationId: "c1",
      turnId: "t1",
      callId: "k1",
      source: "chat",
    });
    if (out.kind !== "proposed") throw new Error(out.kind);
    return out.card;
  }
  const press = (id: string, body: unknown) =>
    confirm(new Request(`http://lms.test/api/assistant/actions/${id}/confirm`, { method: "POST", body: JSON.stringify(body) }), { params: Promise.resolve({ id }) });

  it("remembers the action once it really ran", async () => {
    const c = await card("test.create");
    const res = await press(c.id, { remember: true });
    expect(await res.json()).toMatchObject({ card: { status: "done" }, remembered: true });
    expect(prefs()).toEqual({ mode: "ask", allow: ["test.create"] });
  });

  it("never for a high-impact change", async () => {
    const c = await card("test.critical");
    const res = await press(c.id, { remember: true, phrase: c.confirmPhrase });
    expect(await res.json()).toMatchObject({ card: { status: "done" }, remembered: false });
    expect(prefs()).toBeUndefined();
  });
});

describe("admin settings: the limit and \"always ask\"", () => {
  const putSettings = (body: unknown) => settings.PUT(new Request("http://lms.test/api/assistant/actions/settings", { method: "PUT", body: JSON.stringify(body) }));

  it("sets the company limit and shows it", async () => {
    expect((await putSettings({ max_mode: "auto_safe" })).status).toBe(200);
    expect(state.db.tables.app_settings[0].assistant_max_permission_mode).toBe("auto_safe");
    const body = await (await settings.GET()).json();
    expect(body.policy.max_mode).toBe("auto_safe");
  });

  it("turns auto-run off for one action, keeping its other switches", async () => {
    expect((await putSettings({ key: "test.create", auto_run: false })).status).toBe(200);
    expect(state.db.tables.assistant_action_settings[0]).toMatchObject({ action_key: "test.create", enabled: true, require_approval: false, auto_run: false });
    const body = await (await settings.GET()).json();
    expect(body.actions.find((a: { key: string }) => a.key === "test.create")).toMatchObject({ auto_run: false });
  });

  it("only for people who manage actions", async () => {
    state.manage = false;
    expect((await putSettings({ max_mode: "auto" })).status).toBe(403);
  });
});
